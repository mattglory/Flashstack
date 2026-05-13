/**
 * FlashStack Opportunity Monitor
 *
 * Watches opportunities every 30 seconds:
 *
 * 1. BITFLOW ARB — STX/stSTX stableswap
 *    Borrow STX → buy stSTX → sell stSTX back → repay → keep spread
 *    Profitable when stSTX trades above 1.0005 STX (after stacking reward cycles)
 *
 * 2. ARKADIKO USDA PEG — STX/USDA AMM pool
 *    Monitors USDA price deviation from $1.00 peg using live pool balances + STX/USD price
 *    Alerts when USDA is ±0.5% from peg — receiver contract needed to execute
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

// Note: use --env-file=.env flag for reliable env loading before SDK init.
// Manual .env loader below is a fallback for older node or missing flag.

const MNEMONIC      = process.env.DEPLOYER_MNEMONIC;
const EXECUTE       = process.env.EXECUTE === "true";
const EXECUTE_USDA  = process.env.EXECUTE_USDA === "true"; // execute USDA peg trades directly
const COMPOUND      = process.env.COMPOUND === "true"; // auto-deposit profit to LP pool
const INTERVAL      = parseInt(process.env.INTERVAL_MS ?? "30000");
const LOAN_STX      = parseInt(process.env.LOAN_STX ?? "10") * 1_000_000; // default 10 STX test size
const HIRO_API_KEY  = process.env.HIRO_API_KEY;
// USDA trade size: how much STX to spend buying USDA when below peg
const USDA_TRADE_STX = parseInt(process.env.USDA_TRADE_STX ?? "0") * 1_000_000;

const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API       = "https://api.hiro.so";
const network   = STACKS_MAINNET;

// Inject API key into all Hiro API calls (including inside SDK functions)
// Custom fetchFn passed directly to SDK calls — avoids SDK capturing fetch at module init
function hiroFetch(url, opts = {}) {
  if (HIRO_API_KEY && typeof url === "string" && url.includes("hiro.so")) {
    opts = { ...opts, headers: { ...opts?.headers, "x-api-key": HIRO_API_KEY } };
  }
  return globalThis.fetch(url, opts);
}

// Receiver contract
const RECEIVER_STANDARD = `${DEPLOYER}.bitflow-arb-receiver-v4`;

// Bitflow STX/stSTX stableswap
const BITFLOW_POOL   = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const BITFLOW_POOL_C = "stableswap-stx-ststx-v-1-2";
const STSTX_TOKEN    = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token";
const BITFLOW_LP     = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2";

// Arkadiko contracts
const ARKADIKO       = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const ARKADIKO_SWAP  = "arkadiko-swap-v2-1";
const WSTX_TOKEN     = `${ARKADIKO}.wrapped-stx-token`;
const USDA_TOKEN     = `${ARKADIKO}.usda-token`;
const DIKO_TOKEN     = `${ARKADIKO}.arkadiko-token`;

// FlashStack
const FLASHSTACK_CORE = `${DEPLOYER}.flashstack-stx-core`;

// ALEX DEX (amm-pool-v2-01)
const ALEX_AMM_ADDR  = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const ALEX_AMM_NAME  = "amm-pool-v2-01";
const ALEX_WSTX      = `${ALEX_AMM_ADDR}.token-wstx`;
const ALEX_WSTX_V2   = `${ALEX_AMM_ADDR}.token-wstx-v2`;
const ALEX_TOKEN     = `${ALEX_AMM_ADDR}.token-alex`;
const ALEX_WUSDA     = `${ALEX_AMM_ADDR}.token-wusda`;   // ALEX-wrapped USDA
const ALEX_WXUSD     = `${ALEX_AMM_ADDR}.token-wxusd`;   // ALEX-wrapped xUSD (~$1 peg)
const ALEX_ABTC      = "SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc";

// Velar DEX (univ2-core)
// Pool 3 = wSTX/aBTC (pool ID hardcoded from on-chain scan)
const VELAR_ADDR     = "SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1";
const VELAR_NAME     = "univ2-core";
const VELAR_POOL_ABTC = 3; // wSTX/aBTC pool ID

if ((EXECUTE || EXECUTE_USDA) && !MNEMONIC) {
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

// ── Arkadiko: get STX price in USDA from pool balances ─────────────────────
async function getArkadikoUsdaPeg() {
  try {
    const result = await fetchCallReadOnlyFunction({
      contractAddress: ARKADIKO,
      contractName:    ARKADIKO_SWAP,
      functionName:    "get-pair-details",
      functionArgs:    [Cl.principal(WSTX_TOKEN), Cl.principal(USDA_TOKEN)],
      network,
      senderAddress:   DEPLOYER,
    });
    const v = cvToJSON(result)?.value?.value?.value;
    if (!v) return null;

    const balX = Number(v["balance-x"].value); // wSTX micro
    const balY = Number(v["balance-y"].value); // USDA micro
    if (!balX || !balY) return null;

    // Get STX price in USD — try multiple sources, use median
    let stxUSD = 0.22;
    try {
      const prices = await Promise.allSettled([
        fetch("https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd").then(r=>r.json()).then(d=>d?.blockstack?.usd),
        fetch("https://api.binance.com/api/v3/ticker/price?symbol=STXUSDT").then(r=>r.json()).then(d=>parseFloat(d?.price)),
        fetch("https://api.kraken.com/0/public/Ticker?pair=STXUSD").then(r=>r.json()).then(d=>parseFloat(Object.values(d?.result??{})[0]?.c?.[0])),
      ]);
      const valid = prices.filter(p=>p.status==="fulfilled" && p.value > 0.01 && p.value < 10).map(p=>p.value);
      if (valid.length > 0) {
        valid.sort((a,b)=>a-b);
        stxUSD = valid[Math.floor(valid.length/2)]; // median
      }
    } catch { /* use fallback */ }

    // Pool ratio: 1 STX = balY/balX USDA
    const stxInUsda   = balY / balX;
    // 1 USDA in USD = stxUSD / stxInUsda ... nope
    // 1 STX = stxInUsda USDA  AND  1 STX = stxUSD USD
    // So 1 USDA = stxUSD / stxInUsda USD
    const usdaPriceUSD = stxUSD / stxInUsda;
    const pegDeviation = usdaPriceUSD - 1.0; // positive = above peg, negative = below

    return {
      balX, balY,
      stxInUsda,
      stxUSD,
      usdaPriceUSD,
      pegDeviation,
      abovePeg: pegDeviation >  0.005, // > 0.5% above peg
      belowPeg: pegDeviation < -0.005, // > 0.5% below peg
    };
  } catch {
    return null;
  }
}

// ── Arkadiko: check STX->DIKO->USDA->STX triangular arb ───────────────────
async function checkArkadikoTriangularArb(stxAmount) {
  try {
    const FEE = 0.003; // 0.3% Arkadiko swap fee

    // Get wSTX/USDA balances
    const r1 = await fetchCallReadOnlyFunction({
      contractAddress: ARKADIKO,
      contractName:    ARKADIKO_SWAP,
      functionName:    "get-balances",
      functionArgs:    [Cl.principal(WSTX_TOKEN), Cl.principal(USDA_TOKEN)],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const b1  = cvToJSON(r1).value.value;
    const balStxUsda  = Number(b1[0].value);
    const balUsdaPool = Number(b1[1].value);

    // Get wSTX/DIKO balances
    const r2 = await fetchCallReadOnlyFunction({
      contractAddress: ARKADIKO,
      contractName:    ARKADIKO_SWAP,
      functionName:    "get-balances",
      functionArgs:    [Cl.principal(WSTX_TOKEN), Cl.principal(DIKO_TOKEN)],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const b2  = cvToJSON(r2).value.value;
    const balStxDiko = Number(b2[0].value);
    const balDikoPool = Number(b2[1].value);

    // Get DIKO/USDA balances
    const r3 = await fetchCallReadOnlyFunction({
      contractAddress: ARKADIKO,
      contractName:    ARKADIKO_SWAP,
      functionName:    "get-balances",
      functionArgs:    [Cl.principal(DIKO_TOKEN), Cl.principal(USDA_TOKEN)],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const b3  = cvToJSON(r3).value.value;
    const balDikoUsda = Number(b3[0].value);
    const balUsdaDiko = Number(b3[1].value);

    // Route A: STX -> USDA direct
    const usdaA = (balUsdaPool * stxAmount * (1 - FEE)) / (balStxUsda + stxAmount * (1 - FEE));
    // Route B: STX -> DIKO -> USDA
    const dikoB = (balDikoPool * stxAmount * (1 - FEE)) / (balStxDiko + stxAmount * (1 - FEE));
    const usdaB = (balUsdaDiko * dikoB * (1 - FEE)) / (balDikoUsda + dikoB * (1 - FEE));

    // Best USDA from either route
    const bestUsda = Math.max(usdaA, usdaB);
    const bestRoute = usdaA >= usdaB ? "direct" : "via-DIKO";

    // Convert USDA back to STX via direct pool
    const stxBack = (balStxUsda * bestUsda * (1 - FEE)) / (balUsdaPool + bestUsda * (1 - FEE));

    const flashFee    = Math.max(1, Math.floor(stxAmount * 5 / 10000));
    const gasCost     = 600_000;
    const totalOwed   = stxAmount + flashFee + gasCost;
    const profit      = stxBack - totalOwed;

    return {
      stxIn: stxAmount, usdaA, usdaB, bestUsda, bestRoute,
      stxBack, totalOwed, profit,
      profitable: profit > 0,
    };
  } catch { return null; }
}

// ── Get wallet USDA balance ────────────────────────────────────────────────
async function getWalletUsda(address) {
  try {
    const d = await fetch(`${API}/extended/v1/address/${address}/balances`).then(r => r.json());
    const key = `${ARKADIKO}.usda-token::usda`;
    return parseInt(d.fungible_tokens?.[key]?.balance ?? "0");
  } catch { return 0; }
}

// ── Execute direct USDA peg trade from wallet (no flash loan / no receiver) ─
// JS SDK can pass trait args to Arkadiko directly — no Clarity contract needed.
//
// When USDA is ABOVE peg: swap USDA -> STX (sell overpriced USDA, get bonus STX)
// When USDA is BELOW peg: swap STX -> USDA (buy cheap USDA, hold for repeg profit)
//
async function executeUsdaSell(usdaMicro, minStxMicro) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const nonce  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r=>r.json()).then(d=>d.nonce);

  console.log(`  Selling ${usdaMicro/1e6} USDA -> STX on Arkadiko...`);
  const tx = await makeContractCall({
    contractAddress: ARKADIKO,
    contractName:    "arkadiko-swap-v2-1",
    functionName:    "swap-y-for-x",
    // JS SDK sends principals as trait args — works from outside Clarity
    functionArgs: [
      Cl.principal(WSTX_TOKEN),
      Cl.principal(USDA_TOKEN),
      Cl.uint(usdaMicro),
      Cl.uint(minStxMicro),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               200_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) { console.error(`  FAILED: ${result.error} - ${result.reason}`); return null; }
  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/0x${result.txid}?chain=mainnet`);
  return result.txid;
}

async function executeUsdaBuy(stxMicro, minUsdaMicro) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const nonce  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r=>r.json()).then(d=>d.nonce);

  console.log(`  Buying USDA with ${stxMicro/1e6} STX on Arkadiko...`);
  const tx = await makeContractCall({
    contractAddress: ARKADIKO,
    contractName:    "arkadiko-swap-v2-1",
    functionName:    "swap-x-for-y",
    functionArgs: [
      Cl.principal(WSTX_TOKEN),
      Cl.principal(USDA_TOKEN),
      Cl.uint(stxMicro),
      Cl.uint(minUsdaMicro),
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               200_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) { console.error(`  FAILED: ${result.error} - ${result.reason}`); return null; }
  console.log(`  Broadcast: ${result.txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/0x${result.txid}?chain=mainnet`);
  return result.txid;
}

// ── Execute Bitflow arb flash loan ─────────────────────────────────────────
async function executeBitflowArb(stxAmount) {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const nonce  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
    .then(r => r.json()).then(d => d.nonce);

  console.log(`  Executing ${stxAmount / 1e6} STX Bitflow arb...`);
  console.log(`  Compound mode: ${COMPOUND ? "ON (profit will auto-deposit to LP pool)" : "OFF (profit stays in wallet)"}`);

  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-core",
    functionName:      "flash-loan",
    functionArgs:      [
      Cl.uint(stxAmount),
      Cl.principal(RECEIVER_STANDARD),
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

  // If compound mode, wait for arb to confirm then deposit profit into LP pool
  if (COMPOUND) {
    console.log(`  Waiting for arb to confirm before compounding profit...`);
    const balanceBefore = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
      .then(r => r.json()).then(d => parseInt(d.balance, 16));

    let confirmed = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 10000));
      const d = await fetch(`${API}/extended/v1/tx/0x${result.txid}`).then(r => r.json());
      if (d.tx_status === "success") { confirmed = true; break; }
      if (d.tx_status?.startsWith("abort")) { console.log(`  Arb tx aborted — skipping compound`); return result.txid; }
      process.stdout.write(".");
    }
    if (!confirmed) { console.log(`  Timeout waiting for arb — skipping compound`); return result.txid; }

    // Measure profit as balance increase
    const balanceAfter = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
      .then(r => r.json()).then(d => parseInt(d.balance, 16));
    const profit = balanceAfter - balanceBefore;

    if (profit <= 300000) { // less than 0.3 STX (just gas noise)
      console.log(`  No measurable profit to compound (balance diff: ${profit / 1e6} STX)`);
      return result.txid;
    }

    console.log(`\n  Profit: +${(profit / 1e6).toFixed(6)} STX — depositing into LP pool...`);
    const nonce2 = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json()).then(d => d.nonce);
    const depositTx = await makeContractCall({
      contractAddress:   DEPLOYER,
      contractName:      "flashstack-stx-pool",
      functionName:      "deposit",
      functionArgs:      [Cl.uint(profit)],
      senderKey:         pk,
      network,
      postConditionMode: PostConditionMode.Allow,
      anchorMode:        1,
      nonce:             nonce2,
      fee:               300_000,
    });
    const depositResult = await broadcastTransaction({ transaction: depositTx, network });
    if (depositResult.error) {
      console.error(`  Compound deposit failed: ${depositResult.error}`);
    } else {
      console.log(`  Compounded! txid: ${depositResult.txid}`);
      console.log(`  Explorer: https://explorer.hiro.so/txid/0x${depositResult.txid}?chain=mainnet`);
      console.log(`  LP share value increased for all depositors.`);
    }
  }

  return result.txid;
}

// ── ALEX: get pool balances ────────────────────────────────────────────────
async function getAlexBalances(tokenX, tokenY, factor) {
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: ALEX_AMM_ADDR,
      contractName:    ALEX_AMM_NAME,
      functionName:    "get-balances",
      functionArgs:    [Cl.principal(tokenX), Cl.principal(tokenY), Cl.uint(factor)],
      network,
      senderAddress:   DEPLOYER,
    });
    const v = cvToJSON(r)?.value?.value;
    if (!v) return null;
    const balX = Number(v["balance-x"]?.value ?? 0);
    const balY = Number(v["balance-y"]?.value ?? 0);
    if (!balX || !balY) return null;
    return { balX, balY };
  } catch { return null; }
}

// ── [5] USDA cross-DEX: Arkadiko vs ALEX ──────────────────────────────────
// Arkadiko: USDA/wSTX pool (live balances -> USDA price in USD)
// ALEX: wSTX/ALEX pool (pool 1) + ALEX/wUSDA pool (pool 11)
//       chain to get implied wSTX->wUSDA rate -> compare
//
// Note: ALEX wraps USDA as "wUSDA" (token-wusda). It's not directly fungible
// with Arkadiko USDA without using ALEX's bridge. Still useful to monitor
// pricing divergence as an indicator.
async function checkUsdaCrossDex(arkadikoData) {
  if (!arkadikoData) return null;

  // ALEX Pool 1: wSTX/ALEX (factor 1e8) -- how many ALEX per wSTX
  const p1 = await getAlexBalances(ALEX_WSTX, ALEX_TOKEN, 100_000_000);
  // ALEX Pool 11: ALEX/wUSDA (factor 1e8) -- how many wUSDA per ALEX
  const p11 = await getAlexBalances(ALEX_TOKEN, ALEX_WUSDA, 100_000_000);

  let alexUsdaPriceUSD = null;
  let alexWstxPerUsda  = null;

  if (p1 && p11) {
    // Pool 1: balX = wSTX micro (6 dec), balY = ALEX micro (8 dec)
    // Pool 11: balX = ALEX micro (8 dec), balY = wUSDA micro (6 dec)
    // Implied wSTX per wUSDA via ALEX as bridge token:
    //   wSTX per ALEX   = p1.balX / p1.balY  (micro-wSTX per micro-ALEX)
    //   wUSDA per ALEX  = p11.balY / p11.balX (micro-wUSDA per micro-ALEX)
    //   wSTX per wUSDA  = (p1.balX / p1.balY) / (p11.balY / p11.balX)
    //                   = (p1.balX * p11.balX) / (p1.balY * p11.balY)
    //
    // USDA/wSTX both have 6 decimals, ALEX has 8 decimals.
    // Decimal normalization: the *ratio* of micro-units cancels perfectly when
    // token-x and token-y of each pool share the same decimals on each side,
    // but here pool 1 has (6-dec)/(8-dec) and pool 11 has (8-dec)/(6-dec).
    // Net: micro-wSTX/micro-wUSDA ratio is (6-dec)/(6-dec) -> correct.
    const alexWstxPerUsdaMicro = (p1.balX * p11.balX) / (p1.balY * p11.balY);
    // 1 full wUSDA = 1e6 micro-wUSDA costs alexWstxPerUsdaMicro * 1e6 micro-wSTX...
    // Actually the ratio already gives micro-wSTX per micro-wUSDA.
    // Since both use 6 decimals: ratio = full-STX per full-wUSDA = wSTX/wUSDA rate.
    alexWstxPerUsda = alexWstxPerUsdaMicro;  // STX per wUSDA (approx)
    alexUsdaPriceUSD = arkadikoData.stxUSD / alexWstxPerUsda;
  }

  // Arkadiko USDA price already in arkadikoData
  const arkUsdaPriceUSD = arkadikoData.usdaPriceUSD;

  return {
    arkUsdaPriceUSD,
    alexUsdaPriceUSD,
    spread: alexUsdaPriceUSD ? ((arkUsdaPriceUSD - alexUsdaPriceUSD) / alexUsdaPriceUSD * 100) : null,
    alexDataOk: !!(p1 && p11),
  };
}

// ── [6] aBTC cross-DEX: Velar vs ALEX ─────────────────────────────────────
// Velar Pool 3: wSTX/aBTC — reserve0=wSTX (6 dec), reserve1=aBTC (8 dec)
// ALEX Pool 45: wSTX-v2/aBTC (factor 1e8) — same decimal layout
//
// VERIFIED: Both tokens use ALEX Lab's bridge metadata but are DIFFERENT contracts:
//   Velar aBTC = SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-abtc (~5.75 aBTC supply)
//   ALEX  aBTC = SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc (~158 aBTC supply)
// NOT directly fungible on-chain. Spread is informational only -- do not trade.
async function checkAbtcCrossDex(stxUSD) {
  // Velar Pool 3
  let velarPriceUSD = null;
  let velarPriceSTX = null;
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: VELAR_ADDR,
      contractName:    VELAR_NAME,
      functionName:    "get-pool",
      functionArgs:    [Cl.uint(VELAR_POOL_ABTC)],
      network,
      senderAddress:   DEPLOYER,
    });
    const v = cvToJSON(r)?.value?.value;
    if (v) {
      const res0 = Number(v["reserve0"]?.value ?? 0); // micro-wSTX (6 dec)
      const res1 = Number(v["reserve1"]?.value ?? 0); // micro-aBTC  (8 dec)
      if (res0 && res1) {
        // 1 aBTC in STX = (res0/1e6) / (res1/1e8) = res0*100 / res1
        velarPriceSTX = (res0 * 100) / res1;
        velarPriceUSD = velarPriceSTX * stxUSD;
      }
    }
  } catch { /* ignore */ }

  // ALEX Pool 45: wSTX-v2/aBTC (factor 1e8)
  let alexPriceUSD = null;
  let alexPriceSTX = null;
  const p45 = await getAlexBalances(ALEX_WSTX_V2, ALEX_ABTC, 100_000_000);
  if (p45) {
    // balX = micro-wSTX-v2 (8 dec), balY = micro-aBTC (8 dec)
    // Both tokens have 8 decimal places -- decimals cancel, no adjustment needed.
    // 1 aBTC = balX / balY wSTX-v2 = balX / balY full STX
    alexPriceSTX = p45.balX / p45.balY;
    alexPriceUSD = alexPriceSTX * stxUSD;
  }

  return {
    velarPriceSTX, velarPriceUSD,
    alexPriceSTX, alexPriceUSD,
    spread: (velarPriceUSD && alexPriceUSD)
      ? ((alexPriceUSD - velarPriceUSD) / velarPriceUSD * 100)
      : null,
  };
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

  // ── 2. Arkadiko triangular arb (STX -> USDA -> STX, best route) ──
  console.log("\n  ARKADIKO TRIANGULAR ARB (STX/USDA/DIKO)");
  const tri = await checkArkadikoTriangularArb(LOAN_STX);
  if (!tri) {
    console.log("  Could not fetch Arkadiko pool data");
  } else {
    console.log(`  Route A (direct):   10 STX -> ${(tri.usdaA/1e6).toFixed(4)} USDA -> ${((tri.stxBack)/1e6).toFixed(4)} STX`);
    console.log(`  Route B (via DIKO): 10 STX -> ${(tri.usdaB/1e6).toFixed(4)} USDA`);
    console.log(`  Best route: ${tri.bestRoute} | STX back: ${(tri.stxBack/1e6).toFixed(4)} STX`);
    console.log(`  Total owed: ${(tri.totalOwed/1e6).toFixed(4)} STX | Est. profit: ${(tri.profit/1e6).toFixed(6)} STX`);
    if (tri.profitable) {
      console.log(`\n  *** TRIANGULAR ARB OPPORTUNITY *** +${(tri.profit/1e6).toFixed(4)} STX`);
      console.log(`  Note: Requires arkadiko triangular receiver contract`);
    } else {
      console.log(`  No arb — AMM fees exceed spread (typical; pools are well balanced)`);
    }
  }

  // ── 3. Arkadiko USDA peg monitor ──
  console.log("\n  ARKADIKO USDA PEG");
  const usda        = await getArkadikoUsdaPeg();
  const walletUsda  = await getWalletUsda(DEPLOYER);
  if (!usda) {
    console.log("  Could not fetch Arkadiko pool data");
  } else {
    const pegPct = (usda.pegDeviation * 100).toFixed(2);
    const sign   = usda.pegDeviation >= 0 ? "+" : "";
    console.log(`  STX price: $${usda.stxUSD.toFixed(4)} | Pool ratio: 1 STX = ${usda.stxInUsda.toFixed(4)} USDA`);
    console.log(`  USDA implied price: $${usda.usdaPriceUSD.toFixed(4)} (${sign}${pegPct}% vs $1.00 peg)`);
    console.log(`  Wallet USDA: ${(walletUsda/1e6).toFixed(4)} USDA`);

    if (usda.abovePeg) {
      console.log(`\n  *** USDA ABOVE PEG *** ${sign}${pegPct}% deviation`);

      if (walletUsda > 0) {
        // Estimate STX we'd get back selling wallet USDA
        const usdaAmt    = walletUsda;
        const stxBack    = Math.floor((usda.balX * usdaAmt * 997) / ((usda.balY + usdaAmt) * 1000));
        const stxCostBasis = Math.floor((usda.balX * usdaAmt * 1000) / ((usda.balY - usdaAmt) * 997)); // what STX you'd have paid to buy this USDA
        const gasCost    = 200_000;
        const netProfit  = stxBack - stxCostBasis - gasCost;
        console.log(`  Sell: swap ${(usdaAmt/1e6).toFixed(2)} USDA -> ~${(stxBack/1e6).toFixed(4)} STX`);
        if (netProfit > 0) {
          console.log(`  Net profit: +${(netProfit/1e6).toFixed(4)} STX (pool USDA is genuinely cheap vs USD)`);
          if (EXECUTE_USDA) {
            const minStx = Math.floor(stxBack * 0.98); // 2% slippage
            await executeUsdaSell(usdaAmt, minStx);
          } else {
            console.log(`  Run with EXECUTE_USDA=true DEPLOYER_MNEMONIC=... to sell now`);
          }
        } else {
          console.log(`  Not profitable after AMM fees (net: ${(netProfit/1e6).toFixed(4)} STX) — holding USDA`);
          console.log(`  Waiting for peg deviation to widen further or USDA price to rise on external markets`);
        }
      } else {
        console.log(`  No USDA in wallet to sell.`);
        console.log(`  To profit: open Arkadiko vault to mint USDA at face value, then sell while pool is above peg.`);
        console.log(`  Do NOT buy USDA from the pool while above peg — you would overpay.`);
      }
    } else if (usda.belowPeg) {
      console.log(`\n  *** USDA BELOW PEG *** ${sign}${pegPct}% deviation`);
      console.log(`  Buy opportunity: USDA is cheap vs USD — buy now, sell when peg restores`);
      if (USDA_TRADE_STX > 0) {
        const usdaOut  = Math.floor((usda.balY * USDA_TRADE_STX * 997) / ((usda.balX + USDA_TRADE_STX) * 1000));
        const discount = ((1 - usda.usdaPriceUSD) * 100).toFixed(2);
        console.log(`  Buy ${(usdaOut/1e6).toFixed(2)} USDA with ${USDA_TRADE_STX/1e6} STX (${discount}% discount vs peg)`);
        if (EXECUTE_USDA) {
          const minUsda = Math.floor(usdaOut * 0.98);
          await executeUsdaBuy(USDA_TRADE_STX, minUsda);
        } else {
          console.log(`  Run with EXECUTE_USDA=true USDA_TRADE_STX=${USDA_TRADE_STX/1e6} DEPLOYER_MNEMONIC=... to buy`);
        }
      } else {
        console.log(`  Set USDA_TRADE_STX=N to specify how much STX to spend buying USDA`);
      }
    } else {
      console.log(`  USDA near peg — no opportunity (threshold: ±0.5%)`);
    }
  }

  // ── 5. USDA cross-DEX: Arkadiko vs ALEX ──
  console.log("\n  [5] USDA CROSS-DEX (Arkadiko vs ALEX)");
  const usdaCross = await checkUsdaCrossDex(usda);
  if (!usdaCross) {
    console.log("  Could not fetch USDA cross-DEX data (Arkadiko data missing)");
  } else if (!usdaCross.alexDataOk) {
    const arkPct = ((usdaCross.arkUsdaPriceUSD - 1.0) * 100).toFixed(2);
    const s      = usdaCross.arkUsdaPriceUSD >= 1 ? "+" : "";
    console.log(`  Arkadiko USDA: $${usdaCross.arkUsdaPriceUSD.toFixed(4)} (${s}${arkPct}% vs peg)`);
    console.log(`  ALEX wUSDA:    could not fetch (rate-limited or pool paused)`);
  } else {
    const arkPct  = ((usdaCross.arkUsdaPriceUSD - 1.0) * 100).toFixed(2);
    const alexPct = ((usdaCross.alexUsdaPriceUSD - 1.0) * 100).toFixed(2);
    const s1      = usdaCross.arkUsdaPriceUSD >= 1 ? "+" : "";
    const s2      = usdaCross.alexUsdaPriceUSD >= 1 ? "+" : "";
    const spr     = usdaCross.spread >= 0 ? "+" : "";
    console.log(`  Arkadiko USDA:  $${usdaCross.arkUsdaPriceUSD.toFixed(4)} (${s1}${arkPct}% vs peg)`);
    console.log(`  ALEX wUSDA:     $${usdaCross.alexUsdaPriceUSD.toFixed(4)} (${s2}${alexPct}% vs peg)`);
    console.log(`  Spread:         ${spr}${usdaCross.spread.toFixed(2)}% (Arkadiko vs ALEX)`);
    if (Math.abs(usdaCross.spread) > 1.0) {
      console.log(`\n  *** CROSS-DEX SPREAD > 1% ***`);
      if (usdaCross.spread > 0) {
        console.log(`  USDA more expensive on Arkadiko than ALEX wUSDA.`);
        console.log(`  Opportunity: buy wUSDA cheap on ALEX -> bridge to Arkadiko -> sell high`);
        console.log(`  (Requires ALEX bridge; check app.alexlab.co for bridge availability)`);
      } else {
        console.log(`  USDA cheaper on Arkadiko than ALEX wUSDA.`);
        console.log(`  Opportunity: buy USDA on Arkadiko -> wrap via ALEX bridge -> sell on ALEX`);
      }
    } else {
      console.log(`  Prices aligned (spread < 1%) -- no cross-DEX arb`);
    }
    console.log(`  Note: Arkadiko USDA and ALEX wUSDA are different token contracts.`);
    console.log(`  Direct arb requires ALEX bridge. Monitor for divergence > 2%.`);
  }

  // ── 6. aBTC cross-DEX: Velar vs ALEX ──
  console.log("\n  [6] aBTC CROSS-DEX (Velar Pool 3 vs ALEX Pool 45)");
  const abtcCross = await checkAbtcCrossDex(usda?.stxUSD ?? 0.22);
  if (!abtcCross.velarPriceUSD && !abtcCross.alexPriceUSD) {
    console.log("  Could not fetch aBTC cross-DEX data");
  } else {
    if (abtcCross.velarPriceUSD) {
      console.log(`  Velar aBTC:    ${abtcCross.velarPriceSTX.toFixed(0)} STX ($${abtcCross.velarPriceUSD.toFixed(0)})`);
    } else {
      console.log(`  Velar aBTC:    could not fetch`);
    }
    if (abtcCross.alexPriceUSD) {
      console.log(`  ALEX  aBTC:    ${abtcCross.alexPriceSTX.toFixed(0)} STX ($${abtcCross.alexPriceUSD.toFixed(0)})`);
    } else {
      console.log(`  ALEX  aBTC:    could not fetch`);
    }
    if (abtcCross.spread !== null) {
      const spr = abtcCross.spread >= 0 ? "+" : "";
      console.log(`  Spread:        ${spr}${abtcCross.spread.toFixed(2)}% (ALEX vs Velar)`);
      if (Math.abs(abtcCross.spread) > 1.0) {
        console.log(`\n  *** CROSS-DEX SPREAD > 1% ***`);
        if (abtcCross.spread > 0) {
          console.log(`  aBTC more expensive on ALEX than Velar.`);
          console.log(`  Opportunity: buy aBTC on Velar -> sell on ALEX`);
        } else {
          console.log(`  aBTC cheaper on ALEX than Velar.`);
          console.log(`  Opportunity: buy aBTC on ALEX -> sell on Velar`);
        }
        console.log(`  Route: JS wallet script -- no Clarity contract needed.`);
      } else {
        console.log(`  Prices aligned (spread < 1%) -- no cross-DEX arb`);
      }
    }
    console.log(`  WARNING: Different token contracts -- NOT directly fungible.`);
    console.log(`  Both are ALEX Lab bridged BTC but separate on-chain tokens.`);
    console.log(`  Velar pool has only ~0.09 aBTC liquidity -- extreme slippage risk.`);
    console.log(`  Do NOT trade this spread. Spread is informational only.`);
  }

  // ── 4. Pool health summary ──
  try {
    const poolRes = await fetchCallReadOnlyFunction({
      contractAddress: DEPLOYER,
      contractName:    "flashstack-stx-pool",
      functionName:    "get-stats",
      functionArgs:    [],
      network,
      senderAddress:   DEPLOYER,
    });
    const v       = cvToJSON(poolRes).value.value;
    const balance = parseInt(v["pool-balance"].value) / 1e6;
    const loans   = parseInt(v["total-loans"].value);
    const fees    = parseInt(v["total-fees"].value) / 1e6;
    const shares  = parseInt(v["total-shares"].value);
    // Share value = pool balance / (total shares / SHARE_PRECISION)
    // SHARE_PRECISION = 1_000_000 (set in contract)
    const SHARE_PRECISION = 1_000_000;
    const shareValue = shares > 0
      ? ((balance * 1e6) / (shares / SHARE_PRECISION)).toFixed(6)
      : "1.000000";
    console.log(`\n  POOL HEALTH`);
    console.log(`  Balance: ${balance.toFixed(3)} STX | Loans: ${loans} | Fees earned: ${fees.toFixed(4)} STX`);
    console.log(`  Share value: ${shareValue} STX/share (goes up with every arb compound)`);
  } catch { /* ignore */ }
}

async function main() {
  console.log("FlashStack Opportunity Monitor");
  console.log("==============================");
  console.log(`Mode:          ${EXECUTE ? "LIVE EXECUTION" : "dry-run (monitoring only)"}`);
  console.log(`Compound mode: ${COMPOUND ? "ON  — profit auto-deposits to LP pool (share value increases)" : "OFF — profit stays in deployer wallet"}`);
  console.log(`Loan test size: ${LOAN_STX / 1e6} STX (set LOAN_STX=N to change)`);
  console.log(`Scan interval:  ${INTERVAL / 1000}s`);
  console.log(`\nWatching:`);
  console.log(`  [1] Bitflow STX/stSTX arb       — profitable at stacking cycle boundaries`);
  console.log(`  [2] Arkadiko triangular arb     — STX→USDA→STX via best route (direct or DIKO)`);
  console.log(`  [3] Arkadiko USDA peg           — alert when USDA deviates ±0.5% from $1.00`);
  console.log(`  [4] Pool health`);
  console.log(`  [5] USDA cross-DEX              — Arkadiko USDA price vs ALEX wUSDA price`);
  console.log(`  [6] aBTC cross-DEX              — Velar Pool 3 aBTC price vs ALEX Pool 45 aBTC price`);
  console.log(`\nTip: Run at stacking cycle boundaries (~every 2 weeks) for best stSTX arb`);
  console.log(`Tip: EXECUTE=true COMPOUND=true LOAN_STX=50          — live stSTX arb, auto-compounds to pool`);
  console.log(`Tip: EXECUTE_USDA=true DEPLOYER_MNEMONIC=...          — sell wallet USDA when above peg`);
  console.log(`Tip: EXECUTE_USDA=true USDA_TRADE_STX=50 DEPLOYER_MNEMONIC=... — buy USDA when below peg\n`);

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
