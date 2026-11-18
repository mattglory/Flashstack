/**
 * FlashStack Flash Loan Executor
 * Waits for each transaction to confirm before sending the next.
 *
 * Usage:
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC   # hidden input; never type it inline
 *   DEPLOYER_ADDRESS="ST..." NETWORK=testnet node scripts/run-flash-loans.mjs                 # dry run
 *   DEPLOYER_ADDRESS="ST..." NETWORK=testnet EXECUTE=true node scripts/run-flash-loans.mjs    # broadcast
 *   (mainnet broadcast also needs --yes-mainnet)
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  — BIP-39 mnemonic for the deployer wallet (required)
 *   DEPLOYER_ADDRESS   — STX address matching the mnemonic (required, checked)
 *   NETWORK            — "mainnet" or "testnet" (required; no default)
 *   EXECUTE            — "true" to broadcast; default is a dry run
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_TESTNET, STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, describeGate, assertSigner, resolveNetwork, sendOrDryRun } from "./lib/safe-signer.mjs";

const DEPLOYER = process.env.DEPLOYER_ADDRESS;
const NET = resolveNetwork(process.env); // throws unless NETWORK=mainnet|testnet
const GATE = broadcastGate({ network: NET });

if (!DEPLOYER) {
  console.error("ERROR: Set DEPLOYER_ADDRESS (and DEPLOYER_MNEMONIC, loaded with: read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC).");
  process.exit(1);
}
const MNEMONIC = await loadMnemonic("DEPLOYER_MNEMONIC");

const network = { mainnet: STACKS_MAINNET, testnet: STACKS_TESTNET }[NET]; // NET is already validated
const API = { mainnet: "https://api.hiro.so", testnet: "https://api.testnet.hiro.so" }[NET];

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk = wallet.accounts[0].stxPrivateKey;
  assertSigner(privateKeyToAddress(pk, NET), DEPLOYER);
  return pk;
}

async function getNonce() {
  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function waitForConfirm(txid, label) {
  if (!txid) return true; // dry run: nothing was sent
  process.stdout.write(`  Waiting for ${label} to confirm`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000)); // wait 10s per attempt
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") {
      console.log(" confirmed.");
      return true;
    }
    if (data.tx_status === "abort_by_response" || data.tx_status === "abort_by_post_condition") {
      const result = data.tx_result?.repr || "";
      console.log(` FAILED: ${result}`);
      throw new Error(`Transaction ${label} failed: ${result}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function callContract(privateKey, nonce, contractName, functionName, args) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs: args,
    senderKey: privateKey,
    network,
    // safe-signer: allow-mode shared helper; flash-mint mints and moves sBTC through the receiver
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
  });
  if (!GATE.broadcast) return sendOrDryRun(GATE, tx, `${contractName}.${functionName}`);
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Broadcast failed: ${result.error} — ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack Flash Loan Executor");
  console.log("==============================");
  console.log(`Network:  ${NET}`);
  console.log(`Mode:     ${describeGate(GATE)}`);
  console.log(`Deployer: ${DEPLOYER}\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`Starting nonce: ${nonce}\n`);

  // Step 1: Authorize flashstack-core as flash minter
  console.log("Step 1: Authorizing flashstack-core as flash minter...");
  const tx1 = await callContract(privateKey, nonce++, "sbtc-token", "set-flash-minter", [
    Cl.principal(`${DEPLOYER}.flashstack-core`),
  ]);
  console.log(`  txid: ${tx1}`);
  await waitForConfirm(tx1, "set-flash-minter");

  // Step 2: Whitelist test-receiver
  console.log("Step 2: Whitelisting test-receiver...");
  const tx2 = await callContract(privateKey, nonce++, "flashstack-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${tx2}`);
  await waitForConfirm(tx2, "add-approved-receiver");

  // Step 3: Set test collateral (30,000 STX)
  console.log("Step 3: Setting test collateral (30,000 STX for deployer)...");
  const tx3 = await callContract(privateKey, nonce++, "flashstack-core", "set-test-stx-locked", [
    Cl.principal(DEPLOYER),
    Cl.uint(30000000000),
  ]);
  console.log(`  txid: ${tx3}`);
  await waitForConfirm(tx3, "set-test-stx-locked");

  // Flash Loan 1: 0.01 sBTC — test-receiver
  console.log("\nFlash Loan #1: 0.01 sBTC via test-receiver...");
  const fl1 = await callContract(privateKey, nonce++, "flashstack-core", "flash-mint", [
    Cl.uint(1000000),
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${fl1}`);
  await waitForConfirm(fl1, "flash-mint #1");

  // Flash Loan 2: 0.05 sBTC — test-receiver
  console.log("Flash Loan #2: 0.05 sBTC via test-receiver...");
  const fl2 = await callContract(privateKey, nonce++, "flashstack-core", "flash-mint", [
    Cl.uint(5000000),
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${fl2}`);
  await waitForConfirm(fl2, "flash-mint #2");

  // Flash Loan 3: 0.10 sBTC — dex-aggregator-receiver (ARBITRAGE execution)
  console.log("Flash Loan #3: 0.10 sBTC via dex-aggregator-receiver (arbitrage)...");

  // Whitelist the dex-aggregator-receiver
  console.log("  Whitelisting dex-aggregator-receiver...");
  const wl2 = await callContract(privateKey, nonce++, "flashstack-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.dex-aggregator-receiver`),
  ]);
  console.log(`  txid: ${wl2}`);
  await waitForConfirm(wl2, "whitelist dex-aggregator-receiver");

  const fl3 = await callContract(privateKey, nonce++, "flashstack-core", "flash-mint", [
    Cl.uint(10000000),
    Cl.principal(`${DEPLOYER}.dex-aggregator-receiver`),
  ]);
  console.log(`  txid: ${fl3}`);
  await waitForConfirm(fl3, "flash-mint #3 (arbitrage)");

  const explorer = NET === "testnet"
    ? "https://explorer.hiro.so/txid"
    : "https://explorer.hiro.so/txid";
  const chainParam = NET === "testnet" ? "?chain=testnet" : "";

  console.log("\n======================================");
  console.log("FLASH LOAN EVIDENCE - SAVE THESE LINKS");
  console.log("======================================");
  console.log(`Flash Loan 1: ${explorer}/${fl1}${chainParam}`);
  console.log(`Flash Loan 2: ${explorer}/${fl2}${chainParam}`);
  console.log(`Flash Loan 3 (arbitrage): ${explorer}/${fl3}${chainParam}`);
  console.log("======================================");
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
