/**
 * FlashStack — Withdraw STX from flashstack-stx-core reserve (admin only)
 *
 * Sends STX from the core contract reserve back to the admin wallet.
 * Use this to reclaim STX for gas or other purposes.
 *
 * Usage:
 *   MAINNET_MNEMONIC="word1 ... word24" node scripts/withdraw-reserve.mjs
 *
 * Optional env:
 *   WITHDRAW_AMOUNT_USTX=...   Amount to withdraw in microSTX (default: 5_000_000 = 5 STX)
 *   DRY_RUN=1                  Print tx details without broadcasting
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

const CORE_ADDRESS  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const CORE_NAME     = "flashstack-stx-core";
const API           = "https://api.hiro.so";
const EXPLORER      = "https://explorer.hiro.so/txid";
const CALL_FEE      = 10_000;
const DRY_RUN       = process.env.DRY_RUN === "1";
const WITHDRAW_AMOUNT = Number(process.env.WITHDRAW_AMOUNT_USTX ?? 5_000_000);

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

async function getReserve() {
  const res = await fetch(
    `${API}/v2/contracts/call-read/${CORE_ADDRESS}/${CORE_NAME}/get-reserve-balance`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: CORE_ADDRESS, arguments: [] }),
    }
  );
  const data = await res.json();
  const hex = data.result.replace("0x", "").replace(/^01/, "");
  return BigInt("0x" + hex);
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
      throw new Error("withdraw-reserve failed");
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
  const reserve  = await getReserve();
  const nonce    = await getNonce(sender);

  console.log("=======================================================");
  console.log(" FlashStack — Withdraw Reserve ");
  console.log("=======================================================");
  console.log(` Admin wallet:     ${sender}`);
  console.log(` Wallet balance:   ${Number(balance) / 1e6} STX`);
  console.log(` Core reserve:     ${Number(reserve) / 1e6} STX`);
  console.log(` Withdraw amount:  ${WITHDRAW_AMOUNT / 1e6} STX (${WITHDRAW_AMOUNT} microSTX)`);
  console.log(` Call fee:         ${CALL_FEE} microSTX`);
  console.log(` Nonce:            ${nonce}`);
  console.log(` Mode:             ${DRY_RUN ? "DRY RUN" : "LIVE BROADCAST"}`);
  console.log();

  if (BigInt(WITHDRAW_AMOUNT) > reserve) {
    throw new Error(`Withdraw amount ${WITHDRAW_AMOUNT} exceeds reserve ${reserve}`);
  }
  if (balance < BigInt(CALL_FEE)) {
    throw new Error(`Insufficient STX for fee: ${balance} microSTX < ${CALL_FEE}`);
  }

  const tx = await makeContractCall({
    contractAddress: CORE_ADDRESS,
    contractName:    CORE_NAME,
    functionName:    "withdraw-reserve",
    functionArgs:    [Cl.uint(WITHDRAW_AMOUNT)],
    senderKey:       pk,
    network:         STACKS_MAINNET,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:      1,
    fee:             CALL_FEE,
    nonce,
  });

  if (DRY_RUN) {
    console.log(" DRY_RUN=1 — tx built but not broadcast.");
    return;
  }

  const txid = await broadcast(tx);
  console.log(` Broadcast: ${txid}`);
  console.log(` Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid);

  console.log();
  console.log("=======================================================");
  console.log(" WITHDRAWAL COMPLETE");
  console.log("=======================================================");
  console.log(` ${WITHDRAW_AMOUNT / 1e6} STX withdrawn to ${sender}`);
  console.log(` Tx: ${EXPLORER}/${txid}?chain=mainnet`);
  console.log(` Remaining reserve: ~${(Number(reserve) - WITHDRAW_AMOUNT) / 1e6} STX`);
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
