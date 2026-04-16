/**
 * Continue STX setup from nonce 4.
 * Contracts already deployed. This script:
 *   - Deposits 80 STX reserve
 *   - Whitelists both receivers
 *   - Runs 3 flash loan tests
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/continue-stx-setup.mjs
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const RESERVE  = 80_000_000; // 80 STX

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;
const API = "https://api.hiro.so";

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 12000));
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
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
    fee: 2_000_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack STX - Continue Setup");
  console.log("================================");

  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk = wallet.accounts[0].stxPrivateKey;

  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let nonce = res.nonce;
  const bal = parseInt(res.balance, 16) / 1e6;
  console.log(`Balance: ${bal.toFixed(3)} STX, Nonce: ${nonce}\n`);

  // Step 1: Deposit 80 STX reserve
  console.log(`1. Depositing ${RESERVE / 1_000_000} STX reserve...`);
  const t1 = await callFn(pk, nonce++, "flashstack-stx-core", "deposit-reserve", [Cl.uint(RESERVE)]);
  console.log(`   txid: ${t1}`);
  const r1 = await waitForConfirm(t1, "deposit-reserve");
  if (r1 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Step 2: Whitelist stx-test-receiver
  console.log("2. Whitelisting stx-test-receiver...");
  const t2 = await callFn(pk, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t2}`);
  await waitForConfirm(t2, "whitelist stx-test-receiver");

  // Step 3: Whitelist bitflow-arb-receiver
  console.log("3. Whitelisting bitflow-arb-receiver...");
  const t3 = await callFn(pk, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t3}`);
  await waitForConfirm(t3, "whitelist bitflow-arb-receiver");

  // Step 4: Flash loan test 1 - 10 STX
  console.log("\n4. Flash loan test 1: 10 STX via stx-test-receiver...");
  const t4 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(10_000_000),
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t4}`);
  const r4 = await waitForConfirm(t4, "flash-loan 10 STX");

  // Step 5: Flash loan test 2 - 50 STX
  console.log("5. Flash loan test 2: 50 STX via stx-test-receiver...");
  const t5 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(50_000_000),
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t5}`);
  const r5 = await waitForConfirm(t5, "flash-loan 50 STX");

  // Step 6: Bitflow arb attempt - 20 STX
  console.log("6. Flash loan arb: 20 STX via bitflow-arb-receiver...");
  const t6 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(20_000_000),
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t6}`);
  const r6 = await waitForConfirm(t6, "flash-loan bitflow-arb");
  if (r6 !== "success") {
    console.log("   (arb failed - no spread opportunity at this moment, expected)");
  }

  console.log("\n================================");
  console.log("COMPLETE - Explorer Links");
  console.log("================================");
  console.log(`flashstack-stx-core:  https://explorer.hiro.so/txid/0x4c1a17483eb5bc42b4d7454ffc53f5b1fe4d18d1370b23b60199ee9d8d28ba70?chain=mainnet`);
  console.log(`stx-test-receiver:    https://explorer.hiro.so/txid/0xfead69fa92f54e5790ff1b17a9479e86716e93b66357726d8c9be336df558e45?chain=mainnet`);
  console.log(`bitflow-arb-receiver: https://explorer.hiro.so/txid/0x616449ab17cb75e3ddd4d2bbb2b7c38c0d4cd566b00035606d9a70bc08b637d4?chain=mainnet`);
  console.log(`deposit-reserve:      https://explorer.hiro.so/txid/0x${t1}?chain=mainnet`);
  console.log(`flash-loan test-1:    https://explorer.hiro.so/txid/0x${t4}?chain=mainnet`);
  console.log(`flash-loan test-2:    https://explorer.hiro.so/txid/0x${t5}?chain=mainnet`);
  console.log(`flash-loan arb:       https://explorer.hiro.so/txid/0x${t6}?chain=mainnet`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
