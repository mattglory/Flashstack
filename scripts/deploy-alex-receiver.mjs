/**
 * FlashStack -- Deploy ALEX STX/ALEX Arbitrage Receiver
 *
 * Deploys alex-arb-receiver and whitelists it in flashstack-stx-core.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-alex-receiver.mjs
 */

import { makeContractDeploy, makeContractCall, PostConditionMode, ClarityVersion, Cl } from "@stacks/transactions";
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

if (!MNEMONIC) { console.error("ERROR: Set DEPLOYER_MNEMONIC"); process.exit(1); }

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}
async function getNonce() {
  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  return (await res.json()).nonce;
}
async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(`\n  FAILED: ${data.tx_result?.repr ?? "unknown"}`);
      throw new Error(`"${label}" failed`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: "${label}"`);
}
async function broadcast(tx) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${data.error} -- ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`No txid: ${text.slice(0, 200)}`);
  return txid;
}

async function main() {
  console.log("=======================================================");
  console.log("  FlashStack -- Deploy ALEX STX/ALEX Arb Receiver v3  ");
  console.log("=======================================================");
  console.log(`  Deployer: ${DEPLOYER}\n`);

  const pk    = await getPrivateKey();
  let nonce   = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const NAME     = "alex-arb-receiver-v3";
  const PATH     = "contracts/alex-arb-receiver-v3.clar";
  const receiver = `${DEPLOYER}.${NAME}`;

  // Step 1: Deploy
  console.log("Step 1 -- Deploy alex-arb-receiver-v3");
  const deployTx = await makeContractDeploy({
    contractName: NAME, codeBody: readFileSync(PATH, "utf8"),
    senderKey: pk, network, clarityVersion: ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow, anchorMode: 1, fee: 500_000, nonce: nonce++,
  });
  const deployTxid = await broadcast(deployTx);
  console.log(`  Broadcast: ${deployTxid}`);
  console.log(`  Explorer:  ${EXPLORER}/${deployTxid}?chain=mainnet`);
  await waitForConfirm(deployTxid, "deploy alex-arb-receiver-v3");
  console.log();

  // Step 2: Whitelist in flashstack-stx-core
  console.log("Step 2 -- Whitelist in flashstack-stx-core");
  const wlTx = await makeContractCall({
    contractAddress: DEPLOYER, contractName: "flashstack-stx-core",
    functionName: "add-approved-receiver", functionArgs: [Cl.principal(receiver)],
    senderKey: pk, network, postConditionMode: PostConditionMode.Allow,
    anchorMode: 1, fee: 100_000, nonce: nonce++,
  });
  const wlTxid = await broadcast(wlTx);
  console.log(`  Broadcast: ${wlTxid}`);
  console.log(`  Explorer:  ${EXPLORER}/${wlTxid}?chain=mainnet`);
  await waitForConfirm(wlTxid, "whitelist in flashstack-stx-core");
  console.log();

  console.log("=======================================================");
  console.log("                  DEPLOYMENT COMPLETE                   ");
  console.log("=======================================================");
  console.log(`  Contract:  ${receiver}`);
  console.log(`  Deploy:    ${EXPLORER}/${deployTxid}?chain=mainnet`);
  console.log(`  Whitelist: ${EXPLORER}/${wlTxid}?chain=mainnet`);
  console.log();
  console.log("  Next steps:");
  console.log("  1. call set-min-alex-out and set-min-profit before each execution");
  console.log("  2. Test with simulate() read-only to estimate profit");
  console.log("  3. Run a live flash loan when STX/ALEX spread is profitable");
  console.log("=======================================================");
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
