/**
 * FlashStack Yield Vault -- Compound Monitor
 *
 * Watches the Bitflow STX/stSTX pool for profitable arb windows.
 * When the stSTX spread covers the 0.05% flash fee, calls compound()
 * on flashstack-yield-vault to capture the yield for all depositors.
 *
 * Usage:
 *   node scripts/monitor-vault-compound.mjs
 *   EXECUTE=true LOAN_STX=50 DEPLOYER_MNEMONIC="..." node scripts/monitor-vault-compound.mjs
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  -- 24-word mnemonic (required for EXECUTE=true)
 *   EXECUTE            -- "true" to auto-execute when profitable (default: dry-run)
 *   LOAN_STX           -- loan size in whole STX passed to compound() (default: 50)
 *   INTERVAL_MS        -- scan interval in ms (default: 30000)
 *   MIN_PROFIT_MICRO   -- minimum net profit in microSTX to trigger (default: 1000)
 *   HIRO_API_KEY       -- optional, raises rate limits
 */

import {
  makeContractCall,
  PostConditionMode,
  Cl,
  fetchCallReadOnlyFunction,
  cvToJSON,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC     = process.env.DEPLOYER_MNEMONIC;
const EXECUTE      = process.env.EXECUTE === "true";
const INTERVAL     = parseInt(process.env.INTERVAL_MS    ?? "30000");
const LOAN_MICRO   = parseInt(process.env.LOAN_STX       ?? "50") * 1_000_000;
const MIN_PROFIT   = parseInt(process.env.MIN_PROFIT_MICRO ?? "1000");
const HIRO_API_KEY = process.env.HIRO_API_KEY;

const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_MAINNET;

const BITFLOW_ADDR = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const BITFLOW_POOL = "stableswap-stx-ststx-v-1-2";
const STSTX        = `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token`;
const BITFLOW_LP   = `${BITFLOW_ADDR}.stx-ststx-lp-token-v-1-2`;

if (EXECUTE && !MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC to execute transactions");
  process.exit(1);
}

function hiroFetch(url, opts = {}) {
  if (HIRO_API_KEY && typeof url === "string" && url.includes("hiro.so")) {
    opts = { ...opts, headers: { ...opts?.headers, "x-api-key": HIRO_API_KEY } };
  }
  return globalThis.fetch(url, opts);
}

// -- Read vault stats ----------------------------------------------------------
async function getVaultStats() {
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: DEPLOYER,
      contractName:    "flashstack-yield-vault-v5",
      functionName:    "get-stats",
      functionArgs:    [],
      network,
      senderAddress:   DEPLOYER,
      client: { fetch: hiroFetch },
    });
    return cvToJSON(r)?.value?.value ?? null;
  } catch { return null; }
}

// -- Simulate one arb leg: how much stSTX for (amount) STX --------------------
async function getStSTXForSTX(amountMicro) {
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: BITFLOW_ADDR,
      contractName:    BITFLOW_POOL,
      functionName:    "get-dy",
      functionArgs:    [
        Cl.principal(STSTX),
        Cl.principal(BITFLOW_LP),
        Cl.uint(amountMicro),
      ],
      network,
      senderAddress: DEPLOYER,
      client: { fetch: hiroFetch },
    });
    const json = cvToJSON(r);
    // Returns (ok {dy: uint, ...}) -- extract dy field first, fall back to plain uint
    const val = json?.value?.value?.dy?.value ?? json?.value?.value ?? json?.value;
    return val ? BigInt(val) : null;
  } catch { return null; }
}

// -- Simulate return leg: how much STX for (stSTXAmount) stSTX ----------------
async function getSTXForStSTX(stSTXAmount) {
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: BITFLOW_ADDR,
      contractName:    BITFLOW_POOL,
      functionName:    "get-dx",
      functionArgs:    [
        Cl.principal(STSTX),
        Cl.principal(BITFLOW_LP),
        Cl.uint(stSTXAmount),
      ],
      network,
      senderAddress: DEPLOYER,
      client: { fetch: hiroFetch },
    });
    const json = cvToJSON(r);
    // Returns (ok {dx: uint, ...}) -- extract dx field first, fall back to plain uint
    const val = json?.value?.value?.dx?.value ?? json?.value?.value ?? json?.value;
    return val ? BigInt(val) : null;
  } catch { return null; }
}

// -- Check whether a compound at loan-amount is profitable --------------------
async function checkProfitability(loanMicro) {
  const fee     = BigInt(Math.max(1, Math.floor(loanMicro * 5 / 10000)));
  const owed    = BigInt(loanMicro) + fee;

  const stSTXOut = await getStSTXForSTX(loanMicro);
  if (!stSTXOut || stSTXOut === 0n) return null;

  const stxBack = await getSTXForStSTX(stSTXOut);
  if (!stxBack || stxBack === 0n) return null;

  // Net profit = stxBack - owed
  // We compare stxBack to owed because the vault's own balance covers the rest.
  // The compound() invariant is: spread >= fee, i.e. stxBack >= owed.
  const profit = stxBack - owed;

  return {
    loanMicro,
    stSTXOut,
    stxBack,
    fee,
    owed,
    profit,
    profitable: profit >= BigInt(MIN_PROFIT),
  };
}

// -- Trigger compound: call flash-loan on core with vault as receiver ----------
async function executeCompound(loanMicro) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const nonce  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
    .then(r => r.json()).then(d => d.nonce);

  console.log(`  Triggering vault compound: flash-loan(${loanMicro / 1e6} STX, vault)...`);

  // Keeper calls flash-loan on flashstack-stx-core with the vault as receiver.
  // Core sends STX to vault, calls execute-stx-flash, arb runs, loan repaid,
  // spread stays in vault and increases all depositors' share value.
  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "flash-loan",
    functionArgs:      [
      Cl.uint(loanMicro),
      Cl.principal(`${DEPLOYER}.flashstack-yield-vault-v5`),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               500_000,  // 0.5 STX -- covers flash loan + two Bitflow swaps
  });

  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }

  if (data?.error) {
    console.error(`  FAILED: ${data.error} -- ${data.reason ?? ""}`);
    return null;
  }

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);
  return txid;
}

// -- Main scan ----------------------------------------------------------------
async function scan() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Scanning...`);

  // Vault state
  const stats = await getVaultStats();
  if (stats) {
    const bal        = parseInt(stats["vault-balance"]?.value ?? 0) / 1e6;
    const sharePrice = parseInt(stats["share-price"]?.value ?? 1000000) / 1e6;
    const compounds  = parseInt(stats["compound-count"]?.value ?? 0);
    const compounded = parseInt(stats["total-compounded"]?.value ?? 0) / 1e6;
    console.log(`  Vault balance:    ${bal.toFixed(4)} STX`);
    console.log(`  Share price:      ${sharePrice.toFixed(6)} STX/share`);
    console.log(`  Compounds run:    ${compounds}`);
    console.log(`  Total compounded: ${compounded.toFixed(6)} STX yield`);
  } else {
    console.log("  Vault stats: unavailable (not yet deployed or rate-limited)");
  }

  // Arb check
  const arb = await checkProfitability(LOAN_MICRO);
  if (!arb) {
    console.log("  Bitflow quotes unavailable -- rate-limited or pool paused");
    return;
  }

  const profitSTX  = Number(arb.profit) / 1e6;
  const stSTXOut   = Number(arb.stSTXOut) / 1e6;
  const stxBackSTX = Number(arb.stxBack) / 1e6;

  console.log(`\n  Compound check (loan: ${arb.loanMicro / 1e6} STX)`);
  console.log(`  STX in:       ${arb.loanMicro / 1e6} STX -> ${stSTXOut.toFixed(6)} stSTX`);
  console.log(`  stSTX back:   ${stxBackSTX.toFixed(6)} STX`);
  console.log(`  Flash fee:    ${Number(arb.fee) / 1e6} STX (0.05%)`);
  console.log(`  Net spread:   ${profitSTX.toFixed(6)} STX`);

  if (arb.profitable) {
    console.log(`\n  *** COMPOUND OPPORTUNITY *** +${profitSTX.toFixed(6)} STX yield`);
    console.log(`  stSTX above peg -- calling compound() will grow share price`);
    if (EXECUTE) {
      await executeCompound(arb.loanMicro);
    } else {
      console.log(`  (dry-run -- set EXECUTE=true DEPLOYER_MNEMONIC="..." to execute)`);
    }
  } else {
    const deficit = -profitSTX;
    console.log(`  No opportunity -- deficit ${deficit.toFixed(6)} STX (stSTX at or below peg)`);
    console.log(`  Best window: post-stacking cycle prepare phase (~every 2 weeks)`);
  }
}

async function main() {
  console.log("================================================");
  console.log("  FlashStack Yield Vault -- Compound Monitor");
  console.log("================================================");
  console.log(`  Mode:        ${EXECUTE ? "LIVE EXECUTION" : "dry-run (monitoring only)"}`);
  console.log(`  Vault:       ${DEPLOYER}.flashstack-yield-vault-v5`);
  console.log(`  Loan size:   ${LOAN_MICRO / 1e6} STX per compound cycle`);
  console.log(`  Min profit:  ${MIN_PROFIT} microSTX (${MIN_PROFIT / 1e6} STX)`);
  console.log(`  Interval:    ${INTERVAL / 1000}s`);
  console.log(`\n  Tips:`);
  console.log(`    LOAN_STX=200       -- larger loan = more absolute yield per cycle`);
  console.log(`    MIN_PROFIT_MICRO=5000 -- raise threshold to only compound when profitable`);
  console.log(`    INTERVAL_MS=60000  -- scan every 60s during active cycle windows`);
  console.log(`\n  Watching for stSTX to trade above peg on Bitflow...`);
  console.log(`  Best windows: ~2 days after each stacking cycle reward distribution.\n`);

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
