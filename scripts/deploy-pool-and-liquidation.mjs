/**
 * Deploy FlashStack STX Pool + Arkadiko Liquidation Receiver
 *
 * Deploys:
 *   1. flashstack-stx-pool  — external LP deposit pool with yield sharing
 *   2. arkadiko-liquidation-receiver — flash loan powered liquidation bot
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/deploy-pool-and-liquidation.mjs
 */

import { makeContractDeploy, makeContractCall, broadcastTransaction, PostConditionMode, ClarityVersion, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;
const API     = "https://api.hiro.so";

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 12000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" SUCCESS"); return "success"; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr ?? ""}`);
      return "fail";
    }
    process.stdout.write(".");
  }
  console.log(" TIMEOUT");
  return "timeout";
}

async function deploy(pk, nonce, name, path) {
  const source = readFileSync(path, "utf8");
  const tx = await makeContractDeploy({
    contractName:      name,
    codeBody:          source,
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               1_000_000,
    clarityVersion:    ClarityVersion.Clarity3,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function callFn(pk, nonce, contractName, fn, args) {
  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName,
    functionName:      fn,
    functionArgs:      args,
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`${fn}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function main() {
  console.log("FlashStack — Deploy Pool + Liquidation Receiver");
  console.log("================================================");

  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let nonce  = res.nonce;
  const bal  = parseInt(res.balance, 16) / 1e6;
  console.log(`Balance: ${bal.toFixed(3)} STX, Nonce: ${nonce}\n`);

  if (bal < 5) {
    console.error("Need at least 5 STX for deployment fees.");
    process.exit(1);
  }

  // 1. Deploy flashstack-stx-pool
  console.log("1. Deploying flashstack-stx-pool...");
  const t1 = await deploy(pk, nonce++, "flashstack-stx-pool", "contracts/flashstack-stx-pool.clar");
  console.log(`   txid: ${t1}`);
  const r1 = await waitForConfirm(t1, "flashstack-stx-pool");
  if (r1 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // 2. Deploy arkadiko-liquidation-receiver
  console.log("2. Deploying arkadiko-liquidation-receiver...");
  const t2 = await deploy(pk, nonce++, "arkadiko-liquidation-receiver", "contracts/arkadiko-liquidation-receiver.clar");
  console.log(`   txid: ${t2}`);
  const r2 = await waitForConfirm(t2, "arkadiko-liquidation-receiver");
  if (r2 !== "success") { console.error("FAILED. Stopping."); process.exit(1); }

  // 3. Whitelist liquidation receiver on the original stx-core
  console.log("3. Whitelisting arkadiko-liquidation-receiver on flashstack-stx-core...");
  const t3 = await callFn(pk, nonce++, "flashstack-stx-core", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.arkadiko-liquidation-receiver`),
  ]);
  console.log(`   txid: ${t3}`);
  await waitForConfirm(t3, "whitelist liquidation-receiver on stx-core");

  // 4. Seed pool with initial 50 STX deposit
  console.log("4. Seeding flashstack-stx-pool with 50 STX...");
  const t4 = await callFn(pk, nonce++, "flashstack-stx-pool", "deposit", [
    Cl.uint(50_000_000),
  ]);
  console.log(`   txid: ${t4}`);
  await waitForConfirm(t4, "seed pool deposit");

  // 5. Whitelist liquidation receiver on the pool too
  console.log("5. Whitelisting arkadiko-liquidation-receiver on flashstack-stx-pool...");
  const t5 = await callFn(pk, nonce++, "flashstack-stx-pool", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.arkadiko-liquidation-receiver`),
  ]);
  console.log(`   txid: ${t5}`);
  await waitForConfirm(t5, "whitelist on pool");

  console.log("\n================================================");
  console.log("DEPLOYED");
  console.log("================================================");
  console.log(`flashstack-stx-pool:           https://explorer.hiro.so/txid/0x${t1}?chain=mainnet`);
  console.log(`arkadiko-liquidation-receiver: https://explorer.hiro.so/txid/0x${t2}?chain=mainnet`);
  console.log(`\nNext steps:`);
  console.log(`  Monitor vaults: node scripts/monitor-liquidations.mjs`);
  console.log(`  Execute liq:    EXECUTE=true VAULT_OWNERS=SP... node scripts/monitor-liquidations.mjs`);
  console.log(`  Deposit to LP:  Use flashstack.vercel.app once frontend is updated`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
