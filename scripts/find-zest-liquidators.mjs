#!/usr/bin/env node
// Rank Zest v0-4 market users by liquidation / borrow / repay activity.
//
// Goal: find the top liquidators and active borrowers to target for
// Flashstack outreach. Flash loans are the killer primitive for atomic
// liquidations and collateral swaps — these users feel the pain.
//
// Usage:
//   node scripts/find-zest-liquidators.mjs
//   node scripts/find-zest-liquidators.mjs --days 60 --top 25 --pages 8

const HIRO = 'https://api.hiro.so';
const ZEST = 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);
const DAYS = Number(args.days ?? 30);
const TOP = Number(args.top ?? 20);
const PAGES = Number(args.pages ?? 6);
const CUTOFF_MS = Date.now() - DAYS * 86400_000;

// Function-name patterns → category + outreach weight. Liquidators score
// highest because they have the strongest, most acute flash-loan use case.
const CATEGORIES = [
  { pattern: /liquidat/i,                       label: 'liquidator', weight: 10 },
  { pattern: /collateral.*(remove|swap|switch)/i, label: 'collateral-mover', weight: 7 },
  { pattern: /borrow/i,                          label: 'borrower',   weight: 4 },
  { pattern: /repay/i,                           label: 'repayer',    weight: 3 },
  { pattern: /supply|deposit/i,                  label: 'supplier',   weight: 1 },
  { pattern: /redeem|withdraw/i,                 label: 'withdrawer', weight: 1 },
  { pattern: /flash/i,                           label: 'flash-user', weight: 8 },
];

function categorize(fn) {
  for (const c of CATEGORIES) if (c.pattern.test(fn)) return c;
  return { label: 'other', weight: 0 };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function resolveBns(addr) {
  try {
    const body = await fetchJson(`${HIRO}/v1/addresses/stacks/${addr}`);
    return body.names?.[0] ?? null;
  } catch { return null; }
}

const users = new Map(); // addr -> { score, categories: Map<label,count>, lastSeen, totalTx }

console.log(`Sampling Zest v-0-4 market, ${PAGES} pages × 50 tx, last ${DAYS}d\n`);

for (let page = 0; page < PAGES; page++) {
  const url = `${HIRO}/extended/v2/addresses/${ZEST}/transactions?limit=50&offset=${page * 50}`;
  let body;
  try { body = await fetchJson(url); }
  catch (e) { console.warn(`page ${page}: ${e.message}`); continue; }

  let stop = false;
  for (const row of body.results ?? []) {
    const tx = row.tx ?? row;
    const ts = (tx.burn_block_time ?? tx.block_time ?? 0) * 1000;
    if (ts < CUTOFF_MS) { stop = true; continue; }
    if (tx.tx_type !== 'contract_call' || tx.tx_status !== 'success') continue;
    const sender = tx.sender_address;
    const fn = tx.contract_call?.function_name ?? '';
    const cat = categorize(fn);

    const u = users.get(sender) ?? { score: 0, categories: new Map(), lastSeen: 0, totalTx: 0, fns: new Map() };
    u.score += cat.weight;
    u.categories.set(cat.label, (u.categories.get(cat.label) ?? 0) + 1);
    u.fns.set(fn, (u.fns.get(fn) ?? 0) + 1);
    u.lastSeen = Math.max(u.lastSeen, ts);
    u.totalTx += 1;
    users.set(sender, u);
  }
  process.stdout.write(`page ${page} ✓ `);
  if (stop) break;
}
console.log(`\n\n${users.size} unique users\n`);

const ranked = [...users.entries()]
  .sort((a, b) => b[1].score - a[1].score || b[1].totalTx - a[1].totalTx)
  .slice(0, TOP);

console.log(`Resolving BNS for top ${ranked.length}...\n`);
const out = [];
for (const [addr, u] of ranked) {
  const bns = await resolveBns(addr);
  const cats = [...u.categories.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' ');
  const topFn = [...u.fns.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? '';
  out.push({ addr, bns: bns ?? '', score: u.score, totalTx: u.totalTx, cats, topFn, lastSeen: new Date(u.lastSeen).toISOString().slice(0,10) });
}

console.log('rank | score | bns                     | address                                       | tx | top categories                       | last       | top fn');
console.log('-----+-------+-------------------------+-----------------------------------------------+----+--------------------------------------+------------+--------');
out.forEach((r, i) => {
  console.log(
    String(i+1).padStart(4) + ' | ' +
    String(r.score).padStart(5) + ' | ' +
    (r.bns || '-').padEnd(23) + ' | ' +
    r.addr.padEnd(45) + ' | ' +
    String(r.totalTx).padStart(2) + ' | ' +
    r.cats.padEnd(36) + ' | ' +
    r.lastSeen + ' | ' + r.topFn
  );
});

// CSV.
const csv = ['rank,score,bns,address,total_tx,categories,top_fn,last_seen',
  ...out.map((r, i) => `${i+1},${r.score},${r.bns},${r.addr},${r.totalTx},"${r.cats}",${r.topFn},${r.lastSeen}`)
].join('\n');
const fs = await import('node:fs/promises');
const path = `zest-candidates-${new Date().toISOString().slice(0,10)}.csv`;
await fs.writeFile(path, csv);
console.log(`\nWrote ${path}`);
