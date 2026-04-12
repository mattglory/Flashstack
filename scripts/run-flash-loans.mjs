/**
 * FlashStack Testnet Flash Loan Executor
 * Waits for each transaction to confirm before sending the next.
 *
 * Usage: node scripts/run-flash-loans.mjs
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_TESTNET, STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = "embrace denial purse peace alone insect ranch install milk upon switch exclude carry spot merge pizza increase fancy quarter glide country disorder fabric ability";
const DEPLOYER = "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ";
const network = STACKS_MAINNET;
const API = "https://api.hiro.so";

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function getNonce() {
  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function waitForConfirm(txid, label) {
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
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Broadcast failed: ${result.error} — ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack Testnet Flash Loan Executor");
  console.log("======================================");
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

  // Whitelist the dex-aggregator-receiver for the arbitrage execution
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

  console.log("\n======================================");
  console.log("MILESTONE 2 EVIDENCE - SAVE THESE LINKS");
  console.log("======================================");
  console.log(`Flash Loan 1: https://explorer.hiro.so/txid/${fl1}`);
  console.log(`Flash Loan 2: https://explorer.hiro.so/txid/${fl2}`);
  console.log(`Flash Loan 3 (arbitrage): https://explorer.hiro.so/txid/${fl3}`);
  console.log("======================================");
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
