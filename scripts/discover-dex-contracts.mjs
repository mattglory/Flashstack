#!/usr/bin/env node
// Discover active DEX / lending router contracts on Stacks by sampling
// recent contract_call transactions and ranking by call frequency.
//
// The most-called contracts on mainnet are almost always the DEX routers
// and lending pools you want to track for arb / liquidation outreach.
//
// Usage:
//   node scripts/discover-dex-contracts.mjs
//   node scripts/discover-dex-contracts.mjs --pages 20 --top 40

const HIRO = 'https://api.hiro.so';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const PAGES = Number(args.pages ?? 10);   // 50 tx per page
const TOP = Number(args.top ?? 30);

const KEYWORDS = /(swap|amm|pool|router|stableswap|borrow|lend|liquidat|flash|dex|velar|alex|bitflow|arkadiko|zest|granite)/i;

const counts = new Map(); // contract_id -> { calls, functions: Map<name,count>, lastSender }

for (let page = 0; page < PAGES; page++) {
  const url = `${HIRO}/extended/v1/tx?type=contract_call&limit=50&offset=${page * 50}`;
  const res = await fetch(url);
  if (!res.ok) { console.warn(`page ${page}: ${res.status}`); continue; }
  const body = await res.json();
  for (const tx of body.results ?? []) {
    if (tx.tx_status !== 'success') continue;
    const cc = tx.contract_call;
    if (!cc) continue;
    const id = cc.contract_id;
    const prev = counts.get(id) ?? { calls: 0, functions: new Map() };
    prev.calls += 1;
    prev.functions.set(cc.function_name, (prev.functions.get(cc.function_name) ?? 0) + 1);
    counts.set(id, prev);
  }
  process.stdout.write('.');
}
console.log();

const ranked = [...counts.entries()]
  .filter(([id]) => KEYWORDS.test(id))
  .sort((a, b) => b[1].calls - a[1].calls)
  .slice(0, TOP);

console.log(`\nTop ${ranked.length} DEX/lending contracts by call frequency (${PAGES * 50} tx sampled):\n`);
console.log('calls | contract_id                                                              | top functions');
console.log('------+--------------------------------------------------------------------------+----------------------------');
for (const [id, info] of ranked) {
  const topFns = [...info.functions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, c]) => `${n}(${c})`)
    .join(', ');
  console.log(`${String(info.calls).padStart(5)} | ${id.padEnd(72)} | ${topFns}`);
}

// Also print full list (no keyword filter) for the top 15 — sometimes the
// active DEX uses a non-obvious contract name.
console.log('\n\nTop 15 ALL contracts (incl. non-DEX) for reference:\n');
const allRanked = [...counts.entries()].sort((a, b) => b[1].calls - a[1].calls).slice(0, 15);
for (const [id, info] of allRanked) {
  console.log(`${String(info.calls).padStart(5)} | ${id}`);
}
