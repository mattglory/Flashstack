"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";

// ── Config ────────────────────────────────────────────────────────────────────

const WALLET   = "0x7Dff50b9F4f60dB5042bc01a26f39fB1266486d6";

const CHAINS = [
  {
    id:       "arbitrum",
    name:     "Arbitrum",
    symbol:   "ETH",
    rpc:      "https://arb1.arbitrum.io/rpc",
    contract: "0x0E973B35634Fb0F88215596934e39C3cD17fd2E4",
    explorer: "https://arbiscan.io",
    color:    "text-blue-400",
    bg:       "bg-blue-400/10",
    border:   "border-blue-400/20",
  },
  {
    id:       "ethereum",
    name:     "Ethereum",
    symbol:   "ETH",
    rpc:      "https://ethereum.publicnode.com",
    contract: "0xBA3a114c0f5B525E10B360AdEA20E09BdDA56505",
    explorer: "https://etherscan.io",
    color:    "text-purple-400",
    bg:       "bg-purple-400/10",
    border:   "border-purple-400/20",
  },
  {
    id:       "base",
    name:     "Base",
    symbol:   "ETH",
    rpc:      "https://base.publicnode.com",
    contract: "0xf12BEdB7c9efBa37c44fdBBBC22B8819DF3f7932",
    explorer: "https://basescan.org",
    color:    "text-sky-400",
    bg:       "bg-sky-400/10",
    border:   "border-sky-400/20",
  },
  {
    id:       "bsc",
    name:     "BSC",
    symbol:   "BNB",
    rpc:      "https://bsc-dataseed.binance.org",
    contract: "0x04808E9432343B92eF426639eccF3DC2AbD05D55",
    explorer: "https://bscscan.com",
    color:    "text-yellow-400",
    bg:       "bg-yellow-400/10",
    border:   "border-yellow-400/20",
  },
  {
    id:       "optimism",
    name:     "Optimism",
    symbol:   "ETH",
    rpc:      "https://mainnet.optimism.io",
    contract: "0x04808E9432343B92eF426639eccF3DC2AbD05D55",
    explorer: "https://optimistic.etherscan.io",
    color:    "text-red-400",
    bg:       "bg-red-400/10",
    border:   "border-red-400/20",
  },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChainStats {
  id:        string;
  balance:   number | null;   // native ETH/BNB in wallet
  ethPrice:  number;
  profits:   ProfitEntry[];
  totalUsd:  number;
  loading:   boolean;
  error:     string | null;
  block:     number | null;
}

interface ProfitEntry {
  txHash:  string;
  token:   string;
  amount:  number;
  usdVal:  number;
  ts:      number | null;
}

// ── RPC helpers ───────────────────────────────────────────────────────────────

async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

function hexToNum(hex: string) { return parseInt(hex, 16); }
function hexToEth(hex: string) { return hexToNum(hex) / 1e18; }

async function getEthPrice(): Promise<number> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT");
    const j = await r.json();
    return parseFloat(j.price);
  } catch { return 2300; }
}

async function getBnbPrice(): Promise<number> {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
    const j = await r.json();
    return parseFloat(j.price);
  } catch { return 600; }
}

async function getBalance(rpcUrl: string, addr: string): Promise<number> {
  const hex = await rpc(rpcUrl, "eth_getBalance", [addr, "latest"]);
  return hexToEth(hex);
}

async function getBlock(rpcUrl: string): Promise<number> {
  const hex = await rpc(rpcUrl, "eth_blockNumber", []);
  return hexToNum(hex);
}

// getLogs for Transfer events FROM flash contract TO wallet (= profit sweeps)
async function getProfits(
  rpcUrl:   string,
  contract: string,
  ethPrice: number,
  currentBlock: number,
): Promise<ProfitEntry[]> {
  // Scan last 30 days of blocks
  const blocksPerDay = rpcUrl.includes("arbitrum") || rpcUrl.includes("arb1") ? 345_600
    : rpcUrl.includes("base") ? 43_200
    : rpcUrl.includes("bsc")  ? 28_800
    : 7_200; // ethereum

  const fromBlock = Math.max(0, currentBlock - blocksPerDay * 30);

  const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad = (addr: string) => "0x" + addr.replace("0x", "").toLowerCase().padStart(64, "0");

  let logs: {topics: string[]; data: string; transactionHash: string; blockNumber: string}[] = [];

  try {
    logs = await rpc(rpcUrl, "eth_getLogs", [{
      topics:    [TRANSFER_SIG, pad(contract), pad(WALLET)],
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock:   "latest",
    }]);
  } catch {
    // RPC range too large — try 7 days
    try {
      const fb7 = Math.max(0, currentBlock - blocksPerDay * 7);
      logs = await rpc(rpcUrl, "eth_getLogs", [{
        topics:    [TRANSFER_SIG, pad(contract), pad(WALLET)],
        fromBlock: "0x" + fb7.toString(16),
        toBlock:   "latest",
      }]);
    } catch { return []; }
  }

  // Deduplicate by tx+token
  const seen = new Set<string>();
  const entries: ProfitEntry[] = [];

  for (const log of logs) {
    const key = log.transactionHash + log.topics[0]; // tx + transfer event
    if (seen.has(key)) continue;
    seen.add(key);

    const raw = BigInt(log.data);
    const amount = Number(raw) / 1e18; // assume 18 decimals (good enough for USD est)

    let usdVal = amount * ethPrice; // default: treat as ETH/native
    // rough stable detection: tiny amounts in large numbers = likely USDC/USDT (6 dec)
    if (Number(raw) > 1e20) {
      usdVal = Number(raw) / 1e6; // might be USDC — 6 decimals
    }

    entries.push({
      txHash:  log.transactionHash,
      token:   "ERC20",
      amount,
      usdVal,
      ts:      null,
    });
  }

  return entries;
}

// ── Per-chain data loader ─────────────────────────────────────────────────────

async function loadChain(
  chain: typeof CHAINS[number],
  nativePrice: number,
): Promise<Partial<ChainStats>> {
  const [balance, block] = await Promise.all([
    getBalance(chain.rpc, WALLET).catch(() => null),
    getBlock(chain.rpc).catch(() => null),
  ]);

  const profits = block
    ? await getProfits(chain.rpc, chain.contract, nativePrice, block).catch(() => [])
    : [];

  const totalUsd = profits.reduce((s, p) => s + p.usdVal, 0);

  return { balance, ethPrice: nativePrice, profits, totalUsd, block, loading: false, error: null };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BotDashboard() {
  const [stats, setStats]         = useState<ChainStats[]>(
    CHAINS.map(c => ({ id: c.id, balance: null, ethPrice: 0, profits: [], totalUsd: 0, loading: true, error: null, block: null }))
  );
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [ethPrice, bnbPrice] = await Promise.all([getEthPrice(), getBnbPrice()]);

    await Promise.all(
      CHAINS.map(async (chain, i) => {
        const price = chain.id === "bsc" ? bnbPrice : ethPrice;
        try {
          const data = await loadChain(chain, price);
          setStats(prev => {
            const next = [...prev];
            next[i] = { ...next[i], ...data, id: chain.id };
            return next;
          });
        } catch (e) {
          setStats(prev => {
            const next = [...prev];
            next[i] = { ...next[i], loading: false, error: (e as Error).message };
            return next;
          });
        }
      })
    );
    setLastRefresh(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000); // auto-refresh every 60s
    return () => clearInterval(iv);
  }, [refresh]);

  const grandTotalUsd  = stats.reduce((s, c) => s + c.totalUsd, 0);
  const grandTotalLiqs = stats.reduce((s, c) => s + c.profits.length, 0);
  const totalWalletUsd = stats.reduce((s, c, i) => {
    if (c.balance === null) return s;
    return s + c.balance * c.ethPrice;
  }, 0);

  return (
    <div className="min-h-screen bg-surface text-slate-100 flex flex-col">

      {/* ── Nav ── */}
      <header className="border-b border-surface-border sticky top-0 z-50 bg-surface/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/flashstack-logo.svg" alt="FlashStack" width={28} height={28} />
              <span className="text-base font-bold text-white">FlashStack</span>
            </Link>
            <span className="text-surface-border">/</span>
            <span className="text-sm text-slate-400">Bot Monitor</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : "Loading…"}
            </span>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs rounded-lg bg-surface-card border border-surface-border hover:border-brand-600/40 text-slate-300 transition-colors disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "⟳ Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 space-y-8 w-full">

        {/* ── Summary Row ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Profit (30d)" value={`$${grandTotalUsd.toFixed(2)}`} sub={`${grandTotalLiqs} liquidations`} pulse={grandTotalLiqs > 0} />
          <StatCard label="Wallet Balance" value={`$${totalWalletUsd.toFixed(0)}`} sub="across all chains" />
          <StatCard label="Chains Active" value="5" sub="Arbitrum · ETH · Base · BSC · OP" />
          <StatCard label="Min Profit Floor" value="$0.05" sub="per liquidation" />
        </div>

        {/* ── Wallet address ── */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-card border border-surface-border text-sm">
          <span className="text-slate-500 shrink-0">Wallet</span>
          <span className="font-mono text-slate-300 truncate">{WALLET}</span>
          <a
            href={`https://debank.com/profile/${WALLET}`}
            target="_blank" rel="noopener noreferrer"
            className="ml-auto shrink-0 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            DeBank ↗
          </a>
        </div>

        {/* ── Per-chain cards ── */}
        <div className="grid md:grid-cols-2 gap-5">
          {CHAINS.map((chain, i) => {
            const s = stats[i];
            return (
              <ChainCard
                key={chain.id}
                chain={chain}
                stats={s}
              />
            );
          })}
        </div>

        {/* ── Profit history table ── */}
        <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <h2 className="font-semibold text-white">Profit History (30 days)</h2>
            <span className="text-xs text-slate-500">{grandTotalLiqs} transactions found</span>
          </div>
          {grandTotalLiqs === 0 && !stats.some(s => s.loading) ? (
            <div className="px-5 py-10 text-center text-slate-500">
              <p className="text-3xl mb-2">🔍</p>
              <p className="font-medium text-slate-400">No profit transactions yet</p>
              <p className="text-sm mt-1">The bot is scanning — profits will appear here when liquidations execute.</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-border">
              {CHAINS.flatMap((chain, i) =>
                stats[i].profits.map((p) => (
                  <div key={p.txHash + chain.id} className="px-5 py-3.5 flex items-center gap-4 hover:bg-surface-hover transition-colors">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${CHAINS[i].bg} ${CHAINS[i].color} ${CHAINS[i].border} border font-medium`}>
                      {chain.name}
                    </span>
                    <span className="font-mono text-xs text-slate-400 truncate flex-1">
                      {p.txHash.slice(0, 18)}…
                    </span>
                    <span className="text-sm text-green-400 font-semibold ml-auto shrink-0">
                      +${p.usdVal.toFixed(2)}
                    </span>
                    <a
                      href={`${chain.explorer}/tx/${p.txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-slate-500 hover:text-brand-400 transition-colors shrink-0"
                    >
                      ↗
                    </a>
                  </div>
                ))
              )}
              {stats.some(s => s.loading) && (
                <div className="px-5 py-4 text-center text-xs text-slate-500 animate-pulse">
                  Loading transactions…
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Quick links ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink href="https://app.aave.com/liquidations/" label="Aave Liquidations" icon="⚡" />
          <QuickLink href={`https://arbiscan.io/address/${WALLET}`} label="Arbiscan Wallet" icon="🔷" />
          <QuickLink href={`https://etherscan.io/address/${WALLET}`} label="Etherscan Wallet" icon="🔮" />
          <QuickLink href={`https://debank.com/profile/${WALLET}`} label="Full Portfolio" icon="💼" />
        </div>

      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, pulse }: { label: string; value: string; sub?: string; pulse?: boolean }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        {pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-black text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ChainCard({ chain, stats }: { chain: typeof CHAINS[number]; stats: ChainStats }) {
  const { balance, profits, totalUsd, loading, error, block, ethPrice } = stats;

  return (
    <div className={`bg-surface-card border rounded-xl overflow-hidden ${chain.border}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b border-surface-border`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${chain.color}`}>{chain.name}</span>
          {!loading && !error && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          )}
          {error && <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
        </div>
        {block && (
          <span className="text-xs text-slate-500 font-mono">
            block {block.toLocaleString()}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="h-16 animate-pulse bg-surface-hover rounded-lg" />
        ) : error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : (
          <>
            {/* Wallet balance */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Wallet balance</span>
              <span className="text-sm font-semibold text-white">
                {balance !== null
                  ? `${balance.toFixed(4)} ${chain.symbol} ($${(balance * ethPrice).toFixed(2)})`
                  : "—"}
              </span>
            </div>

            {/* Flash contract */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Contract</span>
              <a
                href={`${chain.explorer}/address/${chain.contract}`}
                target="_blank" rel="noopener noreferrer"
                className={`text-xs font-mono ${chain.color} hover:underline`}
              >
                {chain.contract.slice(0, 10)}…
              </a>
            </div>

            {/* Profit */}
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Profit (30d)</span>
              <span className={`text-sm font-bold ${totalUsd > 0 ? "text-green-400" : "text-slate-500"}`}>
                {totalUsd > 0 ? `+$${totalUsd.toFixed(2)}` : "No profits yet"}
                {profits.length > 0 && <span className="text-xs font-normal text-slate-400 ml-1">({profits.length} txs)</span>}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-3 flex gap-2">
        <a
          href={`${chain.explorer}/address/${WALLET}`}
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Wallet ↗
        </a>
        <span className="text-slate-700">·</span>
        <a
          href={`${chain.explorer}/address/${chain.contract}`}
          target="_blank" rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Contract ↗
        </a>
      </div>
    </div>
  );
}

function QuickLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <a
      href={href}
      target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface-card border border-surface-border hover:border-brand-600/40 hover:bg-surface-hover transition-colors text-sm text-slate-300"
    >
      <span>{icon}</span>
      <span>{label}</span>
    </a>
  );
}
