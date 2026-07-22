/**
 * FlashStack -- Seed hk-sbtc-real-receiver-v1 with canonical sBTC.
 *
 * Unlike the M1 STX seed (a native stx-transfer), this is a SIP-010 token transfer
 * of canonical sBTC from OUR wallet to the receiver contract. The receiver pays the
 * flash-loan fee AND absorbs the ~0.6% Velar round-trip loss from its own sBTC
 * balance inside the callback, so it must hold sBTC before the first loan.
 *
 * Seed sizing: see minimum_seed_analysis.md. For a 1,000-sat demo loan the safe
 * seed is ~500 sats (covers round-trip loss + fee with margin; recoverable via
 * rescue-sbtc). Default below is 500 sats.
 *
 * Usage:
 *   node scripts/seed-hk-sbtc-receiver.mjs              # reads ./mbegu2 then ./mbegu
 *   MAINNET_MNEMONIC="w1 ... w24" node scripts/seed-hk-sbtc-receiver.mjs
 *
 * Optional env:
 *   SEED_SATS=500       Seed size in sats (default 500).
 *   DRY_RUN=1           Build + print, do NOT broadcast.
 *   TX_FEE_USTX=10000   Tx fee (default 10_000 microSTX = 0.01 STX).
 */
import { makeContractCall, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const RECV_NAME  = "hk-sbtc-real-receiver-v1";
const SBTC_ADDR  = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_NAME  = "sbtc-token";
const API        = "https://api.hiro.so";
const EXPLORER   = "https://explorer.hiro.so/txid";
const SEED       = BigInt(process.env.SEED_SATS ?? 500);
const TX_FEE     = Number(process.env.TX_FEE_USTX ?? 10_000);
const DRY_RUN    = process.env.DRY_RUN === "1";
const network    = STACKS_MAINNET;

function loadMnemonic() {
  if (process.env.MAINNET_MNEMONIC) return process.env.MAINNET_MNEMONIC.trim();
  if (existsSync("mbegu2")) return readFileSync("mbegu2", "utf8").trim();
  if (existsSync("mbegu"))  return readFileSync("mbegu", "utf8").trim();
  throw new Error("Set MAINNET_MNEMONIC env var, or place 24-word mnemonic in ./mbegu2");
}
async function getNonce(addr) {
  return (await (await fetch(`${API}/v2/accounts/${addr}?proof=0`)).json()).nonce;
}
async function getSbtcBalance(addr) {
  const res = await fetch(`${API}/v2/contracts/call-read/${SBTC_ADDR}/${SBTC_NAME}/get-balance`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: addr, arguments: [Cl.serialize(Cl.principal(addr))] }),
  });
  const j = await res.json();
  // result is (ok uintN) hex; decode the trailing uint
  if (!j.okay) return null;
  const hex = j.result.replace(/^0x/, "");
  // 07 (ok) 01 (uint) + 16-byte big-endian
  const uintHex = hex.slice(4);
  return BigInt("0x" + uintHex);
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
  const nonce    = await getNonce(sender);
  const ourSbtc  = await getSbtcBalance(sender);

  console.log("=======================================================");
  console.log("  FlashStack -- seed hk-sbtc-real-receiver-v1 (sBTC)");
  console.log("=======================================================");
  console.log(`  Sender:        ${sender}`);
  console.log(`  Our sBTC:      ${ourSbtc === null ? "?" : ourSbtc} sats`);
  console.log(`  Nonce:         ${nonce}`);
  console.log(`  Recipient:     ${recipient}`);
  console.log(`  Seed:          ${SEED} sats`);
  console.log(`  Tx fee:        ${TX_FEE} microSTX`);
  console.log(`  Mode:          ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}\n`);

  if (ourSbtc !== null && ourSbtc < SEED) {
    throw new Error(`Insufficient sBTC: hold ${ourSbtc} sats < seed ${SEED} sats. Run scripts/buy-sbtc.mjs first.`);
  }

  // SIP-010 transfer: (transfer amount sender recipient memo)
  const tx = await makeContractCall({
    contractAddress: SBTC_ADDR,
    contractName:    SBTC_NAME,
    functionName:    "transfer",
    functionArgs: [
      Cl.uint(SEED),
      Cl.principal(sender),
      Cl.contractPrincipal(sender, RECV_NAME),
      Cl.none(),
    ],
    senderKey: pk, network, fee: TX_FEE, nonce,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
  });

  if (DRY_RUN) { console.log("  DRY_RUN=1 -- not broadcasting. Tx built OK."); return; }

  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid, "seed receiver (sBTC)");
  const recvBal = await getSbtcBalance(recipient);
  console.log(`\n  DONE. Receiver sBTC balance now: ${recvBal} sats`);
  console.log(`  Seed txid: ${txid}`);
}
main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
