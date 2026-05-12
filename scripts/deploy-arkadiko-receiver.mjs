/**
 * FlashStack -- Deploy Arkadiko Flash Liquidation Receiver
 *
 * Deploys arkadiko-liquidation-receiver and whitelists it in
 * flashstack-stx-core.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-arkadiko-receiver.mjs
 */

import {
  makeContractDeploy,
  makeContractCall,
  PostConditionMode,
  ClarityVersion,
  Cl,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = process.env.DEPLOYER_ADDRESS ?? "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_MAINNET;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC environment variable.");
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
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return data; }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "unknown";
      console.log(`\n  FAILED: ${reason}`);
      console.log(`  Tx: ${EXPLORER}/${txid}?chain=mainnet`);
      throw new Error(`"${label}" failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}"`);
}

async function broadcast(tx) {
  const raw   = tx.serialize();
  const bytes = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res   = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Node response not JSON: ${text.slice(0, 200)}`); }
  if (typeof data === "object" && data.error) {
    throw new Error(`${data.error} -- ${data.reason ?? ""} ${data.reason_data ? JSON.stringify(data.reason_data) : ""}`);
  }
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  return txid;
}

async function main() {
  console.log("=======================================================");
  console.log("  FlashStack -- Deploy Arkadiko Liquidation Receiver   ");
  console.log("=======================================================");
  console.log(`  Deployer: ${DEPLOYER}\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const CONTRACT_NAME = "arkadiko-liquidation-receiver";
  const CONTRACT_PATH = "contracts/arkadiko-liquidation-receiver.clar";
  const receiverPrincipal = `${DEPLOYER}.${CONTRACT_NAME}`;

  // Step 1: Deploy
  console.log("Step 1 -- Deploy arkadiko-liquidation-receiver");
  const source = readFileSync(CONTRACT_PATH, "utf8");
  const deployTx = await makeContractDeploy({
    contractName: CONTRACT_NAME,
    codeBody: source,
    senderKey: privateKey,
    network,
    clarityVersion: ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    fee: 500_000,
    nonce: nonce++,
  });
  const deployTxid = await broadcast(deployTx);
  console.log(`  Broadcast: ${deployTxid}`);
  console.log(`  Explorer:  ${EXPLORER}/${deployTxid}?chain=mainnet`);
  await waitForConfirm(deployTxid, "deploy arkadiko-liquidation-receiver");
  console.log();

  // Step 2: Whitelist in flashstack-stx-core
  console.log("Step 2 -- Whitelist in flashstack-stx-core");
  const whitelistTx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName: "flashstack-stx-core",
    functionName: "add-approved-receiver",
    functionArgs: [Cl.principal(receiverPrincipal)],
    senderKey: privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    fee: 100_000,
    nonce: nonce++,
  });
  const whitelistTxid = await broadcast(whitelistTx);
  console.log(`  Broadcast: ${whitelistTxid}`);
  console.log(`  Explorer:  ${EXPLORER}/${whitelistTxid}?chain=mainnet`);
  await waitForConfirm(whitelistTxid, "whitelist in flashstack-stx-core");
  console.log();

  console.log("=======================================================");
  console.log("                  DEPLOYMENT COMPLETE                   ");
  console.log("=======================================================");
  console.log(`  Contract:  ${receiverPrincipal}`);
  console.log(`  Deploy:    ${EXPLORER}/${deployTxid}?chain=mainnet`);
  console.log(`  Whitelist: ${EXPLORER}/${whitelistTxid}?chain=mainnet`);
  console.log();
  console.log("  Next steps:");
  console.log("  1. Call liquidate(vault-owner, amount) to trigger a flash liquidation");
  console.log("  2. Use check-vault(owner) read-only to verify a vault is undercollateralized first");
  console.log("  3. Contact Arkadiko team to confirm liquidation-call interface compatibility");
  console.log("=======================================================");
}

main().catch(e => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
