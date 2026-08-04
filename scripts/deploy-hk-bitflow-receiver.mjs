/**
 * FlashStack -- Deploy hk-stx-bitflow-receiver-v1 to mainnet
 *
 * External-developer receiver that runs a REAL Bitflow STX->stSTX->STX round-trip
 * inside a flash loan and repays principal + fee atomically.
 *
 * Deploys from OUR own mainnet wallet (NOT the protocol deployer). The admin-only
 * whitelist call (`add-approved-receiver` on flashstack-stx-core) must be done by
 * Matt separately before the receiver can borrow.
 *
 * Usage:
 *   MAINNET_MNEMONIC="word1 ... word24" node scripts/deploy-hk-bitflow-receiver.mjs
 * Or, if ./mbegu2 holds the 24-word mnemonic on a single line:
 *   node scripts/deploy-hk-bitflow-receiver.mjs
 *
 * Optional env:
 *   DRY_RUN=1            Build and print the tx fields but do NOT broadcast.
 *   DEPLOY_FEE_USTX=...  Override the deploy fee (default 500_000 microSTX = 0.5 STX).
 */

import { makeContractDeploy, PostConditionMode, ClarityVersion, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const NAME     = "hk-stx-bitflow-receiver-v1";
const PATH     = "contracts/hk-stx-bitflow-receiver-v1.clar";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const FEE      = Number(process.env.DEPLOY_FEE_USTX ?? 500_000);
const DRY_RUN  = process.env.DRY_RUN === "1";
const network  = STACKS_MAINNET;

function loadMnemonic() {
  if (process.env.MAINNET_MNEMONIC) return process.env.MAINNET_MNEMONIC.trim();
  if (existsSync("mbegu2")) return readFileSync("mbegu2", "utf8").trim();
  if (existsSync("mbegu"))  return readFileSync("mbegu", "utf8").trim();
  throw new Error("Set MAINNET_MNEMONIC env var, or place 24-word mnemonic in ./mbegu2");
}

async function getNonce(addr) {
  const res = await fetch(`${API}/v2/accounts/${addr}?proof=0`);
  return (await res.json()).nonce;
}

async function getBalance(addr) {
  const res = await fetch(`${API}/extended/v1/address/${addr}/balances`);
  return BigInt((await res.json()).stx.balance);
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

async function main() {
  const mnemonic = loadMnemonic();
  const wc = mnemonic.split(/\s+/).length;
  if (wc !== 24) throw new Error(`Expected 24-word mnemonic, got ${wc} words`);

  const wallet  = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk      = wallet.accounts[0].stxPrivateKey;
  const sender  = privateKeyToAddress(pk, "mainnet");
  const balance = await getBalance(sender);
  const nonce   = await getNonce(sender);

  console.log("=======================================================");
  console.log("    FlashStack -- Deploy hk-stx-bitflow-receiver-v1    ");
  console.log("=======================================================");
  console.log(`  Sender:   ${sender}`);
  console.log(`  Balance:  ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log(`  Fee:      ${FEE} microSTX (${FEE / 1e6} STX)`);
  console.log(`  Contract: ${sender}.${NAME}`);
  console.log(`  Source:   ${PATH}`);
  console.log(`  Network:  mainnet`);
  console.log(`  Mode:     ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}`);
  console.log();

  if (balance < BigInt(FEE)) {
    throw new Error(`Insufficient balance: ${balance} microSTX < fee ${FEE} microSTX`);
  }

  const tx = await makeContractDeploy({
    contractName:      NAME,
    codeBody:          readFileSync(PATH, "utf8"),
    senderKey:         pk,
    network,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee:               FEE,
    nonce,
  });

  if (DRY_RUN) {
    console.log("  DRY_RUN=1 -- not broadcasting. Set DRY_RUN=0 (or unset) to broadcast.");
    console.log(`  Built tx OK. Serialized length: ${tx.serialize().length} bytes-ish.`);
    return;
  }

  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid, "deploy hk-stx-bitflow-receiver-v1");

  console.log();
  console.log("=======================================================");
  console.log("                  DEPLOYMENT COMPLETE                   ");
  console.log("=======================================================");
  console.log(`  Contract:  ${sender}.${NAME}`);
  console.log(`  Tx:        ${EXPLORER}/${txid}?chain=mainnet`);
  console.log();
  console.log("  Next steps:");
  console.log(`  1. Ask Matt to whitelist ${sender}.${NAME}`);
  console.log("     (admin-only: add-approved-receiver on flashstack-stx-core)");
  console.log("  2. Send >=1 STX to the receiver to cover principal + fee + 2x Bitflow pool fee on repay");
  console.log("  3. Call flashstack-stx-core.flash-loan(u1000000, receiver)  ;; 1 STX round-trip");
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
