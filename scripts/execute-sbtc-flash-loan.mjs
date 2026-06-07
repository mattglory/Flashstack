/**
 * FlashStack -- Execute a flash loan through hk-sbtc-real-receiver-v1
 *
 * Calls flashstack-sbtc-core.flash-loan(amount, receiver) signed by OUR wallet.
 * The receiver must already be (a) deployed, (b) whitelisted by Matt
 * (add-approved-receiver), and (c) seeded with sBTC (>= round-trip loss + fee).
 *
 * Usage:
 *   MAINNET_MNEMONIC="word1 ... word24" node scripts/execute-sbtc-flash-loan.mjs
 * Or with ./mbegu2 (or ./mbegu) holding the 24-word mnemonic:
 *   node scripts/execute-sbtc-flash-loan.mjs
 *
 * Optional env:
 *   AMOUNT_SATS=1000   Loan size in sats (default 1000 -- Matt's stated demo size).
 *   DRY_RUN=1          Build + print, do NOT broadcast.
 *   TX_FEE_USTX=...    Tx fee (default 300_000 microSTX = 0.3 STX).
 */

import { makeContractCall, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const CORE_ADDR  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const CORE_NAME  = "flashstack-sbtc-core";
const RECV_NAME  = "hk-sbtc-real-receiver-v1";
const SBTC_ADDR  = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const SBTC_NAME  = "sbtc-token";
const API        = "https://api.hiro.so";
const EXPLORER   = "https://explorer.hiro.so/txid";
const AMOUNT     = BigInt(process.env.AMOUNT_SATS ?? 1000);
const TX_FEE     = Number(process.env.TX_FEE_USTX ?? 300_000);
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
async function getStxBalance(addr) {
  return BigInt((await (await fetch(`${API}/extended/v1/address/${addr}/balances`)).json()).stx.balance);
}
function decodeOkUint(hex) {
  // 07 (ok) 01 (uint) + 16-byte big-endian
  const h = hex.replace(/^0x/, "");
  if (!h.startsWith("0701")) return null;
  return BigInt("0x" + h.slice(4));
}
function decodeOkBool(hex) {
  // 07 (ok) then 03 (true) / 04 (false)
  const h = hex.replace(/^0x/, "");
  if (h.startsWith("0703")) return true;
  if (h.startsWith("0704")) return false;
  return null;
}
async function readFn(addr, name, fn, args, sender) {
  const res = await fetch(`${API}/v2/contracts/call-read/${addr}/${name}/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, arguments: args }),
  });
  return res.json();
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
  const balance  = await getStxBalance(sender);
  const nonce    = await getNonce(sender);

  console.log("=======================================================");
  console.log("  FlashStack -- flash-loan via hk-sbtc-real-receiver-v1");
  console.log("=======================================================");
  console.log(`  Sender:    ${sender}`);
  console.log(`  Balance:   ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:     ${nonce}`);
  console.log(`  Core:      ${CORE_ADDR}.${CORE_NAME}`);
  console.log(`  Receiver:  ${receiver}`);
  console.log(`  Amount:    ${AMOUNT} sats`);
  console.log(`  Tx fee:    ${TX_FEE} microSTX`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}`);
  console.log();

  // --- Preflight read-only checks ---
  // 1. is-approved-receiver -> (ok bool) -- MUST be true
  const apprRaw = await readFn(CORE_ADDR, CORE_NAME, "is-approved-receiver",
    [Cl.serialize(Cl.contractPrincipal(sender, RECV_NAME))], sender).catch(() => null);
  const approved = apprRaw?.okay ? decodeOkBool(apprRaw.result) : null;
  console.log(`  Preflight is-approved-receiver -> ${approved}`);

  // 2. reserve >= amount
  const resRaw = await readFn(CORE_ADDR, CORE_NAME, "get-reserve-balance", [], sender).catch(() => null);
  const reserve = resRaw?.okay ? decodeOkUint(resRaw.result) : null;
  console.log(`  Preflight reserve            -> ${reserve} sats (need >= ${AMOUNT})`);

  // 3. receiver sBTC balance (seed) -- should cover round-trip loss + fee
  const recvRaw = await readFn(SBTC_ADDR, SBTC_NAME, "get-balance",
    [Cl.serialize(Cl.contractPrincipal(sender, RECV_NAME))], sender).catch(() => null);
  const recvSbtc = recvRaw?.okay ? decodeOkUint(recvRaw.result) : null;
  console.log(`  Preflight receiver sBTC seed -> ${recvSbtc} sats`);

  // 4. estimate-repayment from the receiver (fee math)
  const estRaw = await readFn(sender, RECV_NAME, "estimate-repayment",
    [Cl.serialize(Cl.uint(AMOUNT))], sender).catch(() => null);
  console.log(`  Preflight estimate-repayment -> ${estRaw?.okay ? estRaw.result.slice(0, 80) + "..." : "n/a (receiver not deployed yet?)"}`);

  // Guards (warn-only in DRY_RUN; hard-stop in live)
  const problems = [];
  if (approved === false) problems.push("receiver is NOT whitelisted (ask Matt to add-approved-receiver)");
  if (reserve !== null && reserve < AMOUNT) problems.push(`reserve ${reserve} < amount ${AMOUNT}`);
  if (recvSbtc !== null && recvSbtc === 0n) problems.push("receiver holds 0 sBTC seed (run seed-hk-sbtc-receiver.mjs)");
  if (problems.length) {
    console.log("\n  PREFLIGHT WARNINGS:");
    problems.forEach(p => console.log(`   - ${p}`));
    if (!DRY_RUN) throw new Error("Preflight failed; refusing to broadcast. Fix the above or run with DRY_RUN=1.");
  }

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
  await waitForConfirm(txid, "flash-loan via sBTC receiver");
  console.log("\n  DONE. Save this txid as on-chain evidence (look for the sbtc-velar-roundtrip print event).");
  console.log(`  ${EXPLORER}/${txid}?chain=mainnet`);
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
