#!/usr/bin/env node
/**
 * scan-zest-positions.mjs
 * Scans Zest V2 for active borrowers and estimates liquidation risk.
 *
 * Usage:
 *   node scripts/scan-zest-positions.mjs
 *   PAGES=5 node scripts/scan-zest-positions.mjs    (scan more history)
 *
 * Output: table of active borrowers ranked by estimated risk.
 * Use this to:
 *   1. Identify targets before the Zest whitelist is live
 *   2. Show Zest team real liquidation data as part of your integration pitch
 */

const API      = "https://api.hiro.so";
const DEPLOYER = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
const MARKET   = `${DEPLOYER}.v0-4-market`;
const PAGES    = parseInt(process.env.PAGES ?? "3");

// Confirmed from on-chain borrow/repay transactions
const DEBT_TOKENS = {
  [`${DEPLOYER}.wstx`]:                                          { symbol: "wSTX",  decimals: 6 },
  "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx":           { symbol: "USDCx", decimals: 6 },
  "SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1":    { symbol: "USDH",  decimals: 6 },
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token":      { symbol: "sBTC",  decimals: 8 },
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token":      { symbol: "stSTX", decimals: 6 },
};

const COLLATERAL_TOKENS = {
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token":       { symbol: "sBTC",       decimals: 8 },
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token":       { symbol: "stSTX",      decimals: 6 },
  [`${DEPLOYER}.v0-vault-ststxbtc`]:                              { symbol: "stSTXbtc-v", decimals: 8 },
  [`${DEPLOYER}.wstx`]:                                          { symbol: "wSTX",       decimals: 6 },
};

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "x-api-key": process.env.HIRO_API_KEY ?? "" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function callReadOnly(contract, fn, args = []) {
  const [addr, name] = contract.split(".");
  const res = await fetch(`${API}/v2/contracts/call-read/${addr}/${name}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: DEPLOYER, arguments: args }),
  });
  return res.json();
}

// Fetch STX price in USD from CoinGecko
async function getSTXPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd");
    const d = await r.json();
    return d?.blockstack?.usd ?? 0.35;
  } catch { return 0.35; }
}

// Fetch sBTC price (proxy: BTC price)
async function getBTCPrice() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const d = await r.json();
    return d?.bitcoin?.usd ?? 95000;
  } catch { return 95000; }
}

// Scan market transactions and collect unique borrowers + their activity
async function scanBorrowers() {
  const borrowers = new Map(); // address -> { borrows: [], repays: [], collateral: [] }

  for (let page = 0; page < PAGES; page++) {
    const offset = page * 50;
    const url = `${API}/extended/v1/address/${MARKET}/transactions?limit=50&offset=${offset}`;
    let data;
    try { data = await fetchJSON(url); } catch { break; }

    const txs = data.results ?? [];
    if (txs.length === 0) break;

    for (const tx of txs) {
      if (tx.tx_status !== "success") continue;
      const fn   = tx.contract_call?.function_name;
      const from = tx.sender_address;
      const args = tx.contract_call?.function_args ?? [];
      const block = tx.block_height;

      if (!from) continue;

      if (!borrowers.has(from)) {
        borrowers.set(from, { borrows: [], repays: [], collateral: [], liquidations: [], lastBlock: 0 });
      }
      const rec = borrowers.get(from);
      if (block > rec.lastBlock) rec.lastBlock = block;

      if (fn === "borrow") {
        const token = args.find(a => a.name === "ft")?.repr?.replace(/^'/, "") ?? "";
        const amt   = parseInt(args.find(a => a.name === "amount")?.repr?.replace("u","") ?? "0");
        rec.borrows.push({ token, amount: amt, block });
      }

      if (fn === "repay") {
        const token = args.find(a => a.name === "ft")?.repr?.replace(/^'/, "") ?? "";
        const amt   = parseInt(args.find(a => a.name === "amount")?.repr?.replace("u","") ?? "0");
        rec.repays.push({ token, amount: amt, block });
      }

      if (fn === "collateral-add" || fn === "supply-collateral-add") {
        const token = args.find(a => a.name === "ft")?.repr?.replace(/^'/, "") ?? "";
        const amt   = parseInt(args.find(a => a.name === "amount")?.repr?.replace("u","") ?? "0");
        rec.collateral.push({ token, amount: amt, block });
      }

      if (fn === "liquidate" || fn === "liquidate-multi" || fn === "liquidate-redeem") {
        const target = args.find(a => a.name === "borrower")?.repr?.replace(/^'/,"") ?? "";
        if (target && borrowers.has(target)) {
          borrowers.get(target).liquidations.push({ block, liquidator: from });
        }
      }
    }
  }

  return borrowers;
}

// Estimate net borrow amount per token (borrows - repays)
function netBorrows(rec) {
  const net = {};
  for (const b of rec.borrows) {
    net[b.token] = (net[b.token] ?? 0) + b.amount;
  }
  for (const r of rec.repays) {
    // max-uint repays clear the position entirely
    if (r.amount > 1e30) {
      net[r.token] = 0;
    } else {
      net[r.token] = Math.max(0, (net[r.token] ?? 0) - r.amount);
    }
  }
  return net;
}

// Format token amount with symbol
function fmt(amount, tokenAddr) {
  const info = DEBT_TOKENS[tokenAddr] ?? COLLATERAL_TOKENS[tokenAddr] ?? { symbol: tokenAddr.split(".")[1], decimals: 6 };
  const val  = amount / Math.pow(10, info.decimals);
  return `${val.toFixed(4)} ${info.symbol}`;
}

async function main() {
  console.log("=======================================================");
  console.log(" FlashStack -- Zest V2 Position Scanner");
  console.log("=======================================================");
  console.log(` Market:  ${MARKET}`);
  console.log(` Scanning ${PAGES * 50} most recent transactions...\n`);

  const [borrowers, stxPrice, btcPrice] = await Promise.all([
    scanBorrowers(),
    getSTXPrice(),
    getBTCPrice(),
  ]);

  console.log(` STX price: $${stxPrice.toFixed(4)}`);
  console.log(` BTC price: $${btcPrice.toLocaleString()}`);
  console.log(` Borrowers found: ${borrowers.size}\n`);

  // Filter to addresses with active borrows and no recent full-repay
  const active = [];

  for (const [addr, rec] of borrowers) {
    const net = netBorrows(rec);
    const hasDebt = Object.values(net).some(v => v > 0);
    if (!hasDebt) continue;

    // Estimate total debt in USD
    let debtUSD = 0;
    const debtBreakdown = [];
    for (const [token, amount] of Object.entries(net)) {
      if (amount <= 0) continue;
      const info = DEBT_TOKENS[token];
      if (!info) continue;
      const humanAmt = amount / Math.pow(10, info.decimals);
      let usdVal = 0;
      if (info.symbol === "wSTX") usdVal = humanAmt * stxPrice;
      else if (info.symbol === "sBTC") usdVal = humanAmt * btcPrice;
      else if (info.symbol === "stSTX") usdVal = humanAmt * stxPrice * 1.05;
      else usdVal = humanAmt; // stable coins ~$1
      debtUSD += usdVal;
      debtBreakdown.push(`${humanAmt.toFixed(4)} ${info.symbol} (~$${usdVal.toFixed(2)})`);
    }

    // Estimate collateral in USD
    let collUSD = 0;
    const collBreakdown = [];
    for (const c of rec.collateral) {
      const info = COLLATERAL_TOKENS[c.token];
      if (!info) continue;
      const humanAmt = c.amount / Math.pow(10, info.decimals);
      let usdVal = 0;
      if (info.symbol === "wSTX") usdVal = humanAmt * stxPrice;
      else if (info.symbol === "sBTC") usdVal = humanAmt * btcPrice;
      else if (info.symbol.includes("stSTX")) usdVal = humanAmt * stxPrice * 1.05;
      else usdVal = humanAmt * stxPrice;
      collUSD += usdVal;
      collBreakdown.push(`${humanAmt.toFixed(4)} ${info.symbol} (~$${usdVal.toFixed(2)})`);
    }

    // Estimated health factor (rough -- actual uses oracle prices)
    // Zest typical LTV ~70-80%, liquidation threshold ~85%
    const ltv = collUSD > 0 ? debtUSD / collUSD : 0;
    const estHealth = collUSD > 0 ? (collUSD * 0.85) / debtUSD : 999;
    const alreadyLiquidated = rec.liquidations.length > 0;

    active.push({
      addr, debtUSD, collUSD, ltv, estHealth,
      debtBreakdown, collBreakdown,
      lastBlock: rec.lastBlock,
      alreadyLiquidated,
    });
  }

  // Sort by estimated health (lowest = most at risk)
  active.sort((a, b) => a.estHealth - b.estHealth);

  // Print results
  const AT_RISK    = active.filter(p => p.estHealth < 1.1 && !p.alreadyLiquidated);
  const WATCH      = active.filter(p => p.estHealth >= 1.1 && p.estHealth < 1.3 && !p.alreadyLiquidated);
  const SAFE       = active.filter(p => p.estHealth >= 1.3);
  const LIQUIDATED = active.filter(p => p.alreadyLiquidated);

  console.log("=======================================================");
  console.log(` RISK SUMMARY`);
  console.log("=======================================================");
  console.log(` At risk (health < 1.1):  ${AT_RISK.length} positions`);
  console.log(` Watch   (1.1 - 1.3):     ${WATCH.length} positions`);
  console.log(` Safe    (> 1.3):          ${SAFE.length} positions`);
  console.log(` Already liquidated:       ${LIQUIDATED.length} positions`);
  console.log();

  if (AT_RISK.length > 0) {
    console.log("=======================================================");
    console.log(" AT RISK -- Potential Liquidation Targets");
    console.log("=======================================================");
    for (const p of AT_RISK.slice(0, 10)) {
      const profit5pct = p.debtUSD * 0.05 - p.debtUSD * 0.0005; // 5% bonus - 0.05% flash fee
      console.log(`\n  ${p.addr}`);
      console.log(`    Est. health:  ${p.estHealth.toFixed(3)} (< 1.0 = liquidatable)`);
      console.log(`    Debt:         $${p.debtUSD.toFixed(2)} -- ${p.debtBreakdown.join(", ")}`);
      console.log(`    Collateral:   $${p.collUSD.toFixed(2)} -- ${p.collBreakdown.join(", ")}`);
      console.log(`    LTV:          ${(p.ltv * 100).toFixed(1)}%`);
      console.log(`    Est. profit:  ~$${profit5pct.toFixed(2)} at 5% bonus`);
      console.log(`    Last block:   ${p.lastBlock}`);
    }
    console.log();
  }

  if (WATCH.length > 0) {
    console.log("=======================================================");
    console.log(" WATCH LIST -- Monitor These Positions");
    console.log("=======================================================");
    for (const p of WATCH.slice(0, 5)) {
      console.log(`  ${p.addr}`);
      console.log(`    Health: ${p.estHealth.toFixed(3)}  |  Debt: $${p.debtUSD.toFixed(2)}  |  Coll: $${p.collUSD.toFixed(2)}`);
    }
    console.log();
  }

  console.log("=======================================================");
  console.log(" NOTES");
  console.log("=======================================================");
  console.log(" - Health estimates are approximate (uses current prices, not oracle).");
  console.log(" - Net debt estimate may miss positions opened before scan window.");
  console.log(" - Run with PAGES=10 for broader history coverage.");
  console.log(" - Flash liquidation requires Zest authorized-liquidator whitelist.");
  console.log("   Use this data in your Zest outreach to show real opportunity.");
  console.log();
  console.log(` Scan complete. ${active.length} active borrowers analyzed.`);
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
