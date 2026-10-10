/**
 * FlashStack - Bitflow STX/stSTX Arb Monitor
 *
 * Watches the Bitflow STX/stSTX stableswap pool for profitable round-trip
 * arb. When profitable: flash-borrows STX from FlashStack, executes via
 * bitflow-arb-receiver-v5.
 *
 * Pool:     SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2
 * Token X:  STX (native, 6 decimals)
 * Token Y:  stSTX (SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token, 6 decimals)
 * Receiver: SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver-v5
 *           (PR #96 -- not yet deployed; this monitor runs correctly in
 *           dry-run mode regardless, since the pool itself is live and
 *           real. EXECUTE mode will fail until the receiver is deployed
 *           and approved on flashstack-stx-core.)
 *
 * Arb opportunity:
 *   stSTX accrues staking yield continuously, so it drifts above peg
 *   relative to STX between pool rebalances. Flash-borrow STX, swap for
 *   stSTX, swap back for more STX, repay FlashStack (0.05% fee), keep
 *   the spread. Confirmed live: both decimals are 6 (no unit-conversion
 *   factor needed, unlike ALEX's 8-decimal wSTX-v2/ALEX pair), and the
 *   pool exposes get-dy/get-dx read-only quote functions directly --
 *   no manual constant-product math needed, unlike ALEX's AMM.
 *
 * Usage:
 *   node scripts/monitor-bitflow-arb.mjs
 *   EXECUTE=true LOAN_STX=50 DEPLOYER_MNEMONIC="..." node scripts/monitor-bitflow-arb.mjs
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  — 24-word mnemonic (required for EXECUTE=true; must
 *                        be bitflow-arb-receiver-v5's contract-owner)
 *   EXECUTE            — "true" to auto-execute when profitable (default: dry-run)
 *   LOAN_STX           — loan size in whole STX (default: 10)
 *   INTERVAL_MS        — scan interval in ms (default: 30000)
 *   MIN_PROFIT_STX     — minimum profit threshold in whole STX (default: 0.01)
 *   HIRO_API_KEY       — optional Hiro API key for higher rate limits
 */

import {
  makeContractCall,
  PostConditionMode,
  Cl,
  cvToHex,
  hexToCV,
  cvToValue,
  getAddressFromPrivateKey,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC       = process.env.DEPLOYER_MNEMONIC;
const EXECUTE        = process.env.EXECUTE === "true";
const INTERVAL       = parseInt(process.env.INTERVAL_MS    ?? "30000");
const LOAN_STX_MICRO = parseInt(process.env.LOAN_STX       ?? "10") * 1_000_000;
const MIN_PROFIT     = parseFloat(process.env.MIN_PROFIT_STX ?? "0.01") * 1_000_000;
const HIRO_API_KEY   = process.env.HIRO_API_KEY;

const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_MAINNET;

// Bitflow stableswap pool
const POOL_ADDR = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const POOL_NAME = "stableswap-stx-ststx-v-1-2";
const LP_TOKEN  = `${POOL_ADDR}.stx-ststx-lp-token-v-1-2`;
const STSTX     = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token";

// FlashStack receiver
const RECEIVER = `${DEPLOYER}.bitflow-arb-receiver-v5`;

if (EXECUTE && !MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC to execute transactions");
  process.exit(1);
}

function hiroFetch(url, opts = {}) {
  if (HIRO_API_KEY) opts = { ...opts, headers: { ...opts?.headers, "x-api-key": HIRO_API_KEY } };
  return fetch(url, opts);
}

async function readOnly(functionName, args) {
  try {
    const res = await hiroFetch(`${API}/v2/contracts/call-read/${POOL_ADDR}/${POOL_NAME}/${functionName}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: POOL_ADDR, arguments: args }),
    }).then((r) => r.json());
    if (!res.okay) return null;
    return hexToCV(res.result);
  } catch {
    return null;
  }
}

const sttTokenArg = cvToHex(Cl.contractPrincipal(...STSTX.split(".")));
const lpTokenArg  = cvToHex(Cl.contractPrincipal(...LP_TOKEN.split(".")));

// ── Get stSTX out for given STX in (leg 1 quote) ────────────────────────────
async function getSttxForStx(dxMicro) {
  const cv = await readOnly("get-dy", [sttTokenArg, lpTokenArg, cvToHex(Cl.uint(dxMicro))]);
  if (!cv) return null;
  const v = cvToValue(cv, true);
  return v?.value ? BigInt(v.value) : null;
}

// ── Get STX out for given stSTX in (leg 2 quote) ────────────────────────────
async function getStxForSttx(dySttx) {
  const cv = await readOnly("get-dx", [sttTokenArg, lpTokenArg, cvToHex(Cl.uint(dySttx))]);
  if (!cv) return null;
  const v = cvToValue(cv, true);
  return v?.value ? BigInt(v.value) : null;
}

// ── Get pool liquidity for display ───────────────────────────────────────────
async function getPoolLiquidity() {
  const cv = await readOnly("get-pair-data", [sttTokenArg, lpTokenArg]);
  if (!cv) return null;
  const v = cvToValue(cv, true);
  const data = v?.value;
  if (!data) return null;
  return {
    balStx:   BigInt(data["balance-x"].value),
    balSttx:  BigInt(data["balance-y"].value),
  };
}

// ── Check arb opportunity ─────────────────────────────────────────────────────
async function checkBitflowArb(loanMicro) {
  const fee     = BigInt(Math.max(1, Math.floor(loanMicro * 5 / 10000)));
  const gasCost = 300_000n; // two txs: set-min-ststx-out + flash-loan, same estimate as the ALEX monitor
  const owed    = BigInt(loanMicro) + fee;

  const sttxOut = await getSttxForStx(loanMicro);
  if (!sttxOut || sttxOut === 0n) return null;

  const stxBackMicro = await getStxForSttx(sttxOut);
  if (!stxBackMicro || stxBackMicro === 0n) return null;

  const profit = stxBackMicro - owed - gasCost;

  return {
    loanMicro,
    sttxOut,
    stxBackMicro,
    fee,
    gasCost,
    owed,
    profit,
    profitable: profit > 0n && profit >= BigInt(Math.floor(MIN_PROFIT)),
  };
}

// ── Broadcast one signed tx, return its txid ────────────────────────────────────
async function broadcastOne(tx) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${data.error} -- ${data.reason ?? ""}`);
  return typeof data === "string" ? data : data.txid;
}

// ── Execute flash loan ────────────────────────────────────────────────────────
// bitflow-arb-receiver-v5 requires min-ststx-out set fresh before every call,
// same reasoning and same auto-reset-after-use design as
// alex-arb-receiver-v5 -- learned the hard way on the ALEX monitor (PR #99),
// built correctly here from the start.
async function executeBitflowArb(loanMicro, sttxOut) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const signer = getAddressFromPrivateKey(pk, "mainnet");
  let   nonce  = await fetch(`${API}/v2/accounts/${signer}?proof=0`)
    .then((r) => r.json()).then((d) => d.nonce);

  const minSttxOut = (sttxOut * 99n) / 100n; // 1% slippage tolerance off this scan's own quote
  console.log(`  Setting min-ststx-out: ${Number(minSttxOut) / 1e6} stSTX (1% below quoted ${Number(sttxOut) / 1e6})`);

  const setMinTx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "bitflow-arb-receiver-v5",
    functionName:      "set-min-ststx-out",
    functionArgs:      [Cl.uint(minSttxOut)],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               50_000,
  });
  const setMinTxid = await broadcastOne(setMinTx);
  console.log(`  set-min-ststx-out broadcast: ${EXPLORER}/0x${setMinTxid}?chain=mainnet`);
  nonce += 1;

  console.log(`  Executing ${loanMicro / 1e6} STX Bitflow arb flash loan...`);

  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "flash-loan",
    functionArgs:      [Cl.uint(loanMicro), Cl.principal(RECEIVER)],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });

  let txid;
  try {
    txid = await broadcastOne(tx);
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    return null;
  }
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);
  return txid;
}

// ── Main scan ─────────────────────────────────────────────────────────────────
async function scan() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Scanning Bitflow STX/stSTX pool...`);

  // No "price" printed from the raw balances here -- this is a stableswap
  // pool, which deliberately holds unequal reserves to track the peg via
  // its curve invariant, not a constant-product pool. balance-x/balance-y
  // is not a meaningful exchange rate; only get-dy/get-dx (used below) are.
  const liq = await getPoolLiquidity();
  if (liq) {
    console.log(`  Pool liquidity: ${(Number(liq.balStx) / 1e6).toFixed(0)} STX | ${(Number(liq.balSttx) / 1e6).toFixed(0)} stSTX`);
  }

  const arb = await checkBitflowArb(LOAN_STX_MICRO);
  if (!arb) {
    console.log("  Could not fetch Bitflow pool quote -- rate-limited or pool paused");
    return;
  }

  const profitStx = Number(arb.profit) / 1e6;
  const sttxOut    = Number(arb.sttxOut) / 1e6;
  const stxBack    = Number(arb.stxBackMicro) / 1e6;

  console.log(`\n  BITFLOW ARB (loan: ${arb.loanMicro / 1e6} STX)`);
  console.log(`  Leg 1 out:   ${sttxOut.toFixed(6)} stSTX`);
  console.log(`  Leg 2 back:  ${stxBack.toFixed(6)} STX`);
  console.log(`  Flash fee:   ${Number(arb.fee) / 1e6} STX (0.05%)`);
  console.log(`  Gas est:     ${Number(arb.gasCost) / 1e6} STX`);
  console.log(`  Total owed:  ${Number(arb.owed) / 1e6} STX`);
  console.log(`  Est. profit: ${profitStx.toFixed(6)} STX`);

  if (arb.profitable) {
    console.log(`\n  *** ARB OPPORTUNITY *** +${profitStx.toFixed(4)} STX`);
    console.log(`  stSTX trading above fair value -- round-trip profitable`);
    if (EXECUTE) {
      await executeBitflowArb(arb.loanMicro, arb.sttxOut);
    } else {
      console.log(`  (dry-run -- set EXECUTE=true DEPLOYER_MNEMONIC="..." to trigger)`);
    }
  } else {
    console.log(`  No arb -- deficit ${(-profitStx).toFixed(6)} STX (stSTX near fair value)`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("==========================================================");
  console.log("  FlashStack — Bitflow STX/stSTX Arb Monitor");
  console.log("==========================================================");
  console.log(`  Mode:       ${EXECUTE ? "LIVE EXECUTION" : "dry-run (monitoring only)"}`);
  console.log(`  Loan size:  ${LOAN_STX_MICRO / 1e6} STX`);
  console.log(`  Min profit: ${MIN_PROFIT / 1e6} STX`);
  console.log(`  Interval:   ${INTERVAL / 1000}s`);
  console.log();
  if (!EXECUTE) {
    console.log(`  To execute: EXECUTE=true LOAN_STX=${LOAN_STX_MICRO / 1e6} DEPLOYER_MNEMONIC="..." node scripts/monitor-bitflow-arb.mjs`);
    console.log(`    MIN_PROFIT_STX=0.1  -- raise profit threshold`);
    console.log(`  NOTE: bitflow-arb-receiver-v5 is not yet deployed (PR #96) -- EXECUTE will fail until it is.`);
  }

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch((e) => { console.error(e); process.exit(1); });
