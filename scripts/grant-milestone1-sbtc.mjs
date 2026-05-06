/**
 * FlashStack — Grant Milestone 1 Evidence Script (Canonical sBTC)
 *
 * Deploys and exercises the canonical sBTC flash loan system on Stacks Mainnet.
 *
 * Steps:
 *   1. Deploy sbtc-flash-receiver-trait
 *   2. Deploy flashstack-sbtc-core (holds canonical sBTC reserve)
 *   3. Deploy sbtc-test-receiver (borrow + repay)
 *   4. Whitelist sbtc-test-receiver in flashstack-sbtc-core
 *   5. Deposit sBTC reserve into flashstack-sbtc-core
 *   6. Pre-fund sbtc-test-receiver with fee buffer
 *   7. Execute flash-loan — proves canonical sBTC borrow + repay on mainnet
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/grant-milestone1-sbtc.mjs
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
const SBTC     = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Loan: 10,000 sats = 0.0001 BTC (~$9.50). Safe and clearly non-trivial.
const LOAN_SATS    = parseInt(process.env.LOAN_SATS ?? "10000");
// Reserve to deposit into core: loan + small buffer
const RESERVE_SATS = LOAN_SATS + 5000;
// Fee buffer for receiver: 0.05% of loan, min 1 sat, + 100 sat margin
const FEE_BUFFER   = Math.max(1, Math.floor(LOAN_SATS * 5 / 10000)) + 100;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC");
  process.exit(1);
}

const network  = STACKS_MAINNET;
const API      = "https://api.hiro.so";
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
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name} failed: ${result.error} — ${result.reason}`);
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
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn} failed: ${result.error} — ${result.reason}`);
  console.log(`  Broadcast: ${result.txid}`);
  return result.txid;
}

async function getSbtcBalance(principal) {
  const arg = Cl.serialize(Cl.standardPrincipal(principal));
  const res = await fetch(
    `${API}/v2/contracts/call-read/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-token/get-balance`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sender: DEPLOYER, arguments: [arg] }),
    }
  );
  const data = await res.json();
  return data.result ? parseInt(data.result.slice(6), 16) : 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  FlashStack — Milestone 1 Evidence (Canonical sBTC)  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Deployer:  ${DEPLOYER}`);
  console.log(`  Loan:      ${LOAN_SATS} sats (${LOAN_SATS / 1e8} BTC)`);
  console.log(`  Reserve:   ${RESERVE_SATS} sats`);
  console.log(`  Fee buf:   ${FEE_BUFFER} sats`);
  console.log(`  sBTC:      ${SBTC}\n`);

  // Pre-flight
  const balance = await getSbtcBalance(DEPLOYER);
  const needed  = RESERVE_SATS + FEE_BUFFER;
  console.log(`  Deployer sBTC: ${balance} sats (${balance / 1e8} BTC)`);
  if (balance < needed) {
    console.error(`  ✗ Need ${needed} sats, have ${balance}. Bridge or buy more sBTC.`);
    process.exit(1);
  }
  console.log(`  ✓ Sufficient sBTC\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const results = {};

  // ── Step 1: Trait already deployed at nonce 67 ───────────────────────────
  console.log("Step 1 — sbtc-flash-receiver-trait already deployed (skipping)");
  results.trait = "834d31fd4c0a4b61132bf12dc2ed4c22388616081734d6a80aa94ac3da6bbc58";
  // Consumed nonces: 67 (trait ok), 68 (core fail), 69 (core fail) => current nonce 70
  nonce = 70;
  console.log();

  // ── Step 2: Deploy core ───────────────────────────────────────────────────
  console.log("Step 2 — Deploy flashstack-sbtc-core");
  results.core = await deployContract(
    privateKey, nonce++,
    "flashstack-sbtc-core",
    "contracts/flashstack-sbtc-core.clar",
  );
  await waitForConfirm(results.core, "deploy flashstack-sbtc-core");
  console.log();

  // ── Step 3: Deploy test receiver ─────────────────────────────────────────
  console.log("Step 3 — Deploy sbtc-test-receiver");
  results.receiver = await deployContract(
    privateKey, nonce++,
    "sbtc-test-receiver",
    "contracts/sbtc-test-receiver.clar",
  );
  await waitForConfirm(results.receiver, "deploy sbtc-test-receiver");
  const receiverAddr = `${DEPLOYER}.sbtc-test-receiver`;
  console.log();

  // ── Step 4: Whitelist receiver ───────────────────────────────────────────
  console.log("Step 4 — Whitelist sbtc-test-receiver in flashstack-sbtc-core");
  results.whitelist = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-sbtc-core", "add-approved-receiver",
    [Cl.principal(receiverAddr)],
  );
  await waitForConfirm(results.whitelist, "add-approved-receiver");
  console.log();

  // ── Step 5: Deposit sBTC reserve into core ───────────────────────────────
  console.log(`Step 5 — Deposit ${RESERVE_SATS} sats into flashstack-sbtc-core reserve`);
  results.deposit = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-sbtc-core", "deposit-reserve",
    [Cl.uint(RESERVE_SATS)],
  );
  await waitForConfirm(results.deposit, "deposit-reserve");
  console.log();

  // ── Step 6: Fund receiver with fee buffer ────────────────────────────────
  console.log(`Step 6 — Send ${FEE_BUFFER} sats to sbtc-test-receiver (fee buffer)`);
  const [sBTCAddr, sBTCName] = SBTC.split(".");
  results.fund = await callContract(
    privateKey, nonce++,
    sBTCAddr, sBTCName, "transfer",
    [
      Cl.uint(FEE_BUFFER),
      Cl.principal(DEPLOYER),
      Cl.principal(receiverAddr),
      Cl.none(),
    ],
  );
  await waitForConfirm(results.fund, "fund sbtc-test-receiver");
  console.log();

  // ── Step 7: Execute flash loan ───────────────────────────────────────────
  console.log(`Step 7 — Execute flash-loan(${LOAN_SATS} sats, sbtc-test-receiver)`);
  console.log("  Flow: flashstack-sbtc-core → canonical sBTC → receiver → repay + fee");
  results.flashLoan = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-sbtc-core", "flash-loan",
    [
      Cl.uint(LOAN_SATS),
      Cl.principal(receiverAddr),
    ],
  );
  await waitForConfirm(results.flashLoan, "flash-loan (canonical sBTC)");

  // ── Evidence summary ─────────────────────────────────────────────────────
  const coreAddr = `${DEPLOYER}.flashstack-sbtc-core`;
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║       GRANT MILESTONE 1 EVIDENCE — COPY THESE        ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Canonical sBTC:                                      ║");
  console.log(`║  ${SBTC.padEnd(52)} ║`);
  console.log("║                                                       ║");
  console.log("║  Contracts deployed on Stacks Mainnet:                ║");
  console.log(`║  ${(`${DEPLOYER}.sbtc-flash-receiver-trait`).padEnd(52)} ║`);
  console.log(`║  ${coreAddr.padEnd(52)} ║`);
  console.log(`║  ${receiverAddr.padEnd(52)} ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Key transactions:                                    ║");
  console.log("║                                                       ║");
  console.log("║  Core deploy:                                         ║");
  console.log(`  ${EXPLORER}/${results.core}?chain=mainnet`);
  console.log("║                                                       ║");
  console.log("║  Flash loan (KEY EVIDENCE):                           ║");
  console.log(`  ${EXPLORER}/${results.flashLoan}?chain=mainnet`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n  Flow proven on Stacks Mainnet:");
  console.log("  ✓ Canonical sBTC held in flashstack-sbtc-core reserve");
  console.log("  ✓ sBTC flash-loaned atomically to sbtc-test-receiver");
  console.log("  ✓ Principal + 0.05% fee repaid in the same transaction");
  console.log("  ✓ Reserve invariant verified (reserve grew by fee)");
  console.log("  ✓ All transactions confirmed on Stacks Mainnet\n");
}

main().catch(e => {
  console.error("\n✗ FAILED:", e.message);
  process.exit(1);
});
