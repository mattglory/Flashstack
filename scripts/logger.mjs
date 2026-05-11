/**
 * FlashStack Bot Logger
 * Writes structured trade logs to logs/trades.jsonl and logs/bot.log
 */

import { appendFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir  = dirname(fileURLToPath(import.meta.url));
const logDir = join(__dir, "../logs");

try { mkdirSync(logDir, { recursive: true }); } catch {}

const TRADE_LOG = join(logDir, "trades.jsonl");
const BOT_LOG   = join(logDir, "bot.log");

function ts() { return new Date().toISOString(); }

export function logTrade({ strategy, action, txid, profit_stx, amount_stx, status, note }) {
  const record = { ts: ts(), strategy, action, txid: txid ?? null, profit_stx: profit_stx ?? 0, amount_stx: amount_stx ?? 0, status, note: note ?? "" };
  try { appendFileSync(TRADE_LOG, JSON.stringify(record) + "\n"); } catch {}
  const line = `[${record.ts}] [TRADE] [${strategy}] ${action} | status=${status} | profit=${profit_stx?.toFixed(4) ?? "?"} STX | ${note}`;
  console.log(line);
  try { appendFileSync(BOT_LOG, line + "\n"); } catch {}
}

export function logInfo(msg) {
  const line = `[${ts()}] [INFO ] ${msg}`;
  console.log(line);
  try { appendFileSync(BOT_LOG, line + "\n"); } catch {}
}

export function logWarn(msg) {
  const line = `[${ts()}] [WARN ] ${msg}`;
  console.warn(line);
  try { appendFileSync(BOT_LOG, line + "\n"); } catch {}
}

export function logError(msg) {
  const line = `[${ts()}] [ERROR] ${msg}`;
  console.error(line);
  try { appendFileSync(BOT_LOG, line + "\n"); } catch {}
}

export function logOpportunity({ strategy, found, detail }) {
  const line = `[${ts()}] [OPP  ] [${strategy}] found=${found} | ${detail}`;
  console.log(line);
  try { appendFileSync(BOT_LOG, line + "\n"); } catch {}
}

/**
 * Print a P&L summary from the trade log
 * Usage: node scripts/logger.mjs
 */
async function printSummary() {
  const { readFileSync } = await import("fs");
  let lines;
  try { lines = readFileSync(TRADE_LOG, "utf8").trim().split("\n").filter(Boolean); }
  catch { console.log("No trades logged yet."); return; }

  const trades = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const byStrategy = {};

  for (const t of trades) {
    if (!byStrategy[t.strategy]) byStrategy[t.strategy] = { count: 0, profit: 0, success: 0, fail: 0 };
    byStrategy[t.strategy].count++;
    byStrategy[t.strategy].profit += t.profit_stx ?? 0;
    if (t.status === "success") byStrategy[t.strategy].success++;
    else byStrategy[t.strategy].fail++;
  }

  const total = trades.reduce((s, t) => s + (t.profit_stx ?? 0), 0);

  console.log("\n=== FlashStack Bot P&L Summary ===");
  console.log(`Total trades: ${trades.length} | Total profit: ${total.toFixed(4)} STX`);
  console.log("");
  for (const [s, d] of Object.entries(byStrategy)) {
    console.log(`  ${s.padEnd(20)} | ${d.count} trades | profit: ${d.profit.toFixed(4)} STX | ${d.success} ok / ${d.fail} fail`);
  }
  console.log("===================================\n");
}

// Run summary if called directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  printSummary();
}
