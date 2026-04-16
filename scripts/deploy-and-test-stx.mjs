/**
 * FlashStack STX Core - Full Deploy + Test
 * Deploys all STX contracts and immediately runs flash loan tests.
 *
 * PRECONDITION: stx-flash-receiver-trait already deployed at:
 *   SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 word2 ..." \
 *   RESERVE_STX=100 \
 *   node scripts/deploy-and-test-stx.mjs
 */

import { makeContractDeploy, makeContractCall, broadcastTransaction, PostConditionMode, ClarityVersion, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const RESERVE   = parseInt(process.env.RESERVE_STX ?? "100") * 1_000_000;

if (!MNEMONIC) {
  console.error("Set DEPLOYER_MNEMONIC env var");
  process.exit(1);
}

const network = STACKS_MAINNET;
const API = "https://api.hiro.so";
const FEE = 8_000_000; // 8 STX per deploy

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
    await new Promise(r => setTimeout(r, 12000));
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") {
      console.log(` SUCCESS`);
      return "success";
    }
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

async function deploy(pk, nonce, name, path) {
  const source = readFileSync(path, "utf8");
  // Deploy as Clarity 3 — fully supported on epoch 3.0 mainnet
  // Avoids Clarity 4 stx-transfer? type analysis issues
  const tx = await makeContractDeploy({
    contractName: name,
    codeBody: source,
    senderKey: pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
    fee: FEE,
    clarityVersion: ClarityVersion.Clarity3,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name}: ${result.error} - ${result.reason}`);
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
    fee: 2_000_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack STX Core - Deploy + Test");
  console.log("=====================================");
  console.log(`Deployer: ${DEPLOYER}`);
  console.log(`Reserve:  ${RESERVE / 1_000_000} STX`);

  const bal = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  const stx = parseInt(bal.balance, 16) / 1_000_000;
  console.log(`Balance:  ${stx.toFixed(3)} STX`);

  if (stx < 50) {
    console.error("Need at least 50 STX. Fund wallet first.");
    process.exit(1);
  }

  const pk = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`Nonce: ${nonce}\n`);

  // Step 1: Deploy flashstack-stx-core
  console.log("1. Deploying flashstack-stx-core (Clarity 3)...");
  const t1 = await deploy(pk, nonce++, "flashstack-stx-core", "contracts/flashstack-stx-core.clar");
  console.log(`   txid: ${t1}`);
  const r1 = await waitForConfirm(t1, "flashstack-stx-core");
  if (r1 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Step 2: Deploy stx-test-receiver
  console.log("2. Deploying stx-test-receiver...");
  const t2 = await deploy(pk, nonce++, "stx-test-receiver", "contracts/stx-test-receiver.clar");
  console.log(`   txid: ${t2}`);
  const r2 = await waitForConfirm(t2, "stx-test-receiver");
  if (r2 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Step 3: Deploy bitflow-arb-receiver
  console.log("3. Deploying bitflow-arb-receiver...");
  const t3 = await deploy(pk, nonce++, "bitflow-arb-receiver", "contracts/bitflow-arb-receiver.clar");
  console.log(`   txid: ${t3}`);
  const r3 = await waitForConfirm(t3, "bitflow-arb-receiver");
  if (r3 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Step 4: Deposit STX reserve
  console.log(`\n4. Depositing ${RESERVE / 1_000_000} STX reserve...`);
  const t4 = await callFn(pk, nonce++, "flashstack-stx-core", "deposit-reserve", [Cl.uint(RESERVE)]);
  console.log(`   txid: ${t4}`);
  const r4 = await waitForConfirm(t4, "deposit-reserve");
  if (r4 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // Step 5: Whitelist stx-test-receiver
  console.log("5. Whitelisting stx-test-receiver...");
  const t5 = await callFn(pk, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t5}`);
  await waitForConfirm(t5, "whitelist stx-test-receiver");

  // Step 6: Whitelist bitflow-arb-receiver
  console.log("6. Whitelisting bitflow-arb-receiver...");
  const t6 = await callFn(pk, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t6}`);
  await waitForConfirm(t6, "whitelist bitflow-arb-receiver");

  // Step 7: Flash loan test 1 (stx-test-receiver, 100 STX)
  console.log("\n7. Flash loan test 1: 100 STX via stx-test-receiver...");
  const t7 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(100_000_000),
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t7}`);
  const r7 = await waitForConfirm(t7, "flash-loan test-1");
  console.log(`   Result: ${r7}`);

  // Step 8: Flash loan test 2 (stx-test-receiver, 500 STX)
  console.log("8. Flash loan test 2: 500 STX via stx-test-receiver...");
  const t8 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(500_000_000),
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t8}`);
  const r8 = await waitForConfirm(t8, "flash-loan test-2");
  console.log(`   Result: ${r8}`);

  // Step 9: Flash loan via bitflow-arb-receiver (50 STX arb attempt)
  console.log("9. Flash loan arb: 50 STX via bitflow-arb-receiver...");
  const t9 = await callFn(pk, nonce++, "flashstack-stx-core", "flash-loan", [
    Cl.uint(50_000_000),
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t9}`);
  const r9 = await waitForConfirm(t9, "flash-loan bitflow-arb");
  console.log(`   Result: ${r9} (may fail if no arb opportunity)`);

  console.log("\n=====================================");
  console.log("DEPLOYMENT COMPLETE");
  console.log("=====================================");
  console.log(`flashstack-stx-core:  https://explorer.hiro.so/txid/${t1}?chain=mainnet`);
  console.log(`stx-test-receiver:    https://explorer.hiro.so/txid/${t2}?chain=mainnet`);
  console.log(`bitflow-arb-receiver: https://explorer.hiro.so/txid/${t3}?chain=mainnet`);
  console.log(`flash-loan test-1:    https://explorer.hiro.so/txid/${t7}?chain=mainnet`);
  console.log(`flash-loan test-2:    https://explorer.hiro.so/txid/${t8}?chain=mainnet`);
  console.log(`flash-loan arb:       https://explorer.hiro.so/txid/${t9}?chain=mainnet`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
