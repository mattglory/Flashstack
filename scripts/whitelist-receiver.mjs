/**
 * FlashStack — Whitelist a receiver on flashstack-stx-core (admin only)
 *
 * Calls add-approved-receiver so the given principal can call flash-loan.
 *
 * Usage:
 *   RECEIVER="SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW.hk-stx-real-receiver-v1" \
 *   MAINNET_MNEMONIC="word1 ... word24" node scripts/whitelist-receiver.mjs
 *
 * Optional:
 *   DRY_RUN=1   Build tx but do not broadcast
 */

import {
  makeContractCall,
  PostConditionMode,
  Cl,
  privateKeyToAddress,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const CORE_ADDRESS = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const CORE_NAME    = "flashstack-stx-core";
const API          = "https://api.hiro.so";
const EXPLORER     = "https://explorer.hiro.so/txid";
const CALL_FEE     = 10_000;
const DRY_RUN      = process.env.DRY_RUN === "1";
const RECEIVER     = process.env.RECEIVER;

if (!RECEIVER) {
  console.error("ERROR: Set RECEIVER env var");
  console.error('  RECEIVER="SP....contract-name" MAINNET_MNEMONIC="..." node scripts/whitelist-receiver.mjs');
  process.exit(1);
}

// Parse "address.contract-name"
const [receiverAddress, receiverName] = RECEIVER.split(".");
if (!receiverAddress || !receiverName) {
  console.error(`ERROR: RECEIVER must be in format "Address.contract-name", got: ${RECEIVER}`);
  process.exit(1);
}

function loadMnemonic() {
  if (process.env.MAINNET_MNEMONIC) return process.env.MAINNET_MNEMONIC.trim();
  if (existsSync("mbegu")) return readFileSync("mbegu", "utf8").trim();
  throw new Error("Set MAINNET_MNEMONIC env var, or place 24-word mnemonic in ./mbegu");
}

async function getNonce(addr) {
  const res = await fetch(`${API}/v2/accounts/${addr}?proof=0`);
  return (await res.json()).nonce;
}

async function getBalance(addr) {
  const res = await fetch(`${API}/extended/v1/address/${addr}/balances`);
  return BigInt((await res.json()).stx.balance);
}

async function isAlreadyApproved(receiver) {
  const res = await fetch(
    `${API}/v2/contracts/call-read/${CORE_ADDRESS}/${CORE_NAME}/is-approved-receiver`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: CORE_ADDRESS,
        arguments: [Cl.serialize(Cl.principal(receiver)).toString("hex")],
      }),
    }
  );
  const data = await res.json();
  return data.result === "0x03"; // 0x03 = true in Clarity
}

async function broadcast(tx) {
  const raw = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res = await fetch(`${API}/v2/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${data.error} -- ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`No txid: ${text.slice(0, 200)}`);
  return txid;
}

async function waitForConfirm(txid) {
  process.stdout.write(" Waiting for confirmation");
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(`\n FAILED: ${data.tx_result?.repr ?? "unknown"}`);
      throw new Error("add-approved-receiver failed");
    }
    process.stdout.write(".");
  }
  throw new Error("Timeout waiting for confirmation");
}

async function main() {
  const mnemonic = loadMnemonic();
  const wallet   = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk       = wallet.accounts[0].stxPrivateKey;
  const sender   = privateKeyToAddress(pk, "mainnet");
  const balance  = await getBalance(sender);
  const nonce    = await getNonce(sender);

  console.log("=======================================================");
  console.log(" FlashStack — Whitelist Receiver");
  console.log("=======================================================");
  console.log(` Admin wallet: ${sender}`);
  console.log(` Balance:      ${Number(balance) / 1e6} STX`);
  console.log(` Nonce:        ${nonce}`);
  console.log(` Receiver:     ${RECEIVER}`);
  console.log(` Mode:         ${DRY_RUN ? "DRY RUN" : "LIVE BROADCAST"}`);
  console.log();

  if (balance < BigInt(CALL_FEE)) {
    throw new Error(`Insufficient STX for fee: ${balance} < ${CALL_FEE}`);
  }

  if (DRY_RUN) {
    console.log(" DRY_RUN=1 — skipping broadcast.");
    return;
  }

  const tx = await makeContractCall({
    contractAddress: CORE_ADDRESS,
    contractName:    CORE_NAME,
    functionName:    "add-approved-receiver",
    functionArgs:    [Cl.principal(RECEIVER)],
    senderKey:       pk,
    network:         STACKS_MAINNET,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:      1,
    fee:             CALL_FEE,
    nonce,
  });

  const txid = await broadcast(tx);
  console.log(` Broadcast: ${txid}`);
  console.log(` Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid);

  console.log();
  console.log("=======================================================");
  console.log(" WHITELIST COMPLETE");
  console.log("=======================================================");
  console.log(` ${RECEIVER} is now approved on flashstack-stx-core`);
  console.log(` Tx: ${EXPLORER}/${txid}?chain=mainnet`);
  console.log();
  console.log(" Hillary can now:");
  console.log("   1. Send >=1 STX to the receiver");
  console.log("   2. Call flashstack-stx-core.flash-loan(amount, receiver)");
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
