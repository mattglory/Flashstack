/**
 * Run STX Flash Loan Tests
 * Funds the test receiver with enough STX to cover fees, then runs flash loans.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/run-flash-loan-tests.mjs
 */

import { makeSTXTokenTransfer, makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const LOW_FEE   = 300_000; // 0.3 STX per tx

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network  = STACKS_MAINNET;
const API      = "https://api.hiro.so";

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 12000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(` SUCCESS`); return "success"; }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "";
      console.log(` FAILED: ${reason}`);
      return "fail";
    }
    process.stdout.write(".");
  }
  console.log(" TIMEOUT");
  return "timeout";
}

async function sendSTX(pk, nonce, recipient, amount) {
  const tx = await makeSTXTokenTransfer({
    recipient,
    amount,
    senderKey: pk,
    network,
    anchorMode: 1,
    nonce,
    fee: LOW_FEE,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`STX transfer: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function callFn(pk, nonce, contractName, fn, args) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName: fn,
    functionArgs: args,
    senderKey: pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
    fee: LOW_FEE,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack STX - Flash Loan Tests");
  console.log("===================================");

  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let nonce = res.nonce;
  const bal = parseInt(res.balance, 16) / 1e6;
  console.log(`Balance: ${bal.toFixed(6)} STX, Nonce: ${nonce}\n`);

  // Pre-fund the test receiver with 1 STX so it can cover repayment fees
  const receiverAddr = `${DEPLOYER}.stx-test-receiver`;
  console.log(`1. Funding stx-test-receiver with 1 STX (to cover repayment fees)...`);
  const t1 = await sendSTX(pk, nonce++, receiverAddr, 1_000_000);
  console.log(`   txid: ${t1}`);
  const r1 = await waitForConfirm(t1, "fund receiver");
  if (r1 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Flash loan test 1: 10 STX
  console.log("\n2. Flash loan test 1: 10 STX via stx-test-receiver...");
  const t2 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(10_000_000),
    Cl.principal(receiverAddr),
  ]);
  console.log(`   txid: ${t2}`);
  const r2 = await waitForConfirm(t2, "flash-loan 10 STX");

  // Flash loan test 2: 50 STX
  console.log("3. Flash loan test 2: 50 STX via stx-test-receiver...");
  const t3 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(50_000_000),
    Cl.principal(receiverAddr),
  ]);
  console.log(`   txid: ${t3}`);
  const r3 = await waitForConfirm(t3, "flash-loan 50 STX");

  console.log("\n===================================");
  console.log("RESULTS");
  console.log("===================================");
  console.log(`Flash loan 10 STX: ${r2}`);
  console.log(`Flash loan 50 STX: ${r3}`);
  console.log(`\nExplorer links:`);
  console.log(`Flash loan 1: https://explorer.hiro.so/txid/0x${t2}?chain=mainnet`);
  console.log(`Flash loan 2: https://explorer.hiro.so/txid/0x${t3}?chain=mainnet`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
