/**
 * Deploy your FlashStack STX receiver to Stacks mainnet.
 *
 * Usage (Mac/Linux):
 *   RECEIVER_NAME=yourname-flash-receiver-v1 DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-receiver-template.mjs
 *
 * Usage (Windows PowerShell):
 *   $env:RECEIVER_NAME="yourname-flash-receiver-v1"; $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/deploy-receiver-template.mjs
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  required -- your wallet's 24 words (never share these)
 *   RECEIVER_NAME      contract name to deploy as (default: my-flash-receiver-v1)
 *                      use lowercase letters, numbers and dashes only
 *   CONTRACT_PATH      Clarity file to deploy (default: contracts/templates/stx-receiver-template.clar)
 */

import { makeContractDeploy, PostConditionMode, ClarityVersion, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const NAME     = process.env.RECEIVER_NAME  ?? "my-flash-receiver-v1";
const PATH     = process.env.CONTRACT_PATH  ?? "contracts/templates/stx-receiver-template.clar";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC to your wallet's 24 words.");
  console.error('  Mac/Linux:  DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-receiver-template.mjs');
  console.error('  PowerShell: $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/deploy-receiver-template.mjs');
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(NAME)) {
  console.error(`ERROR: RECEIVER_NAME "${NAME}" is invalid. Use lowercase letters, numbers and dashes.`);
  process.exit(1);
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const sender = privateKeyToAddress(pk, "mainnet");

  const acct  = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  const nonce = acct.nonce;

  console.log("=======================================================");
  console.log("  FlashStack -- Deploy Your STX Flash Receiver");
  console.log("=======================================================");
  console.log(`  Your wallet: ${sender}`);
  console.log(`  Balance:     ${bal.toFixed(3)} STX`);
  console.log(`  Contract:    ${sender}.${NAME}`);
  console.log();

  if (bal < 1) {
    console.error("  ERROR: You need at least 1 STX in your wallet for the deploy fee.");
    process.exit(1);
  }

  const source = readFileSync(PATH, "utf8");

  const tx = await makeContractDeploy({
    contractName:      NAME,
    codeBody:          source,
    senderKey:         pk,
    network:           STACKS_MAINNET,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               500_000,
  });

  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`Deploy failed: ${data.error} -- ${data.reason ?? ""}`);

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);

  process.stdout.write("  Waiting for confirmation (1-5 minutes)");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const status = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (status.tx_status === "success") {
      console.log(" confirmed.");
      console.log();
      console.log("=======================================================");
      console.log("  DEPLOY COMPLETE");
      console.log("=======================================================");
      console.log(`  Your contract: ${sender}.${NAME}`);
      console.log(`  Explorer:      ${EXPLORER}/0x${txid}?chain=mainnet`);
      console.log();
      console.log("  NEXT STEP: send the contract ID above to Matt so he can");
      console.log("  whitelist it. You cannot execute a flash loan until then.");
      return;
    }
    if (status.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${status.tx_result?.repr}`);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check the explorer link above manually.");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
