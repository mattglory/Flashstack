/**
 * Arkadiko Liquidation Monitor
 * Watches for undercollateralized Arkadiko vaults and triggers
 * flash loan liquidations via FlashStack.
 *
 * How it works:
 *   1. Fetches all active Arkadiko vault owners from on-chain data
 *   2. Checks each vault's collateral ratio against the liquidation threshold (150%)
 *   3. When a vault drops below threshold, calculates expected profit
 *   4. If profit > gas cost, executes liquidation via arkadiko-liquidation-receiver
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/monitor-liquidations.mjs
 *   DEPLOYER_MNEMONIC="..." EXECUTE=true node scripts/monitor-liquidations.mjs
 *
 * Set EXECUTE=true to actually trigger liquidations. Without it, runs in dry-run mode.
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC   = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER   = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const EXECUTE    = process.env.EXECUTE === "true";
const INTERVAL   = parseInt(process.env.INTERVAL_MS ?? "30000"); // 30s default

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;
const API     = "https://api.hiro.so";

// Arkadiko constants
const ARKADIKO        = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const VAULTS_DATA     = `${ARKADIKO}.arkadiko-vaults-data-v1-1`;
const ORACLE          = `${ARKADIKO}.arkadiko-oracle-v2-3`;
const VAULTS_TOKENS   = `${ARKADIKO}.arkadiko-vaults-tokens-v1-1`;
const STX_TOKEN_ID    = "STX";

// FlashStack
const FLASHSTACK_CORE = `${DEPLOYER}.flashstack-stx-core`;
const LIQ_RECEIVER    = `${DEPLOYER}.arkadiko-liquidation-receiver`;

// Liquidation threshold: 150% collateral ratio = 1.5 STX collateral per 1 STX debt
const LIQUIDATION_RATIO = 1.5;
// Liquidation bonus: 10% discount on collateral
const LIQUIDATION_BONUS = 0.10;
// Minimum profit to bother executing (in STX) — covers gas + safety margin
const MIN_PROFIT_STX = 1.0;

let walletPk = null;

async function getPrivateKey() {
  if (walletPk) return walletPk;
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  walletPk = wallet.accounts[0].stxPrivateKey;
  return walletPk;
}

async function callReadOnly(contractId, fn, args, sender = DEPLOYER) {
  const [addr, name] = contractId.split(".");
  const result = await fetchCallReadOnlyFunction({
    contractAddress: addr,
    contractName: name,
    functionName: fn,
    functionArgs: args,
    network,
    senderAddress: sender,
  });
  return cvToJSON(result);
}

// Get current STX price in USD from Arkadiko oracle
async function getStxPrice() {
  try {
    const res = await callReadOnly(ORACLE, "get-price", [Cl.stringAscii("STX")]);
    const price = parseInt(res?.value?.value?.["last-price"]?.value ?? "0");
    return price / 1e6; // Oracle returns price * 1e6
  } catch {
    return null;
  }
}

// Get a specific vault's data
async function getVault(owner) {
  try {
    const res = await callReadOnly(VAULTS_DATA, "get-vault", [
      Cl.principal(owner),
      Cl.principal(VAULTS_TOKENS),
    ]);
    if (res?.type === "error" || !res?.value) return null;
    const v = res.value.value;
    return {
      collateral: parseInt(v?.collateral?.value ?? "0"),
      debt:       parseInt(v?.debt?.value ?? "0"),
      status:     v?.status?.value ?? "",
    };
  } catch {
    return null;
  }
}

// Check if a vault is undercollateralized
function isLiquidatable(vault, stxPrice) {
  if (!vault || vault.debt === 0) return false;
  if (vault.status !== "active") return false;

  // collateral and debt are in microstacks
  const collateralStx = vault.collateral / 1e6;
  const debtStx       = vault.debt / 1e6;
  const ratio         = collateralStx / debtStx;

  return ratio < LIQUIDATION_RATIO;
}

// Calculate expected profit from liquidating a vault
function calculateProfit(vault) {
  const debtStx            = vault.debt / 1e6;
  const collateralReceived = debtStx * (1 + LIQUIDATION_BONUS); // 10% bonus
  const flashFee           = debtStx * 0.0005; // 0.05% FlashStack fee
  const gasCost            = 0.003; // ~0.003 STX tx fee
  const profit             = collateralReceived - debtStx - flashFee - gasCost;
  return { debtStx, collateralReceived, flashFee, profit };
}

// Get list of vault owners to check
// In production this would scan all vault creation events from chain history
// For now we use a known set + any passed via env
async function getVaultOwners() {
  // Known active vault owners - can be expanded over time
  // To find more: query chain for "arkadiko-vaults-manager" "open-vault" events
  const knownOwners = (process.env.VAULT_OWNERS ?? "").split(",").filter(Boolean);

  // Also fetch recent vault activity from Hiro API
  try {
    const res = await fetch(
      `${API}/extended/v1/address/${ARKADIKO}.arkadiko-vaults-manager-v1-2/transactions?limit=50`
    );
    const data = await res.json();
    const fromChain = data.results
      ?.filter(tx => tx.tx_status === "success" && tx.contract_call?.function_name === "open-vault")
      ?.map(tx => tx.sender_address)
      ?? [];
    return [...new Set([...knownOwners, ...fromChain])];
  } catch {
    return knownOwners;
  }
}

// Execute a liquidation
async function executeLiquidation(owner, vault) {
  const pk    = await getPrivateKey();
  const nonce = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
    .then(r => r.json())
    .then(d => d.nonce);

  const debtMicro = vault.debt;

  console.log(`  Executing liquidation of ${owner}`);
  console.log(`  Debt: ${debtMicro / 1e6} STX, borrowing via FlashStack...`);

  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName:    "arkadiko-liquidation-receiver",
    functionName:    "liquidate",
    functionArgs:    [
      Cl.principal(owner),
      Cl.uint(debtMicro),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000, // 0.3 STX
  });

  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) {
    console.error(`  FAILED: ${result.error} - ${result.reason}`);
    return null;
  }
  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/0x${result.txid}?chain=mainnet`);
  return result.txid;
}

// Main scan loop
async function scan() {
  const stxPrice = await getStxPrice();
  console.log(`\n[${new Date().toISOString()}] Scanning Arkadiko vaults...`);
  if (stxPrice) console.log(`STX price: $${stxPrice.toFixed(4)}`);

  const owners = await getVaultOwners();
  if (owners.length === 0) {
    console.log("No vault owners to check. Set VAULT_OWNERS=SP1...,SP2... to monitor specific vaults.");
    return;
  }

  console.log(`Checking ${owners.length} vault(s)...`);

  let opportunities = 0;
  for (const owner of owners) {
    const vault = await getVault(owner);
    if (!vault || vault.debt === 0) continue;

    const collateralStx = vault.collateral / 1e6;
    const debtStx       = vault.debt / 1e6;
    const ratio         = collateralStx / debtStx;
    const liquidatable  = isLiquidatable(vault, stxPrice);
    const { profit }    = calculateProfit(vault);

    console.log(`\n  Vault: ${owner}`);
    console.log(`  Collateral: ${collateralStx.toFixed(2)} STX | Debt: ${debtStx.toFixed(2)} STX | Ratio: ${ratio.toFixed(2)}x`);
    console.log(`  Liquidatable: ${liquidatable ? "YES" : "no"} | Est. profit: ${profit.toFixed(4)} STX`);

    if (liquidatable && profit > MIN_PROFIT_STX) {
      opportunities++;
      console.log(`  *** OPPORTUNITY FOUND — ${profit.toFixed(4)} STX profit ***`);

      if (EXECUTE) {
        await executeLiquidation(owner, vault);
      } else {
        console.log(`  (dry-run mode — set EXECUTE=true to trigger)`);
      }
    }
  }

  if (opportunities === 0) {
    console.log("\nNo profitable liquidations found this scan.");
  }
}

async function main() {
  console.log("FlashStack Liquidation Monitor");
  console.log("==============================");
  console.log(`Mode: ${EXECUTE ? "LIVE EXECUTION" : "dry-run (monitoring only)"}`);
  console.log(`Scan interval: ${INTERVAL / 1000}s`);
  console.log(`Receiver: ${LIQ_RECEIVER}`);
  console.log(`Core: ${FLASHSTACK_CORE}`);
  console.log("\nTip: Set VAULT_OWNERS=SP1...,SP2... to monitor specific vault owners.");
  console.log("Tip: Find vault owners at https://app.arkadiko.finance\n");

  // Run immediately then on interval
  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
