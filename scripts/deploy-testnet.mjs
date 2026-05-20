/**
 * FlashStack — Testnet Deployment + Flash Loan Evidence
 *
 * Deploys the STX flash loan system to Stacks testnet and executes a real
 * flash loan, producing on-chain testnet txids as evidence.
 *
 * Setup:
 *   1. Get a testnet wallet address (any fresh Stacks wallet)
 *   2. Fund it at: https://explorer.hiro.so/sandbox/faucet?chain=testnet
 *      (1000 STX per request — run 3-4 times to cover deploy fees + reserve)
 *   3. Run:
 *      TESTNET_MNEMONIC="word1 ... word24" node scripts/deploy-testnet.mjs
 *      (testnet address is derived automatically from the mnemonic)
 *
 * Note on sBTC:
 *   The canonical sBTC token (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
 *   only exists on mainnet. This script deploys the STX flash loan system only.
 *   STX flash loans demonstrate the full protocol end-to-end on testnet.
 *
 * Deploys in order:
 *   1. stx-flash-receiver-trait    — trait interface
 *   2. flashstack-stx-core         — flash loan engine
 *   3. flashstack-stx-pool         — LP pool (fee accumulation)
 *   4. flashstack-pool-oracle      — share price oracle (Zest integration)
 *   5. stx-test-receiver           — minimal borrow-and-repay receiver
 *   Then: whitelist receiver → fund reserve → execute flash loan → evidence
 */

import {
  makeContractDeploy,
  makeContractCall,
  makeSTXTokenTransfer,
  PostConditionMode,
  ClarityVersion,
  Cl,
  getAddressFromPrivateKey,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_TESTNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const MNEMONIC  = process.env.TESTNET_MNEMONIC;
const API       = "https://api.testnet.hiro.so";
const EXPLORER  = "https://explorer.hiro.so/txid";
const network   = STACKS_TESTNET;

// How much STX to deposit as flash loan reserve (50 STX = 50_000_000 microSTX)
const RESERVE_AMOUNT = 50_000_000;

// stx-test-receiver repays principal + the 0.05% fee from its OWN balance, so a
// freshly deployed receiver (0 STX) cannot cover the fee and the flash loan
// reverts with (err u500). Seed it with a small amount first. (1 STX = 1_000_000)
const RECEIVER_SEED_AMOUNT = 1_000_000;

// ── Mainnet addresses that must be replaced for testnet ────────────────────────
// These are hardcoded in contracts as use-trait / impl-trait / constant references.
const MAINNET_ADDRS = [
  "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ", // old deployer (stx-flash-receiver-trait)
  "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5", // current deployer (sbtc-flash-receiver-trait, pool)
];

if (!MNEMONIC) {
  console.error("ERROR: Set TESTNET_MNEMONIC");
  console.error("");
  console.error("  TESTNET_MNEMONIC=\"word1 ... word24\" node scripts/deploy-testnet.mjs");
  console.error("");
  console.error("  Fund your testnet address first:");
  console.error("  https://explorer.hiro.so/sandbox/faucet?chain=testnet");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

// Derives testnet address from private key (same approach as generateWallet uses internally)
function deriveTestnetAddress(privateKey) {
  return getAddressFromPrivateKey(privateKey, STACKS_TESTNET);
}

function patchSource(source, deployerAddress) {
  // Replace all mainnet addresses with the testnet deployer address so
  // use-trait / impl-trait / constant references resolve correctly on testnet.
  let patched = source;
  for (const addr of MAINNET_ADDRS) {
    patched = patched.replaceAll(addr, deployerAddress);
  }
  return patched;
}

async function getNonce(deployer) {
  const res  = await fetch(`${API}/v2/accounts/${deployer}?proof=0`);
  const data = await res.json();
  if (!data.nonce && data.nonce !== 0) {
    throw new Error(`Could not fetch nonce for ${deployer}. Is the address funded?\n  Fund at: https://explorer.hiro.so/sandbox/faucet?chain=testnet`);
  }
  return data.nonce;
}

async function getBalance(deployer) {
  const res  = await fetch(`${API}/v2/accounts/${deployer}?proof=0`);
  const data = await res.json();
  return BigInt(data.balance ?? "0x0");
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
      console.log(`  Tx: ${EXPLORER}/${txid}?chain=testnet`);
      throw new Error(`"${label}" failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}"`);
}

async function broadcast(tx) {
  const raw   = tx.serialize();
  const bytes = typeof raw === "string"
    ? Buffer.from(raw.replace(/^0x/, ""), "hex")
    : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body:    bytes,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Node response not JSON: ${text.slice(0, 200)}`); }
  if (typeof data === "object" && data.error) {
    throw new Error(`${data.error} — ${data.reason ?? ""} ${data.reason_data ? JSON.stringify(data.reason_data) : ""}`);
  }
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  return txid;
}

async function deployContract(privateKey, nonce, name, sourcePath, deployer) {
  const raw    = readFileSync(sourcePath, "utf8");
  const source = patchSource(raw, deployer);
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
  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=testnet`);
  return txid;
}

async function callContract(privateKey, nonce, contractAddress, contractName, fn, args, fee = 100_000, deployer) {
  const tx = await makeContractCall({
    contractAddress,
    contractName,
    functionName:      fn,
    functionArgs:      args,
    senderKey:         privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee,
    nonce,
  });
  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=testnet`);
  return txid;
}

async function transferStx(privateKey, nonce, recipient, amount, fee = 10_000) {
  const tx = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey:  privateKey,
    network,
    anchorMode: 1,
    fee,
    nonce,
    memo:       "seed receiver fee",
  });
  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=testnet`);
  return txid;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Derive deployer address from mnemonic
  const privateKey = await getPrivateKey();
  const DEPLOYER   = deriveTestnetAddress(privateKey);

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       FlashStack — Testnet Deployment                ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Network:  testnet (https://api.testnet.hiro.so)`);
  console.log(`  Deployer: ${DEPLOYER}`);
  console.log(`  Explorer: https://explorer.hiro.so/address/${DEPLOYER}?chain=testnet`);
  console.log();

  // Pre-flight: balance check
  const balanceMicro = await getBalance(DEPLOYER);
  const balanceSTX   = Number(balanceMicro) / 1_000_000;
  console.log(`  Balance: ${balanceSTX.toFixed(2)} STX`);
  if (balanceMicro < BigInt(5_000_000_000)) {
    console.warn("  WARNING: Balance is below 5000 STX. Deploy fees + reserve require ~3000 STX.");
    console.warn(`  Fund at: https://explorer.hiro.so/sandbox/faucet?chain=testnet`);
    console.warn(`  Address to fund: ${DEPLOYER}`);
    console.warn("  (Run faucet 3-4 times, then re-run this script)");
    if (balanceMicro < BigInt(500_000_000)) {
      console.error("  ERROR: Insufficient balance to proceed.");
      process.exit(1);
    }
  }
  console.log();

  let nonce = await getNonce(DEPLOYER);
  console.log(`  Starting nonce: ${nonce}\n`);

  const results = {};

  // ── Step 1: stx-flash-receiver-trait ─────────────────────────────────────
  console.log("Step 1 — Deploy stx-flash-receiver-trait");
  console.log("  (Defines the interface all STX flash receivers must implement)");
  results.trait = await deployContract(
    privateKey, nonce++,
    "stx-flash-receiver-trait",
    "contracts/stx-flash-receiver-trait.clar",
    DEPLOYER,
  );
  await waitForConfirm(results.trait, "deploy stx-flash-receiver-trait");
  console.log();

  // ── Step 2: flashstack-stx-core ──────────────────────────────────────────
  console.log("Step 2 — Deploy flashstack-stx-core");
  console.log("  (Flash loan engine — reserve model, whitelist, 0.05% fee)");
  results.core = await deployContract(
    privateKey, nonce++,
    "flashstack-stx-core",
    "contracts/flashstack-stx-core.clar",
    DEPLOYER,
  );
  await waitForConfirm(results.core, "deploy flashstack-stx-core");
  console.log();

  // ── Step 3: flashstack-stx-pool ──────────────────────────────────────────
  console.log("Step 3 — Deploy flashstack-stx-pool");
  console.log("  (LP pool — external depositors earn yield from flash loan fees)");
  results.pool = await deployContract(
    privateKey, nonce++,
    "flashstack-stx-pool",
    "contracts/flashstack-stx-pool.clar",
    DEPLOYER,
  );
  await waitForConfirm(results.pool, "deploy flashstack-stx-pool");
  console.log();

  // ── Step 4: flashstack-pool-oracle ───────────────────────────────────────
  console.log("Step 4 — Deploy flashstack-pool-oracle");
  console.log("  (Share price oracle — Zest LP-as-collateral integration target)");
  results.oracle = await deployContract(
    privateKey, nonce++,
    "flashstack-pool-oracle",
    "contracts/flashstack-pool-oracle.clar",
    DEPLOYER,
  );
  await waitForConfirm(results.oracle, "deploy flashstack-pool-oracle");
  console.log();

  // ── Step 5: stx-test-receiver ────────────────────────────────────────────
  console.log("Step 5 — Deploy stx-test-receiver");
  console.log("  (Minimal receiver: borrow STX, repay principal + fee atomically)");
  results.receiver = await deployContract(
    privateKey, nonce++,
    "stx-test-receiver",
    "contracts/stx-test-receiver.clar",
    DEPLOYER,
  );
  await waitForConfirm(results.receiver, "deploy stx-test-receiver");
  console.log();

  // ── Step 6: Whitelist test receiver in stx-core ──────────────────────────
  console.log("Step 6 — Whitelist stx-test-receiver in flashstack-stx-core");
  results.whitelist = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-stx-core", "add-approved-receiver",
    [Cl.principal(`${DEPLOYER}.stx-test-receiver`)],
  );
  await waitForConfirm(results.whitelist, "add-approved-receiver");
  console.log();

  // ── Step 7: Fund reserve with testnet STX ────────────────────────────────
  const reserveSTX = RESERVE_AMOUNT / 1_000_000;
  console.log(`Step 7 — Fund flashstack-stx-core reserve with ${reserveSTX} testnet STX`);
  results.fund = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-stx-core", "deposit-reserve",
    [Cl.uint(RESERVE_AMOUNT)],
    200_000,
  );
  await waitForConfirm(results.fund, "deposit-reserve");
  console.log();

  // ── Step 8: Seed the receiver so it can pay the flash loan fee ────────────
  const seedSTX = RECEIVER_SEED_AMOUNT / 1_000_000;
  console.log(`Step 8 — Seed stx-test-receiver with ${seedSTX} testnet STX`);
  console.log("  (Receiver repays principal + 0.05% fee from its own balance; without");
  console.log("   this, a fresh receiver has 0 STX and the flash loan fails with err u500)");
  results.seed = await transferStx(
    privateKey, nonce++,
    `${DEPLOYER}.stx-test-receiver`,
    RECEIVER_SEED_AMOUNT,
  );
  await waitForConfirm(results.seed, "seed stx-test-receiver");
  console.log();

  // ── Step 9: Execute test flash loan ──────────────────────────────────────
  // Borrow 10 STX (10_000_000 microSTX) via stx-test-receiver
  const LOAN_AMOUNT = 10_000_000; // 10 STX
  console.log(`Step 9 — Execute flash loan: borrow ${LOAN_AMOUNT / 1_000_000} STX via stx-test-receiver`);
  console.log("  (This is the testnet evidence txid — atomic borrow + repay in one tx)");
  results.flashLoan = await callContract(
    privateKey, nonce++,
    DEPLOYER, "flashstack-stx-core", "flash-loan",
    [
      Cl.uint(LOAN_AMOUNT),
      Cl.principal(`${DEPLOYER}.stx-test-receiver`),
    ],
    200_000,
  );
  await waitForConfirm(results.flashLoan, "flash-loan (testnet evidence)");
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║           TESTNET DEPLOYMENT COMPLETE                ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  Deployer: ${DEPLOYER.padEnd(42)} ║`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Contracts:                                          ║");
  console.log(`  stx-flash-receiver-trait: ${EXPLORER}/${results.trait}?chain=testnet`);
  console.log(`  flashstack-stx-core:      ${EXPLORER}/${results.core}?chain=testnet`);
  console.log(`  flashstack-stx-pool:      ${EXPLORER}/${results.pool}?chain=testnet`);
  console.log(`  flashstack-pool-oracle:   ${EXPLORER}/${results.oracle}?chain=testnet`);
  console.log(`  stx-test-receiver:        ${EXPLORER}/${results.receiver}?chain=testnet`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Actions:                                            ║");
  console.log(`  Whitelist receiver:       ${EXPLORER}/${results.whitelist}?chain=testnet`);
  console.log(`  Fund reserve (${reserveSTX} STX):  ${EXPLORER}/${results.fund}?chain=testnet`);
  console.log(`  Seed receiver (${seedSTX} STX):    ${EXPLORER}/${results.seed}?chain=testnet`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  TESTNET FLASH LOAN EVIDENCE:                        ║");
  console.log(`  Flash loan (10 STX):      ${EXPLORER}/${results.flashLoan}?chain=testnet`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Address activity (all txids):                       ║");
  console.log(`  https://explorer.hiro.so/address/${DEPLOYER}?chain=testnet`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log();
  console.log("Next steps:");
  console.log("  1. Add testnet txids to README.md testnet section");
  console.log("  2. Share flash loan txid as testnet evidence with grant reviewers");
  console.log("  3. Seed the LP pool: call deposit on flashstack-stx-pool");
}

main().catch(e => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
