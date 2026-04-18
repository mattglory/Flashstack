/**
 * FlashStack STX Core Deployment Script
 * Deploys: stx-flash-receiver-trait, flashstack-stx-core, stx-test-receiver, bitflow-arb-receiver
 * Then seeds the reserve with STX and whitelists receivers.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 word2 ..." \
 *   DEPLOYER_ADDRESS="SP..." \
 *   RESERVE_STX=500 \
 *   node scripts/deploy-stx-core.mjs
 */

import { makeContractDeploy, makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER  = process.env.DEPLOYER_ADDRESS;
const RESERVE   = parseInt(process.env.RESERVE_STX ?? "500") * 1_000_000; // convert STX to microstacks

if (!MNEMONIC || !DEPLOYER) {
  console.error("Set DEPLOYER_MNEMONIC and DEPLOYER_ADDRESS");
  process.exit(1);
}

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
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr}`);
      throw new Error(`${label} failed`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: ${label}`);
}

async function deployContract(privateKey, nonce, name, path) {
  const source = readFileSync(path, "utf8");
  // Fee: 10 STX max per deployment (covers even large contracts)
  const fee = 10_000_000;
  const tx = await makeContractDeploy({
    contractName: name,
    codeBody: source,
    senderKey: privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
    fee,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name} failed: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function callContract(privateKey, nonce, contractName, fn, args) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName: fn,
    functionArgs: args,
    senderKey: privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn} failed: ${result.error}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack STX Core Deployment");
  console.log("================================");
  console.log(`Deployer:    ${DEPLOYER}`);
  console.log(`Reserve:     ${RESERVE / 1_000_000} STX\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`Nonce: ${nonce}\n`);

  // 1. Deploy stx-flash-receiver-trait
  console.log("1. Deploying stx-flash-receiver-trait...");
  const t1 = await deployContract(privateKey, nonce++, "stx-flash-receiver-trait", "contracts/stx-flash-receiver-trait.clar");
  console.log(`   txid: ${t1}`);
  await waitForConfirm(t1, "stx-flash-receiver-trait");

  // 2. Deploy flashstack-stx-core
  console.log("2. Deploying flashstack-stx-core...");
  const t2 = await deployContract(privateKey, nonce++, "flashstack-stx-core", "contracts/flashstack-stx-core.clar");
  console.log(`   txid: ${t2}`);
  await waitForConfirm(t2, "flashstack-stx-core");

  // 3. Deploy stx-test-receiver
  console.log("3. Deploying stx-test-receiver...");
  const t3 = await deployContract(privateKey, nonce++, "stx-test-receiver", "contracts/stx-test-receiver.clar");
  console.log(`   txid: ${t3}`);
  await waitForConfirm(t3, "stx-test-receiver");

  // 4. Deploy bitflow-arb-receiver
  console.log("4. Deploying bitflow-arb-receiver...");
  const t4 = await deployContract(privateKey, nonce++, "bitflow-arb-receiver", "contracts/bitflow-arb-receiver.clar");
  console.log(`   txid: ${t4}`);
  await waitForConfirm(t4, "bitflow-arb-receiver");

  // 5. Seed reserve with STX
  console.log(`\n5. Depositing ${RESERVE / 1_000_000} STX into reserve...`);
  const t5 = await callContract(privateKey, nonce++, "flashstack-stx-core", "deposit-reserve", [
    Cl.uint(RESERVE),
  ]);
  console.log(`   txid: ${t5}`);
  await waitForConfirm(t5, "deposit-reserve");

  // 6. Whitelist stx-test-receiver
  console.log("6. Whitelisting stx-test-receiver...");
  const t6 = await callContract(privateKey, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t6}`);
  await waitForConfirm(t6, "add-approved-receiver (test)");

  // 7. Whitelist bitflow-arb-receiver
  console.log("7. Whitelisting bitflow-arb-receiver...");
  const t7 = await callContract(privateKey, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t7}`);
  await waitForConfirm(t7, "add-approved-receiver (bitflow)");

  console.log("\n================================");
  console.log("DEPLOYMENT COMPLETE");
  console.log("================================");
  console.log(`stx-flash-receiver-trait: https://explorer.hiro.so/txid/${t1}`);
  console.log(`flashstack-stx-core:      https://explorer.hiro.so/txid/${t2}`);
  console.log(`stx-test-receiver:        https://explorer.hiro.so/txid/${t3}`);
  console.log(`bitflow-arb-receiver:     https://explorer.hiro.so/txid/${t4}`);
  console.log(`deposit-reserve:          https://explorer.hiro.so/txid/${t5}`);
  console.log("\nNext step: run scripts/run-stx-flash-loans.mjs to execute flash loans");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
