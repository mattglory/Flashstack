#!/usr/bin/env node
// Find candidate arb / multi-DEX wallets on Stacks via Hiro API.
//
// Strategy: for each DEX router contract, page recent transactions, count
// distinct senders, then cross-reference to find addresses touching 2+ DEXs
// in the lookback window. Resolves BNS names where possible.
//
// Usage:
//   node scripts/find-arb-candidates.mjs
//   node scripts/find-arb-candidates.mjs --days 7 --min-dexs 2 --top 25

const HIRO = 'https://api.hiro.so';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const DAYS = Number(args.days ?? 7);
const MIN_DEXS = Number(args['min-dexs'] ?? 2);
const TOP = Number(args.top ?? 25);
const PAGES_PER_DEX = Number(args.pages ?? 5); // 50 tx/page
const CUTOFF_MS = Date.now() - DAYS * 86400_000;

// Edit these to match the DEX routers you actually want to track.
// Find them by: opening explorer.hiro.so, watching a swap on each DEX,
// and copying the principal.contract being called.
// Verified by reverse-engineering an active power user (spencerg.btc).
// Add ALEX / Velar contract IDs once you confirm them in the explorer.
const DEXES = [
  { name: 'Bitflow-stableswap', contract: 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2' },
  { name: 'Bitflow-helper',     contract: 'SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-swap-helper-v-1-5' },
  { name: 'Bitflow-dlmm',       contract: 'SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1' },
  { name: 'Zest-market',        contract: 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market' },
];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getDexCallers(dex) {
  const callers = new Map(); // sender -> { count, lastSeen }
  for (let page = 0; page < PAGES_PER_DEX; page++) {
    const url = `${HIRO}/extended/v2/addresses/${dex.contract}/transactions?limit=50&offset=${page * 50}`;
    let body;
    try {
      body = await fetchJson(url);
    } catch (e) {
      console.warn(`  [${dex.name}] page ${page} failed: ${e.message}`);
      break;
    }
    let oldestPastCutoff = false;
    for (const row of body.results ?? []) {
      const tx = row.tx ?? row; // v2 wraps in {tx, stx_sent, ...}
      const ts = (tx.burn_block_time ?? tx.block_time ?? 0) * 1000;
      if (ts < CUTOFF_MS) { oldestPastCutoff = true; continue; }
      if (tx.tx_type !== 'contract_call') continue;
      if (tx.tx_status !== 'success') continue;
      const sender = tx.sender_address;
      if (!sender) continue;
      const prev = callers.get(sender) ?? { count: 0, lastSeen: 0 };
      callers.set(sender, { count: prev.count + 1, lastSeen: Math.max(prev.lastSeen, ts) });
    }
    if (oldestPastCutoff) break;
  }
  return callers;
}

async function resolveBns(address) {
  try {
    const body = await fetchJson(`${HIRO}/v1/addresses/stacks/${address}`);
    return body.names?.[0] ?? null;
  } catch { return null; }
}

(async () => {
  console.log(`Scanning ${DEXES.length} DEXes, last ${DAYS}d, min ${MIN_DEXS} DEXs touched\n`);

  const perDex = {};
  for (const dex of DEXES) {
    process.stdout.write(`Fetching ${dex.name}... `);
    perDex[dex.name] = await getDexCallers(dex);
    console.log(`${perDex[dex.name].size} unique senders`);
  }

  // Aggregate by sender.
  const agg = new Map(); // sender -> { dexes: Set, totalTx, lastSeen }
  for (const [dexName, callers] of Object.entries(perDex)) {
    for (const [sender, info] of callers) {
      const prev = agg.get(sender) ?? { dexes: new Set(), totalTx: 0, lastSeen: 0 };
      prev.dexes.add(dexName);
      prev.totalTx += info.count;
      prev.lastSeen = Math.max(prev.lastSeen, info.lastSeen);
      agg.set(sender, prev);
    }
  }

  // Rank: multi-DEX first, then by tx volume.
  const ranked = [...agg.entries()]
    .filter(([, v]) => v.dexes.size >= MIN_DEXS)
    .sort((a, b) => b[1].dexes.size - a[1].dexes.size || b[1].totalTx - a[1].totalTx)
    .slice(0, TOP);

  console.log(`\nResolving BNS for top ${ranked.length}...\n`);
  const out = [];
  for (const [addr, info] of ranked) {
    const bns = await resolveBns(addr);
    out.push({
      address: addr,
      bns: bns ?? '',
      dexes: [...info.dexes].join('+'),
      dex_count: info.dexes.size,
      tx_count: info.totalTx,
      last_seen: new Date(info.lastSeen).toISOString().slice(0, 10),
    });
  }

  // Print table.
  console.log('rank | bns                          | address                                       | dexes               | dex# | tx | last');
  console.log('-----+------------------------------+-----------------------------------------------+---------------------+------+----+-----------');
  out.forEach((r, i) => {
    const rank = String(i + 1).padStart(4);
    const bns = (r.bns || '-').padEnd(28);
    const addr = r.address.padEnd(45);
    const dexes = r.dexes.padEnd(19);
    const dexCount = String(r.dex_count).padStart(4);
    const tx = String(r.tx_count).padStart(2);
    console.log(`${rank} | ${bns} | ${addr} | ${dexes} | ${dexCount} | ${tx} | ${r.last_seen}`);
  });

  // Also write CSV for spreadsheet import.
  const csv = ['rank,bns,address,dexes,dex_count,tx_count,last_seen',
    ...out.map((r, i) => `${i + 1},${r.bns},${r.address},${r.dexes},${r.dex_count},${r.tx_count},${r.last_seen}`)
  ].join('\n');
  const fs = await import('node:fs/promises');
  const path = `arb-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  await fs.writeFile(path, csv);
  console.log(`\nWrote ${path}`);
})();
