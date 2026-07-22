/**
 * FlashStack -- Acquire canonical sBTC by swapping STX on Velar pool 70.
 *
 * Funding helper for the sBTC receiver seed. Calls univ2-router
 * swap-exact-tokens-for-tokens(wSTX -> sBTC) on pool 70, signed by OUR wallet.
 * Velar's `wstx` is a native-STX wrapper, so the router pulls STX directly; the
 * acquired sBTC lands in our wallet, ready for seed-hk-sbtc-receiver.mjs.
 *
 * Sizing: 1 sat ~= 3,390 microSTX at pool-70 mid (2026-06-06). To acquire ~1,000
 * sats spend ~3.4 STX; ~1,500 sats ~5.1 STX. See minimum_seed_analysis.md.
 *
 * Usage:
 *   node scripts/buy-sbtc.mjs                  # reads ./mbegu2 then ./mbegu
 *   BUY_USTX=5100000 node scripts/buy-sbtc.mjs # spend 5.1 STX (~1500 sats)
 *
 * Optional env:
 *   BUY_USTX=3500000   STX to spend, in microSTX (default 3.5 STX ~= 1000 sats).
 *   MIN_OUT_SATS=1     Minimum sBTC out (default 1; deep pool + tiny trade).
 *   DRY_RUN=1          Build + print (with live quote), do NOT broadcast.
 *   TX_FEE_USTX=...    Tx fee (default 200_000 microSTX = 0.2 STX).
 */

import { makeContractCall, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync, existsSync } from "fs";

const ROUTER_ADDR = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1";
const ROUTER_NAME = "univ2-router";
const WSTX        = ["SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1", "wstx"];
const SBTC        = ["SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"];
const SHARE_FEE   = ["SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1", "univ2-share-fee-to"];
const POOL_ADDR   = "SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY";
const POOL_NAME   = "univ2-pool-v1_0_0-0070";
const API         = "https://api.hiro.so";
const EXPLORER    = "https://explorer.hiro.so/txid";
const BUY_USTX    = BigInt(process.env.BUY_USTX ?? 3_500_000);
const MIN_OUT     = BigInt(process.env.MIN_OUT_SATS ?? 1);
const TX_FEE      = Number(process.env.TX_FEE_USTX ?? 200_000);
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
async function getStxBalance(addr) {
  return BigInt((await (await fetch(`${API}/extended/v1/address/${addr}/balances`)).json()).stx.balance);
}
// Live pool-70 reserves -> expected sBTC out for amtIn wSTX (univ2, 0.3% fee)
async function quote(amtIn) {
  const res = await fetch(`${API}/v2/contracts/call-read/${POOL_ADDR}/${POOL_NAME}/get-pool`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: POOL_ADDR, arguments: [] }),
  });
  const j = await res.json();
  if (!j.okay) return null;
  // crude extraction of reserve0/reserve1 from the tuple hex by re-reading via /extended is messy;
  // instead use the known field order is not guaranteed -> fetch reserves from token balances of pool.
  // Fallback: use balances endpoint of the pool contract for wstx + sbtc.
  return null;
}
async function poolReserves() {
  const r = await fetch(`${API}/extended/v1/address/${POOL_ADDR}.${POOL_NAME}/balances`).then(x => x.json());
  // Velar holds reserves in the pool contract account
  return r;
}
function expectedOut(amtIn, r0, r1) {
  // wstx(in,r0) -> sbtc(out,r1): out = (in*9970*r1)/(r0*10000 + in*9970)
  const inFee = amtIn * 9970n;
  return (inFee * r1) / (r0 * 10000n + inFee);
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
  const balance  = await getStxBalance(sender);
  const nonce    = await getNonce(sender);

  // Best-effort live quote from pool reserves
  let expSats = null;
  try {
    const bal = await poolReserves();
    const r0 = BigInt(bal.stx.balance); // pool's STX (wSTX) reserve
    const sbtcKey = Object.keys(bal.fungible_tokens || {}).find(k => k.toLowerCase().includes("sbtc-token"));
    const r1 = sbtcKey ? BigInt(bal.fungible_tokens[sbtcKey].balance) : null;
    if (r1) expSats = expectedOut(BUY_USTX, r0, r1);
  } catch { /* quote is advisory only */ }

  console.log("=======================================================");
  console.log("  FlashStack -- buy sBTC on Velar pool 70 (STX -> sBTC)");
  console.log("=======================================================");
  console.log(`  Sender:        ${sender}`);
  console.log(`  STX balance:   ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:         ${nonce}`);
  console.log(`  Spend:         ${BUY_USTX} microSTX (${Number(BUY_USTX) / 1e6} STX)`);
  console.log(`  Expected out:  ${expSats === null ? "(quote unavailable)" : expSats + " sats (advisory)"}`);
  console.log(`  Min out:       ${MIN_OUT} sats`);
  console.log(`  Tx fee:        ${TX_FEE} microSTX`);
  console.log(`  Mode:          ${DRY_RUN ? "DRY RUN (no broadcast)" : "LIVE BROADCAST"}\n`);

  if (balance < BUY_USTX + BigInt(TX_FEE)) {
    throw new Error(`Insufficient STX: ${balance} < spend ${BUY_USTX} + fee ${TX_FEE}`);
  }

  const tx = await makeContractCall({
    contractAddress: ROUTER_ADDR,
    contractName:    ROUTER_NAME,
    functionName:    "swap-exact-tokens-for-tokens",
    functionArgs: [
      Cl.uint(70),
      Cl.contractPrincipal(...WSTX),       // token0
      Cl.contractPrincipal(...SBTC),       // token1
      Cl.contractPrincipal(...WSTX),       // token-in  (wSTX -> pulls native STX)
      Cl.contractPrincipal(...SBTC),       // token-out (sBTC)
      Cl.contractPrincipal(...SHARE_FEE),  // share-fee-to
      Cl.uint(BUY_USTX),                   // amt-in
      Cl.uint(MIN_OUT),                    // amt-out-min
    ],
    senderKey: pk, network, fee: TX_FEE, nonce,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
  });

  if (DRY_RUN) { console.log("  DRY_RUN=1 -- not broadcasting. Tx built OK."); return; }

  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid, "buy sBTC on Velar");
  console.log("\n  DONE. Check your sBTC balance, then run scripts/seed-hk-sbtc-receiver.mjs");
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
