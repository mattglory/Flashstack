/**
 * FlashStack Opportunity Monitor
 *
 * Watches two live opportunities every 30 seconds:
 *
 * 1. BITFLOW ARB — STX/stSTX stableswap
 *    Borrow STX → buy stSTX → sell stSTX back → repay → keep spread
 *    Profitable when stSTX trades above 1.0005 STX (after stacking reward cycles)
 *
 * 2. ZEST LIQUIDATIONS — check /v2/contracts/call-read
 *    (Placeholder: Zest API integration, fills in when their contract is confirmed)
 *
 * Usage:
 *   node scripts/monitor-opportunities.mjs
 *   EXECUTE=true DEPLOYER_MNEMONIC="..." node scripts/monitor-opportunities.mjs
 *
 * Set EXECUTE=true to auto-trigger when profitable. Default is dry-run.
 */

import { makeContractCall, broadcastTransaction, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const EXECUTE   = process.env.EXECUTE === "true";
const INTERVAL  = parseInt(process.env.INTERVAL_MS ?? "30000");
const LOAN_STX  = parseInt(process.env.LOAN_STX ?? "10") * 1_000_000; // default 10 STX test size

const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API       = "https://api.hiro.so";
const network   = STACKS_MAINNET;

// Bitflow STX/stSTX stableswap
const BITFLOW_POOL   = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const BITFLOW_POOL_C = "stableswap-stx-ststx-v-1-2";
const STSTX_TOKEN    = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token";
const BITFLOW_LP     = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2";

// FlashStack
const FLASHSTACK_CORE = `${DEPLOYER}.flashstack-stx-core`;

if (EXECUTE && !MNEMONIC) {
  console.error("Set DEPLOYER_MNEMONIC to execute transactions");
  process.exit(1);
}

// ── Bitflow: get how much stSTX you get for X STX ──────────────────────────
async function getBitflowDy(stxAmount) {
  try {
    const result = await fetchCallReadOnlyFunction({
      contractAddress: BITFLOW_POOL,
      contractName:    BITFLOW_POOL_C,
      functionName:    "get-dy",
      functionArgs:    [
        Cl.principal(STSTX_TOKEN),
        Cl.principal(BITFLOW_LP),
        Cl.uint(stxAmount),
      ],
      network,
      senderAddress: DEPLOYER,
    });
    const json = cvToJSON(result);
    // Returns (ok {dy: uint, ...}) or just uint depending on version
    const dy = json?.value?.value?.dy?.value ?? json?.value?.value ?? json?.value;
    return dy ? BigInt(dy) : null;
  } catch {
    return null;
  }
}

// ── Bitflow: get how much STX you get back for Y stSTX ─────────────────────
async function getBitflowDx(ststxAmount) {
  try {
    const result = await fetchCallReadOnlyFunction({
      contractAddress: BITFLOW_POOL,
      contractName:    BITFLOW_POOL_C,
      functionName:    "get-dx",
      functionArgs:    [
        Cl.principal(STSTX_TOKEN),
        Cl.principal(BITFLOW_LP),
        Cl.uint(ststxAmount),
      ],
      network,
      senderAddress: DEPLOYER,
    });
    const json = cvToJSON(result);
    const dx = json?.value?.value?.dx?.value ?? json?.value?.value ?? json?.value;
    return dx ? BigInt(dx) : null;
  } catch {
    return null;
  }
}

// ── Check Bitflow arb opportunity ──────────────────────────────────────────
async function checkBitflowArb(stxAmount) {
  const fee       = BigInt(Math.max(1, Math.floor(stxAmount * 5 / 10000)));
  const totalOwed = BigInt(stxAmount) + fee;
  const gasCost   = 300_000n; // 0.3 STX tx fee

  // Leg 1: how much stSTX do we get for stxAmount STX?
  const ststxOut = await getBitflowDy(stxAmount);
  if (!ststxOut) return null;

  // Leg 2: how much STX do we get back for that stSTX?
  const stxBack = await getBitflowDx(ststxOut);
  if (!stxBack) return null;

  const profit = stxBack - totalOwed - gasCost;
  const ratio  = Number(ststxOut) / stxAmount; // stSTX per STX (> 1 = opportunity)

  return {
    stxIn:     stxAmount,
    ststxOut:  Number(ststxOut),
    stxBack:   Number(stxBack),
    totalOwed: Number(totalOwed),
    profit:    Number(profit),
    ratio,
    profitable: profit > 0n,
  };
}

// ── Execute Bitflow arb flash loan ─────────────────────────────────────────
async function executeBitflowArb(stxAmount) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const nonce  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
    .then(r => r.json()).then(d => d.nonce);

  console.log(`  Executing ${stxAmount / 1e6} STX Bitflow arb...`);

  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "flash-loan",
    functionArgs:      [
      Cl.uint(stxAmount),
      Cl.principal(`${DEPLOYER}.bitflow-arb-receiver`),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });

  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) {
    console.error(`  FAILED: ${result.error} - ${result.reason}`);
    return null;
  }
  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/0x${result.txid}?chain=mainnet`);
  return result.txid;
}

// ── Main scan ──────────────────────────────────────────────────────────────
async function scan() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Scanning for opportunities...`);

  // ── 1. Bitflow STX/stSTX arb ──
  console.log("\n  BITFLOW STX/stSTX ARB");
  const arb = await checkBitflowArb(LOAN_STX);

  if (!arb) {
    console.log("  Could not fetch Bitflow pool data");
  } else {
    const profitStx = arb.profit / 1e6;
    const ratioStr  = arb.ratio.toFixed(6);
    console.log(`  Loan: ${LOAN_STX / 1e6} STX`);
    console.log(`  Leg 1 out: ${(arb.ststxOut / 1e6).toFixed(6)} stSTX (ratio: ${ratioStr} stSTX/STX)`);
    console.log(`  Leg 2 back: ${(arb.stxBack / 1e6).toFixed(6)} STX`);
    console.log(`  Total owed: ${(arb.totalOwed / 1e6).toFixed(6)} STX (principal + 0.05% fee + gas)`);
    console.log(`  Est. profit: ${profitStx.toFixed(6)} STX`);

    if (arb.profitable) {
      console.log(`\n  *** ARB OPPORTUNITY *** ${profitStx.toFixed(4)} STX profit!`);
      console.log(`  stSTX is trading at ${ratioStr} per STX — above peg`);
      if (EXECUTE) {
        await executeBitflowArb(LOAN_STX);
      } else {
        console.log(`  (dry-run — set EXECUTE=true to trigger)`);
      }
    } else {
      const deficit = (arb.totalOwed - arb.stxBack) / 1e6;
      console.log(`  No arb — stSTX at/below peg, deficit ${deficit.toFixed(6)} STX`);
      console.log(`  Waiting for stacking reward cycle to push stSTX above peg...`);
    }
  }

  // ── 2. Pool health summary ──
  try {
    const poolRes = await fetchCallReadOnlyFunction({
      contractAddress: DEPLOYER,
      contractName:    "flashstack-stx-pool",
      functionName:    "get-stats",
      functionArgs:    [],
      network,
      senderAddress:   DEPLOYER,
    });
    const v = cvToJSON(poolRes).value.value;
    const balance = parseInt(v["pool-balance"].value) / 1e6;
    const loans   = parseInt(v["total-loans"].value);
    const fees    = parseInt(v["total-fees"].value) / 1e6;
    console.log(`\n  POOL HEALTH`);
    console.log(`  Balance: ${balance.toFixed(3)} STX | Loans: ${loans} | Fees earned: ${fees.toFixed(4)} STX`);
  } catch { /* ignore */ }
}

async function main() {
  console.log("FlashStack Opportunity Monitor");
  console.log("==============================");
  console.log(`Mode:          ${EXECUTE ? "LIVE EXECUTION" : "dry-run (monitoring only)"}`);
  console.log(`Loan test size: ${LOAN_STX / 1e6} STX (set LOAN_STX=N to change)`);
  console.log(`Scan interval:  ${INTERVAL / 1000}s`);
  console.log(`\nWatching:`);
  console.log(`  [1] Bitflow STX/stSTX arb (profitable when stSTX > 1.0005 STX)`);
  console.log(`  [2] Pool health`);
  console.log(`\nTip: Run at stacking cycle boundaries (~every 2 weeks) for best arb chances`);
  console.log(`Tip: Use EXECUTE=true LOAN_STX=50 for bigger loans when profitable\n`);

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
