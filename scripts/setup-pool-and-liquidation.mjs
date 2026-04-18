/**
 * Post-deploy setup for flashstack-stx-pool
 *
 * flashstack-stx-pool deployed:
 *   txid 251de86866a820a6a53e9937afc8d2de1a34f5e8cad77ee607aedfb148356acd
 *
 * NOTE: arkadiko-liquidation-receiver (txid 3efd7703...) was aborted on-chain.
 * Arkadiko uses a stability-pool model — collateral goes to the pool, not the caller.
 * Flash loan liquidation of Arkadiko requires holding USDA, not STX. Skipped.
 *
 * Steps:
 *   1. Wait for pool deploy to confirm
 *   2. Whitelist stx-test-receiver on flashstack-stx-pool
 *   3. Whitelist bitflow-arb-receiver on flashstack-stx-pool
 *   4. Seed pool with 50 STX
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." /opt/homebrew/bin/node scripts/setup-pool-and-liquidation.mjs
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;

const POOL_TXID = "251de86866a820a6a53e9937afc8d2de1a34f5e8cad77ee607aedfb148356acd";

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
  console.log("FlashStack -- Pool Setup");
  console.log("========================");

  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  // 1. Wait for pool deploy
  console.log("1. Waiting for flashstack-stx-pool deploy...");
  const r1 = await waitForConfirm(POOL_TXID, "flashstack-stx-pool");
  if (r1 !== "success") { console.error("Pool deploy failed. Stopping."); process.exit(1); }

  // Re-fetch nonce after confirm
  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let nonce  = res.nonce;
  const bal  = parseInt(res.balance, 16) / 1e6;
  console.log(`\nBalance: ${bal.toFixed(3)} STX, Nonce: ${nonce}`);

  // 2. Whitelist stx-test-receiver on flashstack-stx-pool
  console.log("\n2. Whitelisting stx-test-receiver on flashstack-stx-pool...");
  const t2 = await callFn(pk, nonce++, "flashstack-stx-pool", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.stx-test-receiver`),
  ]);
  console.log(`   txid: ${t2}`);
  const r2 = await waitForConfirm(t2, "whitelist stx-test-receiver");
  if (r2 !== "success") console.warn("   Warning: failed");

  // 3. Whitelist bitflow-arb-receiver on flashstack-stx-pool
  console.log("\n3. Whitelisting bitflow-arb-receiver on flashstack-stx-pool...");
  const t3 = await callFn(pk, nonce++, "flashstack-stx-pool", "add-approved-receiver", [
    Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
  ]);
  console.log(`   txid: ${t3}`);
  const r3 = await waitForConfirm(t3, "whitelist bitflow-arb-receiver");
  if (r3 !== "success") console.warn("   Warning: failed");

  // 4. Seed pool with 50 STX
  console.log("\n4. Seeding flashstack-stx-pool with 50 STX...");
  const t4 = await callFn(pk, nonce++, "flashstack-stx-pool", "deposit", [
    Cl.uint(50_000_000),
  ]);
  console.log(`   txid: ${t4}`);
  const r4 = await waitForConfirm(t4, "seed deposit");
  if (r4 !== "success") console.warn("   Warning: seed deposit failed");

  console.log("\n========================");
  console.log("POOL SETUP COMPLETE");
  console.log("========================");
  console.log(`Pool:     https://explorer.hiro.so/txid/0x${POOL_TXID}?chain=mainnet`);
  console.log(`\nPool is live. LPs can deposit STX and earn 0.05% per flash loan.`);
  console.log(`Flash loans available from both flashstack-stx-core and flashstack-stx-pool.`);
}

main().catch(e => { console.error("\nERROR:", e.message); process.exit(1); });
