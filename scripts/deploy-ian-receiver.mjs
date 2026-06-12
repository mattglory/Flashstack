/**
 * Deploy ian-stx-receiver-v1 to Stacks mainnet
 *
 * Usage (Windows PowerShell):
 *   $env:DEPLOYER_MNEMONIC="word1 word2 ... word24"; node scripts/deploy-ian-receiver.mjs
 *
 * Usage (Mac/Linux):
 *   DEPLOYER_MNEMONIC="word1 word2 ... word24" node scripts/deploy-ian-receiver.mjs
 */

import { makeContractDeploy, PostConditionMode, ClarityVersion } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC");
  console.error('  Windows PowerShell: $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/deploy-ian-receiver.mjs');
  process.exit(1);
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  const acct  = await fetch(`${API}/v2/accounts/${process.env.SENDER ?? ""}?proof=0`).then(r => r.json()).catch(() => ({}));

  // Get sender address from private key
  const { privateKeyToAddress } = await import("@stacks/transactions");
  const sender = privateKeyToAddress(pk, "mainnet");

  const acctData = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal   = parseInt(acctData.balance, 16) / 1e6;
  const nonce = acctData.nonce;

  console.log("=======================================================");
  console.log("  FlashStack — Deploy ian-stx-receiver-v1");
  console.log("=======================================================");
  console.log(`  Deployer: ${sender}`);
  console.log(`  Balance:  ${bal.toFixed(3)} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log();

  if (bal < 1) {
    console.error("  Need at least 1 STX for deploy fee.");
    process.exit(1);
  }

  const source = readFileSync("contracts/ian-stx-receiver-v1.clar", "utf8");

  const tx = await makeContractDeploy({
    contractName:      "ian-stx-receiver-v1",
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
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`Deploy failed: ${data.error} -- ${data.reason ?? ""}`);

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);

  process.stdout.write("  Waiting for confirmation");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const tx = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (tx.tx_status === "success") {
      console.log(" confirmed.");
      console.log();
      console.log("=======================================================");
      console.log("  DEPLOY COMPLETE");
      console.log("=======================================================");
      console.log(`  Contract: ${sender}.ian-stx-receiver-v1`);
      console.log(`  Explorer: ${EXPLORER}/0x${txid}?chain=mainnet`);
      console.log();
      console.log("  Next step: send the contract address to Matt to get whitelisted.");
      return;
    }
    if (tx.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${tx.tx_result?.repr}`);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out — check explorer manually");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
