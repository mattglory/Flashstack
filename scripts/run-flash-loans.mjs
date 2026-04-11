/**
 * FlashStack Testnet Flash Loan Executor
 * Runs 3 flash loans for Milestone 1 evidence
 *
 * Usage: node scripts/run-flash-loans.mjs
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_TESTNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = "REDACTED";
const DEPLOYER = "STX0KBBP3T4QRBTWHYA15VEKYVKNWW722EGZ2TEM";
const network = STACKS_TESTNET;

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const account = wallet.accounts[0];
  return account.stxPrivateKey;
}

async function callContract(privateKey, contractName, functionName, args) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs: args,
    senderKey: privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  return result;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("FlashStack Testnet Flash Loan Executor");
  console.log("======================================");

  const privateKey = await getPrivateKey();
  console.log(`Deployer: ${DEPLOYER}\n`);

  // Step 1: Authorize flashstack-core as flash minter
  console.log("Step 1: Authorizing flashstack-core as flash minter...");
  const r1 = await callContract(privateKey, "sbtc-token", "set-flash-minter", [
    Cl.principal(`${DEPLOYER}.flashstack-core`),
  ]);
  console.log(`  txid: ${r1.txid ?? JSON.stringify(r1)}`);
  await sleep(2000);

  // Step 2: Whitelist test-receiver
  console.log("Step 2: Whitelisting test-receiver...");
  const r2 = await callContract(privateKey, "flashstack-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${r2.txid ?? JSON.stringify(r2)}`);
  await sleep(2000);

  // Step 3: Set test collateral (30,000 STX)
  console.log("Step 3: Setting test collateral (30,000 STX for deployer)...");
  const r3 = await callContract(privateKey, "flashstack-core", "set-test-stx-locked", [
    Cl.principal(DEPLOYER),
    Cl.uint(30000000000),
  ]);
  console.log(`  txid: ${r3.txid ?? JSON.stringify(r3)}`);
  await sleep(2000);

  // Flash Loan 1: 0.01 sBTC
  console.log("\nFlash Loan #1: 0.01 sBTC (1,000,000 sats)...");
  const fl1 = await callContract(privateKey, "flashstack-core", "flash-mint", [
    Cl.uint(1000000),
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${fl1.txid ?? JSON.stringify(fl1)}`);
  await sleep(2000);

  // Flash Loan 2: 0.05 sBTC
  console.log("Flash Loan #2: 0.05 sBTC (5,000,000 sats)...");
  const fl2 = await callContract(privateKey, "flashstack-core", "flash-mint", [
    Cl.uint(5000000),
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${fl2.txid ?? JSON.stringify(fl2)}`);
  await sleep(2000);

  // Flash Loan 3: 0.10 sBTC
  console.log("Flash Loan #3: 0.10 sBTC (10,000,000 sats)...");
  const fl3 = await callContract(privateKey, "flashstack-core", "flash-mint", [
    Cl.uint(10000000),
    Cl.principal(`${DEPLOYER}.test-receiver`),
  ]);
  console.log(`  txid: ${fl3.txid ?? JSON.stringify(fl3)}`);

  console.log("\n======================================");
  console.log("MILESTONE 1 EVIDENCE - SAVE THESE LINKS");
  console.log("======================================");
  console.log(`Flash Loan 1: https://explorer.hiro.so/txid/${fl1.txid}?chain=testnet`);
  console.log(`Flash Loan 2: https://explorer.hiro.so/txid/${fl2.txid}?chain=testnet`);
  console.log(`Flash Loan 3: https://explorer.hiro.so/txid/${fl3.txid}?chain=testnet`);
  console.log("======================================");
}

main().catch(console.error);
