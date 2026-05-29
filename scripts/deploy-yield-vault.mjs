/**
 * Deploy flashstack-yield-vault-v5 and whitelist it on flashstack-stx-core
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="your 24-word mnemonic" node scripts/deploy-yield-vault.mjs
 *
 * What this does:
 *   1. Deploys flashstack-yield-vault-v5.clar to Stacks mainnet
 *   2. Calls add-approved-receiver on flashstack-stx-core so the vault
 *      can flash-borrow (required for compound() to work)
 *
 * v5 audit fixes: no rescue-stx, deposit cooldown, hardcoded repayment,
 * configurable slippage guard, two-step ownership transfer.
 *
 * After deployment, anyone can:
 *   - deposit(amount)    contribute STX and receive vault shares
 *   - withdraw(shares)   redeem shares for STX + accrued yield
 *
 * To compound (keeper trigger):
 *   call flash-loan(loan-amount, .flashstack-yield-vault-v5) on flashstack-stx-core
 */

import {
  makeContractDeploy,
  makeContractCall,
  PostConditionMode,
  ClarityVersion,
  Cl,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so";
const network  = STACKS_MAINNET;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC");
  process.exit(1);
}

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function getNonce() {
  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function broadcast(tx, label) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON from API: ${text.slice(0, 300)}`); }
  if (data?.error) throw new Error(`${label} failed: ${data.error} -- ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  txid:    ${txid}`);
  console.log(`  explorer: ${EXPLORER}/txid/0x${txid}?chain=mainnet`);
  return txid;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return true; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr ?? data.tx_status}`);
      if (data.vm_error) console.log(`  vm_error: ${data.vm_error}`);
      return false;
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check explorer manually");
  return false;
}

async function main() {
  const pk    = await getPrivateKey();
  let   nonce = await getNonce();

  const acct = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  const bal  = parseInt(acct.balance, 16) / 1e6;

  console.log("\nFlashStack Yield Vault v5 -- Deploy");
  console.log("====================================");
  console.log(`Deployer: ${DEPLOYER}`);
  console.log(`Balance:  ${bal.toFixed(3)} STX`);
  console.log(`Nonce:    ${nonce}\n`);

  if (bal < 3) {
    console.error("Need at least 3 STX (deploy fee ~2.5 STX + whitelist ~0.3 STX)");
    process.exit(1);
  }

  // -- Step 1: Deploy --------------------------------------------------------
  console.log("Step 1: Deploying flashstack-yield-vault-v5...");
  const source = readFileSync("contracts/flashstack-yield-vault-v5.clar", "utf8");

  const deployTx = await makeContractDeploy({
    contractName:      "flashstack-yield-vault-v5",
    codeBody:          source,
    senderKey:         pk,
    network,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               2_500_000,
  });

  const deployTxid = await broadcast(deployTx, "deploy");
  const deployOk   = await waitForConfirm(deployTxid, "deploy");
  if (!deployOk) {
    console.error("\nDeploy failed. Common causes:");
    console.error("  - ContractAlreadyExists: rename to flashstack-yield-vault-v5 and retry");
    console.error("  - Clarity analysis error: check contract source for trait mismatches");
    process.exit(1);
  }

  // -- Step 2: Whitelist on flashstack-stx-core --------------------------------
  // You are the admin of flashstack-stx-core, so this tx succeeds automatically.
  // Without this compound() returns ERR-NOT-APPROVED (err u306).
  console.log("\nStep 2: Whitelisting vault as approved receiver on flashstack-stx-core...");

  const whitelistTx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "add-approved-receiver",
    functionArgs:      [Cl.principal(`${DEPLOYER}.flashstack-yield-vault-v5`)],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               300_000,
  });

  const whitelistTxid = await broadcast(whitelistTx, "whitelist");
  const whitelistOk   = await waitForConfirm(whitelistTxid, "whitelist");
  if (!whitelistOk) {
    console.error("\nWhitelist tx failed. Vault is deployed but compound() will revert.");
    console.error(`Retry: call add-approved-receiver(${DEPLOYER}.flashstack-yield-vault-v5)`);
    console.error(`on flashstack-stx-core via Hiro Explorer.`);
    process.exit(1);
  }

  // -- Done ------------------------------------------------------------------
  const vaultAddr = `${DEPLOYER}.flashstack-yield-vault-v5`;
  console.log("\n================================");
  console.log("Done. Vault v5 is live.");
  console.log(`\nContract: ${vaultAddr}`);
  console.log(`Explorer: ${EXPLORER}/address/${vaultAddr}?chain=mainnet`);
  console.log(`\nNext steps:`);
  console.log(`  1. Seed: call deposit(u5000000) to add 5 STX initial liquidity`);
  console.log(`     node scripts/seed-yield-vault.mjs`);
  console.log(`  2. Compound monitor:`);
  console.log(`       node scripts/monitor-vault-compound.mjs`);
  console.log(`  3. When stSTX > peg, flash-loan fires compound and share price rises`);
  console.log(`\nRead-only calls (Hiro Explorer, no fee):`);
  console.log(`  get-stats           -- balance, shares, share price, compound history`);
  console.log(`  get-share-price     -- current price (starts at u1000000 = 1:1)`);
  console.log(`  get-user-stx-value  -- your position value in microSTX`);
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
