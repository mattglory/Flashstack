/**
 * FlashStack — Deploy LP Oracle, sBTC Pool, and Velar sBTC Arb Receiver
 *
 * Deploys three contracts in sequence:
 *   1. flashstack-pool-oracle    — share price oracle for STX LP (usable by Zest immediately)
 *   2. flashstack-sbtc-pool      — sBTC LP pool with built-in oracle
 *   3. velar-sbtc-arb-receiver   — Velar wSTX<>sBTC arb receiver (pool 70)
 *
 * Then:
 *   4. Whitelists velar-sbtc-arb-receiver in flashstack-sbtc-core
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-lp-oracle-and-sbtc-pool.mjs
 */

import {
  makeContractDeploy,
  makeContractCall,
  serializeTransaction,
  PostConditionMode,
  ClarityVersion,
  Cl,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER  = process.env.DEPLOYER_ADDRESS ?? "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API       = "https://api.hiro.so";
const EXPLORER  = "https://explorer.hiro.so/txid";
const network   = STACKS_MAINNET;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function getNonce() {
  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") {
      console.log(" confirmed.");
      return data;
    }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "unknown";
      console.log(`\n  FAILED: ${reason}`);
      console.log(`  Tx: ${EXPLORER}/${txid}?chain=mainnet`);
      throw new Error(`"${label}" failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}"`);
}

async function broadcast(tx) {
  const serialized = serializeTransaction(tx);
  const res = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body:    serialized,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Node response not JSON: ${text.slice(0, 200)}`); }
  if (data.error) throw new Error(`${data.error} — ${data.reason ?? ""} ${data.reason_data ? JSON.stringify(data.reason_data) : ""}`);
  return data; // { txid: "..." }
}

async function deployContract(privateKey, nonce, name, sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const tx = await makeContractDeploy({
    contractName:      name,
    codeBody:          source,
    senderKey:         privateKey,
    network,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee:               500_000,
    nonce,
  });
  const result = await broadcast(tx);
  console.log(`  Broadcast: ${result.txid}`);
  return result.txid;
}

async function callContract(privateKey, nonce, contractAddress, contractName, fn, args) {
  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName:      fn,
    functionArgs:      args,
    senderKey:         privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee:               100_000,
    nonce,
  });
  const result = await broadcast(tx);
  console.log(`  Broadcast: ${result.txid}`);
  return result.txid;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   FlashStack — LP Oracle + sBTC Pool + Velar Arb    ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Deployer: ${DEPLOYER}\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const results = {};

  // ── Step 1: Deploy flashstack-pool-oracle ─────────────────────────────────
  console.log("Step 1 — Deploy flashstack-pool-oracle");
  console.log("  (Share price oracle for STX LP — usable by Zest immediately)");
  results.oracle = await deployContract(
    privateKey, nonce++,
    "flashstack-pool-oracle",
    "contracts/flashstack-pool-oracle.clar",
  );
  await waitForConfirm(results.oracle, "deploy flashstack-pool-oracle");
  console.log();

  // ── Step 2: Deploy flashstack-sbtc-pool ──────────────────────────────────
  console.log("Step 2 — Deploy flashstack-sbtc-pool");
  console.log("  (sBTC LP pool — depositors earn sBTC yield, oracle built-in)");
  results.sbtcPool = await deployContract(
    privateKey, nonce++,
    "flashstack-sbtc-pool",
    "contracts/flashstack-sbtc-pool.clar",
  );
  await waitForConfirm(results.sbtcPool, "deploy flashstack-sbtc-pool");
  console.log();

  // ── Step 3: Deploy velar-sbtc-arb-receiver ───────────────────────────────
  console.log("Step 3 — Deploy velar-sbtc-arb-receiver");
  console.log("  (Velar wSTX<>sBTC pool 70 — flash-borrow sBTC, arb, repay)");
  results.velarReceiver = await deployContract(
    privateKey, nonce++,
    "velar-sbtc-arb-receiver",
    "contracts/velar-sbtc-arb-receiver.clar",
  );
  await waitForConfirm(results.velarReceiver, "deploy velar-sbtc-arb-receiver");
  const velarAddr = `${DEPLOYER}.velar-sbtc-arb-receiver`;
  console.log();

  // ── Step 4: Whitelist Velar receiver in flashstack-sbtc-core ─────────────
  console.log("Step 4 — Whitelist velar-sbtc-arb-receiver in flashstack-sbtc-core");
  results.whitelist = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-sbtc-core", "add-approved-receiver",
    [Cl.principal(velarAddr)],
  );
  await waitForConfirm(results.whitelist, "add-approved-receiver");
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║              DEPLOYMENT COMPLETE                     ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  ${(`${DEPLOYER}.flashstack-pool-oracle`).padEnd(52)} ║`);
  console.log(`║  ${(`${DEPLOYER}.flashstack-sbtc-pool`).padEnd(52)} ║`);
  console.log(`║  ${velarAddr.padEnd(52)} ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Transactions:                                       ║");
  console.log(`  Oracle:         ${EXPLORER}/${results.oracle}?chain=mainnet`);
  console.log(`  sBTC Pool:      ${EXPLORER}/${results.sbtcPool}?chain=mainnet`);
  console.log(`  Velar Receiver: ${EXPLORER}/${results.velarReceiver}?chain=mainnet`);
  console.log(`  Whitelist:      ${EXPLORER}/${results.whitelist}?chain=mainnet`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Next steps:                                         ║");
  console.log("║  1. Send LP oracle link to Zest — ready to integrate ║");
  console.log("║  2. Seed sBTC pool: call deposit-reserve on sbtc-pool║");
  console.log("║  3. Test Velar arb: call flash-loan on sbtc-core     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
}

main().catch(e => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
