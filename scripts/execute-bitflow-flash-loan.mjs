/**
 * FlashStack -- Execute a flash loan through hk-stx-bitflow-receiver-v1
 *
 * Calls flashstack-stx-core.flash-loan(amount, receiver) signed by OUR wallet.
 * The receiver must already be (a) deployed and (b) whitelisted by Matt, and
 * (c) seeded with >= 1 STX to cover the fee + Bitflow pool fees.
 *
 * Usage:
 *   MAINNET_MNEMONIC="word1 ... word24" node scripts/execute-bitflow-flash-loan.mjs
 * Or with ./mbegu2 (or ./mbegu) holding the 24-word mnemonic:
 *   node scripts/execute-bitflow-flash-loan.mjs
 *
 * Optional env:
 *   AMOUNT_USTX=1000000   Loan size in microSTX (default 1 STX).
 *   DRY_RUN=1             Build + print, do NOT broadcast.
 *   TX_FEE_USTX=...       Tx fee (default 300_000 microSTX = 0.3 STX).
 */

import { makeContractCall, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const CORE_ADDR   = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const CORE_NAME   = "flashstack-stx-core";
const RECV_NAME   = "hk-stx-bitflow-receiver-v1";
const API         = "https://api.hiro.so";
const EXPLORER    = "https://explorer.hiro.so/txid";
const AMOUNT      = BigInt(process.env.AMOUNT_USTX ?? 1_000_000);
const TX_FEE      = Number(process.env.TX_FEE_USTX ?? 300_000);
const DRY_RUN     = process.env.DRY_RUN === "1";
const network     = STACKS_MAINNET;

function loadMnemonic() {
  if (process.env.MAINNET_MNEMONIC) return process.env.MAINNET_MNEMONIC.trim();
  if (existsSync("mbegu2")) return readFileSync("mbegu2", "utf8").trim();
  if (existsSync("mbegu"))  return readFileSync("mbegu", "utf8").trim();
  throw new Error("Set MAINNET_MNEMONIC env var, or place 24-word mnemonic in ./mbegu2");
}

async function getNonce(addr) {
  return (await (await fetch(`${API}/v2/accounts/${addr}?proof=0`)).json()).nonce;
}
async function getBalance(addr) {
  return BigInt((await (await fetch(`${API}/extended/v1/address/${addr}/balances`)).json()).stx.balance);
}
async function readBool(path, fn, args, sender) {
  const res = await fetch(`${API}/v2/contracts/call-read/${CORE_ADDR}/${CORE_NAME}/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, arguments: args }),
  });
  return res.json();
}

async function broadcast(tx) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0,200)}`); }
  if (data?.error) throw new Error(`${data.error} -- ${data.reason ?? ""}`);
  return typeof data === "string" ? data : data.txid;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const data = await (await fetch(`${API}/extended/v1/tx/0x${txid}`)).json();
    if (data.tx_status === "success") { console.log(` confirmed. result=${data.tx_result?.repr}`); return data; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(`\n  FAILED: ${data.tx_result?.repr ?? "unknown"}`);
      throw new Error(`"${label}" failed: ${data.tx_result?.repr}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: "${label}"`);
}

async function main() {
  const mnemonic = loadMnemonic();
  const wallet   = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk       = wallet.accounts[0].stxPrivateKey;
  const sender   = privateKeyToAddress(pk, "mainnet");
  const receiver = `${sender}.${RECV_NAME}`;
  const balance  = await getBalance(sender);
  const nonce    = await getNonce(sender);

  console.log("=======================================================");
  console.log("  FlashStack -- flash-loan via hk-stx-bitflow-receiver-v1");
  console.log("=======================================================");
  console.log(`  Sender:    ${sender}`);
  console.log(`  Balance:   ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:     ${nonce}`);
  console.log(`  Core:      ${CORE_ADDR}.${CORE_NAME}`);
  console.log(`  Receiver:  ${receiver}`);
  console.log(`  Amount:    ${AMOUNT} microSTX (${Number(AMOUNT)/1e6} STX)`);
  console.log(`  Tx fee:    ${TX_FEE} microSTX`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}`);
  console.log();

  // Preflight read-only checks
  const approved = await readBool("is-approved-receiver", "is-approved-receiver",
    [Cl.serialize(Cl.contractPrincipal(sender, RECV_NAME))], sender).catch(() => null);
  console.log(`  Preflight is-approved-receiver -> ${JSON.stringify(approved?.result ?? approved)}`);
  const stats = await (await fetch(`${API}/v2/contracts/call-read/${CORE_ADDR}/${CORE_NAME}/get-stats`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, arguments: [] }) })).json().catch(() => null);
  console.log(`  Preflight get-stats raw -> ${JSON.stringify(stats?.result ?? stats)?.slice(0,160)}`);

  const tx = await makeContractCall({
    contractAddress: CORE_ADDR,
    contractName:    CORE_NAME,
    functionName:    "flash-loan",
    functionArgs:    [Cl.uint(AMOUNT), Cl.contractPrincipal(sender, RECV_NAME)],
    senderKey:       pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:      1,
    fee:             TX_FEE,
    nonce,
  });

  if (DRY_RUN) {
    console.log("\n  DRY_RUN=1 -- not broadcasting. Tx built OK.");
    return;
  }

  const txid = await broadcast(tx);
  console.log(`\n  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  const res = await waitForConfirm(txid, "flash-loan via bitflow receiver");
  console.log("\n  DONE. Save this txid as on-chain evidence.");
  console.log(`  ${EXPLORER}/${txid}?chain=mainnet`);
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
