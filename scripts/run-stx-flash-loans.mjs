/**
 * FlashStack STX Flash Loan Executor
 * Runs test flash loan + Bitflow arbitrage flash loan.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 word2 ..." \
 *   DEPLOYER_ADDRESS="SP..." \
 *   node scripts/run-stx-flash-loans.mjs
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = process.env.DEPLOYER_ADDRESS;

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
      const reason = data.tx_result?.repr ?? "";
      console.log(` FAILED: ${reason}`);
      throw new Error(`${label} failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: ${label}`);
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
  if (result.error) throw new Error(`${fn} failed: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function getReserveBalance() {
  const res = await fetch(`${API}/v2/contracts/call-read/${DEPLOYER}/flashstack-stx-core/get-reserve-balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: DEPLOYER, arguments: [] }),
  });
  const data = await res.json();
  return data.result ? parseInt(data.result.replace("0x", ""), 16) / 1_000_000 : 0;
}

async function main() {
  console.log("FlashStack STX Flash Loan Executor");
  console.log("===================================");
  console.log(`Deployer: ${DEPLOYER}\n`);

  const reserveStx = await getReserveBalance();
  console.log(`Reserve balance: ${reserveStx} STX`);
  if (reserveStx < 10) {
    console.error("Reserve too low. Run deploy-stx-core.mjs first to seed reserve.");
    process.exit(1);
  }

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`Nonce: ${nonce}\n`);

  // Flash Loan 1: 10 STX via stx-test-receiver (proves round-trip)
  console.log("Flash Loan #1: 10 STX via stx-test-receiver (basic round-trip)...");
  const fl1 = await callContract(privateKey, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(10_000_000),                              // 10 STX
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`  txid: ${fl1}`);
  await waitForConfirm(fl1, "flash-loan #1");

  // Flash Loan 2: 50 STX via stx-test-receiver
  console.log("Flash Loan #2: 50 STX via stx-test-receiver...");
  const fl2 = await callContract(privateKey, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(50_000_000),                              // 50 STX
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`  txid: ${fl2}`);
  await waitForConfirm(fl2, "flash-loan #2");

  // Flash Loan 3: 100 STX via bitflow-arb-receiver (STX/stSTX arbitrage)
  console.log("Flash Loan #3: 100 STX via bitflow-arb-receiver (Bitflow STX/stSTX arb)...");
  const fl3 = await callContract(privateKey, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(100_000_000),                             // 100 STX
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`  txid: ${fl3}`);
  await waitForConfirm(fl3, "flash-loan #3 (Bitflow arb)");

  console.log("\n===================================");
  console.log("STX FLASH LOAN EVIDENCE");
  console.log("===================================");
  console.log(`Flash Loan 1: https://explorer.hiro.so/txid/${fl1}`);
  console.log(`Flash Loan 2: https://explorer.hiro.so/txid/${fl2}`);
  console.log(`Flash Loan 3: https://explorer.hiro.so/txid/${fl3}`);
  console.log("===================================");
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
