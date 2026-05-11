/**
 * Deploy bitflow-arb-compounder and whitelist it on flashstack-stx-core + flashstack-stx-pool
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="twelve word mnemonic here" node scripts/deploy-compounder.mjs
 *
 * What this does:
 *   1. Deploys bitflow-arb-compounder.clar to mainnet
 *   2. Whitelists it on flashstack-stx-core (so it can be used as a receiver)
 *   3. Whitelists it on flashstack-stx-pool (so it can call deposit)
 */

import { makeContractDeploy, makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const network  = STACKS_MAINNET;

if (!MNEMONIC) {
  console.error("Set DEPLOYER_MNEMONIC");
  process.exit(1);
}

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function getNonce() {
  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return true; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr}`);
      return false;
    }
    process.stdout.write(".");
  }
  console.log(" TIMEOUT");
  return false;
}

async function main() {
  const pk    = await getPrivateKey();
  let   nonce = await getNonce();

  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  const bal = parseInt(res.balance, 16) / 1e6;
  console.log(`\nFlashStack Compounder Deploy`);
  console.log(`============================`);
  console.log(`Deployer: ${DEPLOYER}`);
  console.log(`Balance:  ${bal.toFixed(3)} STX`);
  console.log(`Nonce:    ${nonce}\n`);

  if (bal < 4) {
    console.error("Need at least 4 STX for deploy + setup fees");
    process.exit(1);
  }

  // Step 1: Deploy contract
  console.log("Step 1: Deploying bitflow-arb-compounder...");
  const source = readFileSync("contracts/bitflow-arb-compounder.clar", "utf8");

  const deployTx = await makeContractDeploy({
    contractName:      "bitflow-arb-compounder",
    codeBody:          source,
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               3_000_000, // 3 STX
  });

  const deployResult = await broadcastTransaction({ transaction: deployTx, network });
  if (deployResult.error) {
    console.error(`FAILED: ${deployResult.error} - ${deployResult.reason}`);
    process.exit(1);
  }
  console.log(`  txid: ${deployResult.txid}`);
  console.log(`  https://explorer.hiro.so/txid/0x${deployResult.txid}?chain=mainnet`);

  const deployOk = await waitForConfirm(deployResult.txid, "deploy");
  if (!deployOk) process.exit(1);

  // Step 2: Whitelist on flashstack-stx-core
  console.log("\nStep 2: Whitelisting on flashstack-stx-core...");
  const whitelistCoreTx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "set-whitelisted",
    functionArgs:      [
      Cl.principal(`${DEPLOYER}.bitflow-arb-compounder`),
      Cl.bool(true),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               300_000,
  });

  const wcResult = await broadcastTransaction({ transaction: whitelistCoreTx, network });
  if (wcResult.error) {
    console.error(`FAILED: ${wcResult.error} - ${wcResult.reason}`);
    process.exit(1);
  }
  console.log(`  txid: ${wcResult.txid}`);
  await waitForConfirm(wcResult.txid, "whitelist on core");

  // Step 3: Whitelist on flashstack-stx-pool
  console.log("\nStep 3: Whitelisting on flashstack-stx-pool...");
  const whitelistPoolTx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-pool",
    functionName:      "set-whitelisted",
    functionArgs:      [
      Cl.principal(`${DEPLOYER}.bitflow-arb-compounder`),
      Cl.bool(true),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               300_000,
  });

  const wpResult = await broadcastTransaction({ transaction: whitelistPoolTx, network });
  if (wpResult.error) {
    // Pool may not require whitelist for deposits -- log but don't exit
    console.warn(`  Note: ${wpResult.error} (pool may not require whitelist for deposits)`);
  } else {
    console.log(`  txid: ${wpResult.txid}`);
    await waitForConfirm(wpResult.txid, "whitelist on pool");
  }

  console.log(`\n============================`);
  console.log(`DONE. Compounder is live.`);
  console.log(`Contract: ${DEPLOYER}.bitflow-arb-compounder`);
  console.log(`Explorer: https://explorer.hiro.so/address/${DEPLOYER}.bitflow-arb-compounder?chain=mainnet`);
  console.log(`\nTo run arb with auto-compounding:`);
  console.log(`  EXECUTE=true COMPOUND=true DEPLOYER_MNEMONIC="..." node scripts/monitor-opportunities.mjs`);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
