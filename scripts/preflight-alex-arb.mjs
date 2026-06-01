/**
 * preflight-alex-arb.mjs
 * Pre-flight check + param setter for alex-arb-receiver-v3.
 *
 * What it does:
 *   1. Queries ALEX AMM to get the live Leg 1 + Leg 2 quote for your loan size
 *   2. Computes min-alex-out = 99% of expected Leg 1 output (1% slippage tolerance)
 *   3. Calls set-min-alex-out and set-min-profit on alex-arb-receiver-v3
 *
 * After this script confirms, the receiver is armed. Run the monitor with EXECUTE=true.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/preflight-alex-arb.mjs
 *   LOAN_STX=500 MIN_PROFIT_STX=0.5 SLIPPAGE_PCT=1 DEPLOYER_MNEMONIC="..." node scripts/preflight-alex-arb.mjs
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  required -- 24-word mnemonic
 *   LOAN_STX           loan size in whole STX (default: 100)
 *   MIN_PROFIT_STX     minimum acceptable profit in whole STX (default: 0.1)
 *   SLIPPAGE_PCT       slippage tolerance % for Leg 1 (default: 1)
 */

import { makeContractCall, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC        = process.env.DEPLOYER_MNEMONIC;
const LOAN_STX        = parseInt(process.env.LOAN_STX        ?? "100");
const MIN_PROFIT_STX  = parseFloat(process.env.MIN_PROFIT_STX ?? "0.1");
const SLIPPAGE_PCT    = parseFloat(process.env.SLIPPAGE_PCT   ?? "1");

const LOAN_MICRO      = LOAN_STX * 1_000_000;
const MIN_PROFIT_MICRO = Math.ceil(MIN_PROFIT_STX * 1_000_000);

const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const RECEIVER  = "alex-arb-receiver-v3";
const API       = "https://api.hiro.so";
const EXPLORER  = "https://explorer.hiro.so/txid";
const network   = STACKS_MAINNET;

const ALEX_ADDR   = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const ALEX_AMM    = "amm-pool-v2-01";
const WSTX_V2     = `${ALEX_ADDR}.token-wstx-v2`;
const ALEX_TOKEN  = `${ALEX_ADDR}.token-alex`;
const ALEX_FACTOR = 100_000_000n;
const WSTX_SCALE  = 100n;

if (!MNEMONIC) { console.error("ERROR: Set DEPLOYER_MNEMONIC"); process.exit(1); }

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callReadOnly(contractAddr, contractName, fn, args) {
  const r = await fetchCallReadOnlyFunction({
    contractAddress: contractAddr, contractName, functionName: fn,
    functionArgs: args, network, senderAddress: DEPLOYER,
  });
  const v = cvToJSON(r);
  const val = v?.value?.value ?? v?.value;
  return val ? BigInt(val) : null;
}

async function broadcast(tx, label) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${label} failed: ${data.error} -- ${data.reason ?? ""}`);
  return typeof data === "string" ? data : data.txid;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${data.tx_result?.repr ?? data.tx_status}`);
      throw new Error(`${label} aborted`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: ${label}`);
}

// ── Quote ─────────────────────────────────────────────────────────────────────

async function getQuote(loanMicro) {
  const dx = BigInt(loanMicro) * WSTX_SCALE;

  // Leg 1: wSTX -> ALEX
  const alexOut = await callReadOnly(ALEX_ADDR, ALEX_AMM, "get-y-given-x", [
    Cl.principal(WSTX_V2), Cl.principal(ALEX_TOKEN),
    Cl.uint(ALEX_FACTOR), Cl.uint(dx),
  ]);
  if (!alexOut) throw new Error("Leg 1 quote failed -- pool may be paused or rate-limited");

  // Leg 2: ALEX -> wSTX
  const stxBackWstx = await callReadOnly(ALEX_ADDR, ALEX_AMM, "get-x-given-y", [
    Cl.principal(WSTX_V2), Cl.principal(ALEX_TOKEN),
    Cl.uint(ALEX_FACTOR), Cl.uint(alexOut),
  ]);
  if (!stxBackWstx) throw new Error("Leg 2 quote failed");

  const stxBackMicro = stxBackWstx / WSTX_SCALE;
  return { alexOut, stxBackMicro };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=======================================================");
  console.log("  FlashStack -- ALEX Arb v3 Pre-flight");
  console.log("=======================================================");
  console.log(`  Loan size:    ${LOAN_STX} STX (${LOAN_MICRO} microSTX)`);
  console.log(`  Min profit:   ${MIN_PROFIT_STX} STX (${MIN_PROFIT_MICRO} microSTX)`);
  console.log(`  Slippage tol: ${SLIPPAGE_PCT}%`);
  console.log(`  Receiver:     ${DEPLOYER}.${RECEIVER}\n`);

  // Step 1: Get live quote
  console.log("Step 1 -- Fetching live ALEX AMM quote...");
  const { alexOut, stxBackMicro } = await getQuote(LOAN_MICRO);

  const feeRate    = 5n; // 0.05%
  const fee        = BigInt(LOAN_MICRO) * feeRate / 10000n || 1n;
  const totalOwed  = BigInt(LOAN_MICRO) + fee;
  const profit     = stxBackMicro - totalOwed;

  const alexOutHuman    = Number(alexOut)     / 1e8;
  const stxBackHuman    = Number(stxBackMicro) / 1e6;
  const totalOwedHuman  = Number(totalOwed)    / 1e6;
  const profitHuman     = Number(profit)       / 1e6;

  console.log(`  Leg 1 out:   ${alexOutHuman.toFixed(6)} ALEX`);
  console.log(`  Leg 2 back:  ${stxBackHuman.toFixed(6)} STX`);
  console.log(`  Flash fee:   ${Number(fee) / 1e6} STX`);
  console.log(`  Total owed:  ${totalOwedHuman.toFixed(6)} STX`);
  console.log(`  Gross profit (excl. gas): ${profitHuman.toFixed(6)} STX`);

  const gasEst = 0.3;
  const netProfit = profitHuman - gasEst;
  console.log(`  Net profit (incl. ~0.3 STX gas): ${netProfit.toFixed(6)} STX`);

  if (netProfit < MIN_PROFIT_STX) {
    console.log(`\n  WARNING: net profit ${netProfit.toFixed(6)} STX is below your MIN_PROFIT_STX=${MIN_PROFIT_STX}`);
    console.log("  The on-chain profit guard will revert the transaction.");
    console.log("  Increase loan size (LOAN_STX=500+) or wait for a bigger spread.\n");
    console.log("  Setting params anyway so the receiver is armed when conditions improve.");
  } else {
    console.log(`\n  PROFITABLE -- net profit ${netProfit.toFixed(6)} STX (> ${MIN_PROFIT_STX} STX minimum)`);
  }

  // Step 2: Compute min-alex-out
  const slippageFactor  = BigInt(Math.round((100 - SLIPPAGE_PCT) * 100)); // e.g. 9900 for 1%
  const minAlexOut      = alexOut * slippageFactor / 10000n;

  console.log(`\n  min-alex-out (${100-SLIPPAGE_PCT}% of expected): ${minAlexOut} (${(Number(minAlexOut)/1e8).toFixed(6)} ALEX)`);
  console.log(`  min-profit:                               ${MIN_PROFIT_MICRO} microSTX\n`);

  // Step 3: Get signer
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const acct   = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let   nonce  = acct.nonce;
  const bal    = parseInt(acct.balance, 16) / 1e6;

  console.log(`  Deployer balance: ${bal.toFixed(3)} STX`);
  console.log(`  Starting nonce:   ${nonce}\n`);

  if (bal < 0.5) {
    console.error("  Need at least 0.5 STX for two setter transactions.");
    process.exit(1);
  }

  // Step 4: set-min-alex-out
  console.log("Step 2 -- Calling set-min-alex-out on alex-arb-receiver-v3...");
  const tx1 = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      RECEIVER,
    functionName:      "set-min-alex-out",
    functionArgs:      [Cl.uint(minAlexOut)],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               100_000,
  });
  const txid1 = await broadcast(tx1, "set-min-alex-out");
  console.log(`  txid: ${txid1}`);
  console.log(`  ${EXPLORER}/0x${txid1}?chain=mainnet`);
  await waitForConfirm(txid1, "set-min-alex-out");

  // Step 5: set-min-profit
  console.log("\nStep 3 -- Calling set-min-profit on alex-arb-receiver-v3...");
  const tx2 = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      RECEIVER,
    functionName:      "set-min-profit",
    functionArgs:      [Cl.uint(MIN_PROFIT_MICRO)],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce:             nonce++,
    fee:               100_000,
  });
  const txid2 = await broadcast(tx2, "set-min-profit");
  console.log(`  txid: ${txid2}`);
  console.log(`  ${EXPLORER}/0x${txid2}?chain=mainnet`);
  await waitForConfirm(txid2, "set-min-profit");

  // Done
  console.log("\n=======================================================");
  console.log("  RECEIVER ARMED");
  console.log("=======================================================");
  console.log(`  min-alex-out set: ${minAlexOut}`);
  console.log(`  min-profit set:   ${MIN_PROFIT_MICRO} microSTX`);
  console.log("\n  Now execute the arb:");
  console.log(`    EXECUTE=true LOAN_STX=${LOAN_STX} DEPLOYER_MNEMONIC="..." node scripts/monitor-alex-arb.mjs`);
  console.log("\n  NOTE: These values are valid for the current pool state only.");
  console.log("  Re-run this script if more than a few minutes pass before executing.");
  console.log("=======================================================");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
