/**
 * FlashStack — Grant Milestone 1 Evidence Script
 *
 * Does three things in sequence:
 *   1. Deploys fixed bitflow-arb-receiver-v2 (as-contract bug fix)
 *   2. Whitelists it in flashstack-stx-core
 *   3. Executes a live flash-loan through it → Bitflow STX/stSTX swap → repay
 *
 * Produces two confirmed mainnet txids as grant evidence:
 *   - DEX receiver deployment
 *   - Flash loan + Bitflow swap round-trip
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 word2 ... word24" \
 *   DEPLOYER_ADDRESS="SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5" \
 *   node scripts/grant-milestone1.mjs
 *
 * The DEPLOYER_ADDRESS must be the admin of flashstack-stx-core.
 */

import {
  makeContractDeploy,
  makeContractCall,
  broadcastTransaction,
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

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = process.env.DEPLOYER_ADDRESS ?? "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";

// Flash loan amount — keep small to stay within reserve
// Reserve is ~80 STX; 10 STX is safe and proves the flow
const LOAN_STX = parseInt(process.env.LOAN_STX ?? "10") * 1_000_000;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC=\"word1 word2 ... word24\"");
  console.error("       This must be the mnemonic for wallet:", DEPLOYER);
  process.exit(1);
}

const network = STACKS_MAINNET;
const API     = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

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
      console.log(" ✓ confirmed.");
      return data;
    }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "unknown";
      console.log(`\n  ✗ FAILED: ${reason}`);
      console.log(`  Tx: ${EXPLORER}/${txid}?chain=mainnet`);
      throw new Error(`"${label}" failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}"`);
}

async function deployContract(privateKey, nonce, name, sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const tx = await makeContractDeploy({
    contractName:   name,
    codeBody:       source,
    senderKey:      privateKey,
    network,
    clarityVersion: ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    fee:   500_000, // 0.5 STX — sufficient for any receiver contract
    nonce,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name} failed: ${result.error} — ${result.reason}`);
  console.log(`  Broadcast: ${result.txid}`);
  return result.txid;
}

async function callContract(privateKey, nonce, contractName, fn, args) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName:    fn,
    functionArgs:    args,
    senderKey:       privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    fee:   50_000, // 0.05 STX
    nonce,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn} failed: ${result.error} — ${result.reason}`);
  console.log(`  Broadcast: ${result.txid}`);
  return result.txid;
}

async function getReserveBalance() {
  const res  = await fetch(`${API}/v2/contracts/call-read/${DEPLOYER}/flashstack-stx-core/get-reserve-balance`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sender: DEPLOYER, arguments: [] }),
  });
  const data = await res.json();
  return data.result ? parseInt(data.result.slice(6), 16) / 1_000_000 : 0;
}

async function isApproved(receiver) {
  // Encode the principal as a Clarity value
  const res = await fetch(`${API}/v2/contracts/call-read/${DEPLOYER}/flashstack-stx-core/is-approved-receiver`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      sender:    DEPLOYER,
      arguments: [Cl.serialize(Cl.principal(receiver)).toString("hex").replace(/^0x/, "0x")],
    }),
  });
  const data = await res.json();
  return data.result?.includes("0703"); // (ok true)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   FlashStack — Grant Milestone 1 Evidence Script     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Deployer: ${DEPLOYER}`);
  console.log(`  Loan:     ${LOAN_STX / 1_000_000} STX`);
  console.log(`  Network:  Stacks Mainnet\n`);

  // Pre-flight checks
  const reserve = await getReserveBalance();
  console.log(`  Reserve balance: ${reserve} STX`);
  if (reserve < LOAN_STX / 1_000_000) {
    console.error(`  ✗ Reserve too low. Need ${LOAN_STX / 1_000_000} STX, have ${reserve}.`);
    process.exit(1);
  }
  console.log(`  ✓ Reserve sufficient\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const results = {};

  // ── Step 1: Deploy bitflow-arb-receiver-v4 ───────────────────────────────
  // v3 fixes: as-contract on swap calls + min-stx=u1 so pool fees don't block
  // the swap. Repayment check is the safety gate; receiver is pre-funded to
  // cover the round-trip DEX fee shortfall (~0.2 STX).
  console.log("Step 1 — Deploy bitflow-arb-receiver-v4");
  const deployTxid = await deployContract(
    privateKey, nonce++,
    "bitflow-arb-receiver-v4",
    "contracts/bitflow-arb-receiver.clar",
  );
  await waitForConfirm(deployTxid, "deploy bitflow-arb-receiver-v4");
  results.deploy = deployTxid;
  const v4Address = `${DEPLOYER}.bitflow-arb-receiver-v4`;
  console.log(`  Contract: ${v4Address}\n`);

  // ── Step 2: Pre-fund receiver with 0.2 STX buffer ────────────────────────
  // The Bitflow round-trip costs ~0.1-0.3% in pool fees. Without a buffer,
  // the receiver can't repay the full loan + flash fee. 0.2 STX covers this.
  console.log("Step 2 — Pre-fund bitflow-arb-receiver-v4 with 0.2 STX (DEX fee buffer)");
  const BUFFER_STX = 200_000; // 0.2 STX in microstacks
  const { makeSTXTokenTransfer } = await import("@stacks/transactions");
  const fundTxReal = await makeSTXTokenTransfer({
    recipient: v4Address,
    amount:    BUFFER_STX,
    senderKey: privateKey,
    network,
    anchorMode: 1,
    fee:   10_000, // 0.01 STX
    nonce: nonce++,
  });
  const fundResult = await broadcastTransaction({ transaction: fundTxReal, network });
  if (fundResult.error) throw new Error(`Fund receiver failed: ${fundResult.error}`);
  console.log(`  Broadcast: ${fundResult.txid}`);
  await waitForConfirm(fundResult.txid, "fund receiver");
  results.fund = fundResult.txid;
  console.log();

  // ── Step 3: Whitelist in flashstack-stx-core ──────────────────────────────
  console.log("Step 3 — Whitelist bitflow-arb-receiver-v4 in flashstack-stx-core");
  const whitelistTxid = await callContract(
    privateKey, nonce++,
    "flashstack-stx-core", "add-approved-receiver",
    [Cl.principal(v4Address)],
  );
  await waitForConfirm(whitelistTxid, "add-approved-receiver");
  results.whitelist = whitelistTxid;
  console.log();

  // ── Step 4: Execute flash loan through Bitflow receiver ───────────────────
  console.log(`Step 4 — Execute flash-loan(${LOAN_STX / 1_000_000} STX, bitflow-arb-receiver-v4)`);
  console.log("  Flow: flashstack-stx-core → STX → Bitflow swap-x-for-y → stSTX");
  console.log("        → Bitflow swap-y-for-x → STX → repay core + 0.05% fee");
  const flashTxid = await callContract(
    privateKey, nonce++,
    "flashstack-stx-core", "flash-loan",
    [
      Cl.uint(LOAN_STX),
      Cl.principal(v4Address),
    ],
  );
  await waitForConfirm(flashTxid, "flash-loan via Bitflow");
  results.flashLoan = flashTxid;

  // ── Evidence summary ──────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║              GRANT EVIDENCE — COPY THESE             ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  Contract deployed:                                   ║`);
  console.log(`║  ${v4Address.padEnd(52)} ║`);
  console.log("║                                                      ║");
  console.log(`║  DEX used: Bitflow STX/stSTX stableswap              ║`);
  console.log(`║  SPQC38PW...stableswap-stx-ststx-v-1-2               ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Transaction links:                                   ║");
  console.log(`║                                                      ║`);
  console.log(`║  1. Deploy receiver:                                  ║`);
  console.log(`║  ${EXPLORER}/${results.deploy}?chain=mainnet`);
  console.log(`║                                                      ║`);
  console.log(`║  2. Flash loan + Bitflow swap (KEY EVIDENCE):         ║`);
  console.log(`║  ${EXPLORER}/${results.flashLoan}?chain=mainnet`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n  Flow proven:");
  console.log("  ✓ Flash loan borrowed from flashstack-stx-core reserve");
  console.log("  ✓ STX swapped to stSTX on Bitflow (live DEX)");
  console.log("  ✓ stSTX swapped back to STX on Bitflow");
  console.log("  ✓ Principal + 0.05% fee repaid to core");
  console.log("  ✓ Transaction succeeded on Stacks Mainnet");
}

main().catch(e => {
  console.error("\n✗ FAILED:", e.message);
  process.exit(1);
});
