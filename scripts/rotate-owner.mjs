/**
 * rotate-owner.mjs
 * Rotates ownership/admin of all FlashStack mainnet contracts from the
 * exposed deployer wallet to a fresh wallet.
 *
 * SECURITY: Generate the new 24-word mnemonic OFFLINE in a wallet app
 * (Leather/Xverse). Never paste it into a chat, issue, or commit.
 *
 * Designed as 3 steps so the IRREVERSIBLE one-step admin transfers only
 * happen AFTER the new wallet has proven it can sign transactions:
 *
 *   STEP 1 (old wallet signs)
 *     - sends 1 STX to the new wallet (gas for step 2)
 *     - propose-owner(new) on alex-arb-receiver-v5 + flashstack-yield-vault-v5
 *
 *   STEP 2 (new wallet signs)
 *     - accept-ownership on both two-step contracts
 *     - this PROVES the new mnemonic controls NEW_OWNER before step 3
 *
 *   STEP 3 (old wallet signs)
 *     - verifies on-chain that both receivers are now owned by NEW_OWNER
 *     - transfer-admin on flashstack-stx-core, flashstack-stx-pool, flashstack-sbtc-pool
 *     - set-admin on flashstack-sbtc-core
 *     - set-owner on velar-sbtc-arb-receiver
 *     - sweeps remaining STX from the old wallet to NEW_OWNER
 *
 * No transfer path (nothing to rotate, noted for completeness):
 *   - flashstack-pool-oracle, bitflow-arb-receiver, test receivers
 *
 * Usage:
 *   STEP=1 NEW_OWNER=SP... OLD_MNEMONIC="24 words of exposed wallet" node scripts/rotate-owner.mjs
 *   STEP=2 NEW_OWNER=SP... NEW_MNEMONIC="24 words of fresh wallet"   node scripts/rotate-owner.mjs
 *   STEP=3 NEW_OWNER=SP... OLD_MNEMONIC="24 words of exposed wallet" node scripts/rotate-owner.mjs
 */

import {
  makeContractCall, makeSTXTokenTransfer, PostConditionMode, Cl,
  fetchCallReadOnlyFunction, cvToJSON, validateStacksAddress,
  getAddressFromPrivateKey, hexToCV,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const STEP      = process.env.STEP;
const NEW_OWNER = process.env.NEW_OWNER;

const OLD_DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API          = "https://api.hiro.so";
const EXPLORER     = "https://explorer.hiro.so/txid";
const network      = STACKS_MAINNET;
const TX_FEE       = 100_000;          // 0.1 STX per tx
const GAS_FUNDING  = 1_000_000;        // 1 STX sent to new wallet in step 1

// Two-step ownership (propose from old, accept from new)
const TWO_STEP = [
  { name: "alex-arb-receiver-v5",     proposeFn: "propose-owner", acceptFn: "accept-ownership" },
  { name: "flashstack-yield-vault-v5", proposeFn: "propose-owner", acceptFn: "accept-ownership" },
];

// One-step transfers -- IRREVERSIBLE, executed only in step 3
// adminVar = data-var name holding the current admin/owner, used to skip
// contracts already transferred when re-running after a partial failure
const ONE_STEP = [
  { name: "flashstack-stx-core",      fn: "transfer-admin", adminVar: "admin" },
  { name: "flashstack-stx-pool",      fn: "transfer-admin", adminVar: "admin" },
  { name: "flashstack-sbtc-core",     fn: "set-admin",      adminVar: "admin" },
  { name: "flashstack-sbtc-pool",     fn: "transfer-admin", adminVar: "admin" },
  { name: "velar-sbtc-arb-receiver",  fn: "set-owner",      adminVar: "owner" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

// Transient network failures (DNS, reset connections) should not abort the
// rotation mid-sequence -- retry reads up to 5 times with backoff.
async function fetchRetry(url, opts) {
  for (let i = 0; i < 5; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (i === 4) throw e;
      process.stdout.write(` (retrying: ${e.message})`);
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

async function readDataVarPrincipal(contractName, varName) {
  const res = await fetchRetry(`${API}/v2/data_var/${OLD_DEPLOYER}/${contractName}/${varName}?proof=0`);
  const data = await res.json();
  if (!data?.data) return null;
  return cvToJSON(hexToCV(data.data))?.value ?? null;
}

async function broadcast(tx, label) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${label} failed: ${data.error} -- ${data.reason ?? ""}`);
  return typeof data === "string" ? data : data.txid;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const res  = await fetchRetry(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr ?? data.tx_status}`);
      throw new Error(`${label} aborted`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: ${label}`);
}

async function getAccount(addr) {
  const acct = await fetchRetry(`${API}/v2/accounts/${addr}?proof=0`).then(r => r.json());
  return { nonce: acct.nonce, balance: parseInt(acct.balance, 16) };
}

async function signerFromMnemonic(mnemonic, expectedAddr, label) {
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const addr   = getAddressFromPrivateKey(pk, "mainnet");
  if (addr !== expectedAddr) {
    console.error(`ERROR: ${label} mnemonic derives ${addr}, expected ${expectedAddr}.`);
    console.error("Wrong mnemonic, or the wallet uses a non-default derivation path. Aborting -- nothing was broadcast.");
    process.exit(1);
  }
  return pk;
}

async function contractCall(pk, contractName, functionName, args, nonce) {
  const tx = await makeContractCall({
    contractAddress: OLD_DEPLOYER, contractName, functionName,
    functionArgs: args, senderKey: pk, network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1, nonce, fee: TX_FEE,
  });
  const txid = await broadcast(tx, `${contractName}.${functionName}`);
  console.log(`  txid: ${txid}`);
  console.log(`  ${EXPLORER}/0x${txid}?chain=mainnet`);
  await waitForConfirm(txid, `${contractName}.${functionName}`);
}

// Read current owner of the two-step contracts to verify step 2 completed
async function readOwner(contractName) {
  if (contractName === "alex-arb-receiver-v5") {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: OLD_DEPLOYER, contractName, functionName: "get-settings",
      functionArgs: [], network, senderAddress: OLD_DEPLOYER,
    });
    const j = cvToJSON(r);
    return j?.value?.value?.["contract-owner"]?.value ?? null;
  }
  // yield vault has no settings read-only -- read the vault-owner data var directly
  return readDataVarPrincipal(contractName, "vault-owner");
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function step1() {
  const pk = await signerFromMnemonic(process.env.OLD_MNEMONIC, OLD_DEPLOYER, "OLD");
  let { nonce, balance } = await getAccount(OLD_DEPLOYER);
  console.log(`  Old wallet balance: ${(balance / 1e6).toFixed(3)} STX, nonce ${nonce}\n`);

  const needed = GAS_FUNDING + TX_FEE * 3;
  if (balance < needed) {
    console.error(`ERROR: need at least ${(needed / 1e6).toFixed(1)} STX for step 1. Top up the old wallet first.`);
    process.exit(1);
  }

  console.log(`Step 1a -- Funding new wallet with 1 STX for step-2 gas...`);
  const fund = await makeSTXTokenTransfer({
    recipient: NEW_OWNER, amount: GAS_FUNDING, senderKey: pk,
    network, anchorMode: 1, nonce: nonce++, fee: TX_FEE,
  });
  const fundTxid = await broadcast(fund, "gas funding transfer");
  console.log(`  txid: ${fundTxid}`);
  await waitForConfirm(fundTxid, "gas funding transfer");

  for (const c of TWO_STEP) {
    console.log(`\nStep 1b -- ${c.name}.${c.proposeFn}(${NEW_OWNER})...`);
    await contractCall(pk, c.name, c.proposeFn, [Cl.principal(NEW_OWNER)], nonce++);
  }

  console.log("\n=======================================================");
  console.log("  STEP 1 COMPLETE");
  console.log("=======================================================");
  console.log("  Next: run step 2 signed by the NEW wallet:");
  console.log(`    STEP=2 NEW_OWNER=${NEW_OWNER} NEW_MNEMONIC="..." node scripts/rotate-owner.mjs`);
}

async function step2() {
  const pk = await signerFromMnemonic(process.env.NEW_MNEMONIC, NEW_OWNER, "NEW");
  let { nonce, balance } = await getAccount(NEW_OWNER);
  console.log(`  New wallet balance: ${(balance / 1e6).toFixed(3)} STX, nonce ${nonce}\n`);

  if (balance < TX_FEE * 2) {
    console.error("ERROR: new wallet has no gas. Run step 1 first (it sends 1 STX).");
    process.exit(1);
  }

  for (const c of TWO_STEP) {
    console.log(`Step 2 -- ${c.name}.${c.acceptFn}()...`);
    await contractCall(pk, c.name, c.acceptFn, [], nonce++);
    console.log("");
  }

  console.log("=======================================================");
  console.log("  STEP 2 COMPLETE -- new wallet proven, two-step contracts transferred");
  console.log("=======================================================");
  console.log("  Next: run step 3 signed by the OLD wallet:");
  console.log(`    STEP=3 NEW_OWNER=${NEW_OWNER} OLD_MNEMONIC="..." node scripts/rotate-owner.mjs`);
}

async function step3() {
  const pk = await signerFromMnemonic(process.env.OLD_MNEMONIC, OLD_DEPLOYER, "OLD");

  // Refuse to run the irreversible transfers until step 2 is verified on-chain
  console.log("Step 3a -- Verifying step 2 completed on-chain...");
  for (const c of TWO_STEP) {
    const owner = await readOwner(c.name);
    if (owner !== NEW_OWNER) {
      console.error(`ERROR: ${c.name} owner is ${owner}, not ${NEW_OWNER}.`);
      console.error("Step 2 has not confirmed. Aborting -- no one-step transfers were made.");
      process.exit(1);
    }
    console.log(`  ${c.name}: owned by new wallet -- OK`);
  }

  let { nonce, balance } = await getAccount(OLD_DEPLOYER);
  console.log(`\n  Old wallet balance: ${(balance / 1e6).toFixed(3)} STX, nonce ${nonce}`);
  const needed = TX_FEE * (ONE_STEP.length + 1);
  if (balance < needed) {
    console.error(`ERROR: need at least ${(needed / 1e6).toFixed(1)} STX for step 3.`);
    process.exit(1);
  }

  for (const c of ONE_STEP) {
    const current = await readDataVarPrincipal(c.name, c.adminVar);
    if (current === NEW_OWNER) {
      console.log(`\nStep 3b -- ${c.name}: already transferred, skipping.`);
      continue;
    }
    console.log(`\nStep 3b -- ${c.name}.${c.fn}(${NEW_OWNER})...`);
    await contractCall(pk, c.name, c.fn, [Cl.principal(NEW_OWNER)], nonce++);
  }

  console.log("\nStep 3c -- Sweeping remaining STX to new wallet...");
  const { balance: finalBal } = await getAccount(OLD_DEPLOYER);
  const sweepAmount = finalBal - TX_FEE;
  if (sweepAmount > 0) {
    const sweep = await makeSTXTokenTransfer({
      recipient: NEW_OWNER, amount: sweepAmount, senderKey: pk,
      network, anchorMode: 1, nonce: nonce++, fee: TX_FEE,
    });
    const sweepTxid = await broadcast(sweep, "final sweep");
    console.log(`  Sweeping ${(sweepAmount / 1e6).toFixed(6)} STX`);
    console.log(`  txid: ${sweepTxid}`);
    await waitForConfirm(sweepTxid, "final sweep");
  } else {
    console.log("  Nothing left to sweep.");
  }

  console.log("\n=======================================================");
  console.log("  ROTATION COMPLETE");
  console.log("=======================================================");
  console.log(`  All contract ownership/admin moved to: ${NEW_OWNER}`);
  console.log("  Old wallet is drained and holds no roles.");
  console.log("\n  Remember:");
  console.log("  - All scripts now sign with the NEW mnemonic (contracts still live");
  console.log(`    at ${OLD_DEPLOYER}.* -- only the signer changes)`);
  console.log("  - Whitelisting new receivers now requires the new admin wallet");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=======================================================");
  console.log(`  FlashStack -- Ownership Rotation (STEP ${STEP})`);
  console.log("=======================================================");

  if (!["1", "2", "3"].includes(STEP)) {
    console.error("ERROR: set STEP=1, STEP=2, or STEP=3"); process.exit(1);
  }
  if (!NEW_OWNER) {
    console.error("ERROR: NEW_OWNER is not set. The command line may have been mangled by quoting --");
    console.error("export the variables first instead:");
    console.error("  export NEW_OWNER=SP...");
    console.error("  read -s OLD_MNEMONIC   (paste the 24 words, press enter -- input stays hidden)");
    console.error("  export OLD_MNEMONIC");
    console.error("  STEP=1 node scripts/rotate-owner.mjs");
    process.exit(1);
  }
  if (!NEW_OWNER.startsWith("SP") || !validateStacksAddress(NEW_OWNER)) {
    console.error(`ERROR: NEW_OWNER "${NEW_OWNER}" is not a valid mainnet Stacks address.`);
    console.error("Expected: starts with SP, ~41 characters, all uppercase (c32 checksum catches typos).");
    if (NEW_OWNER.startsWith("ST"))  console.error("ST... is a TESTNET address -- switch your wallet to mainnet.");
    if (/^(bc1|3|1)/.test(NEW_OWNER)) console.error("That looks like a BITCOIN address -- use the STX address from your wallet.");
    process.exit(1);
  }
  if (NEW_OWNER === OLD_DEPLOYER) {
    console.error("ERROR: NEW_OWNER is the old deployer. Rotation requires a fresh wallet.");
    process.exit(1);
  }
  if ((STEP === "1" || STEP === "3") && !process.env.OLD_MNEMONIC) {
    console.error("ERROR: STEP " + STEP + " requires OLD_MNEMONIC"); process.exit(1);
  }
  if (STEP === "2" && !process.env.NEW_MNEMONIC) {
    console.error("ERROR: STEP 2 requires NEW_MNEMONIC"); process.exit(1);
  }

  console.log(`  Old deployer: ${OLD_DEPLOYER}`);
  console.log(`  New owner:    ${NEW_OWNER}\n`);

  if (STEP === "1") await step1();
  if (STEP === "2") await step2();
  if (STEP === "3") await step3();
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
