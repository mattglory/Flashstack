/**
 * FlashStack -- Seed hk-stx-bitflow-receiver-v1 with STX.
 *
 * The receiver pays the flash-loan fee (and absorbs round-trip slippage) from its
 * OWN balance inside the callback, so it must hold STX before the first loan.
 *
 * Usage:
 *   node scripts/seed-bitflow-receiver.mjs            # reads ./mbegu2 then ./mbegu
 *   MAINNET_MNEMONIC="w1 ... w24" node scripts/seed-bitflow-receiver.mjs
 *
 * Optional env:
 *   SEED_USTX=1000000   Seed size in microSTX (default 1 STX).
 *   DRY_RUN=1           Build + print, do NOT broadcast.
 *   TX_FEE_USTX=10000   Tx fee (default 10_000 microSTX = 0.01 STX).
 */
import { makeSTXTokenTransfer, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const RECV_NAME = "hk-stx-bitflow-receiver-v1";
const API       = "https://api.hiro.so";
const EXPLORER  = "https://explorer.hiro.so/txid";
const SEED      = BigInt(process.env.SEED_USTX ?? 1_000_000);
const TX_FEE    = Number(process.env.TX_FEE_USTX ?? 10_000);
const DRY_RUN   = process.env.DRY_RUN === "1";
const network   = STACKS_MAINNET;

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
async function broadcast(tx) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
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
    if (data.tx_status?.startsWith("abort")) throw new Error(`"${label}" failed: ${data.tx_result?.repr}`);
    process.stdout.write(".");
  }
  throw new Error(`Timeout: "${label}"`);
}

async function main() {
  const mnemonic = loadMnemonic();
  const wallet   = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk       = wallet.accounts[0].stxPrivateKey;
  const sender   = privateKeyToAddress(pk, "mainnet");
  const recipient = `${sender}.${RECV_NAME}`;
  const balance  = await getBalance(sender);
  const nonce    = await getNonce(sender);

  console.log("=======================================================");
  console.log("  FlashStack -- seed hk-stx-bitflow-receiver-v1");
  console.log("=======================================================");
  console.log(`  Sender:    ${sender}`);
  console.log(`  Balance:   ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:     ${nonce}`);
  console.log(`  Recipient: ${recipient}`);
  console.log(`  Seed:      ${SEED} microSTX (${Number(SEED)/1e6} STX)`);
  console.log(`  Tx fee:    ${TX_FEE} microSTX`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}\n`);

  const tx = await makeSTXTokenTransfer({
    recipient, amount: SEED, senderKey: pk, network, fee: TX_FEE, nonce,
    memo: "seed hk-stx-bitflow-receiver-v1",
  });

  if (DRY_RUN) { console.log("  DRY_RUN=1 -- not broadcasting. Tx built OK."); return; }

  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid, "seed receiver");
  const recvBal = await getBalance(recipient);
  console.log(`\n  DONE. Receiver balance now: ${Number(recvBal)/1e6} STX`);
  console.log(`  Seed txid: ${txid}`);
}
main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
