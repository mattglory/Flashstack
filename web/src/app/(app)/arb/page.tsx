"use client";

import { useState } from "react";
import { useBitflowArb } from "@/lib/hooks/useBitflowArb";
import { useStacks } from "@/lib/hooks/useStacks";

const MAX_STX = 5000;

function formatStx(micro: number) {
  return (micro / 1e6).toFixed(4);
}

export default function ArbPage() {
  const { isWalletConnected } = useStacks();
  const { status, quote, txId, error, checkArb, executeArb, reset } = useBitflowArb();
  const [amount, setAmount] = useState("10");

  const amountNum = parseFloat(amount) || 0;
  const isValid   = amountNum > 0 && amountNum <= MAX_STX;

  return (
    <div className="max-w-2xl space-y-6 pb-20 md:pb-0">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Bitflow Arbitrage Bot</h2>
        <p className="text-sm text-slate-400 mt-1">
          Flash loan STX → buy stSTX on Bitflow → sell back → repay → keep profit. One click, one transaction.
        </p>
      </div>

      {/* How it works callout */}
      <div className="bg-brand-600/5 border border-brand-600/15 rounded-xl p-4 text-sm text-slate-300 space-y-1.5">
        <p className="text-brand-400 font-medium">How this bot works</p>
        <p>When stSTX trades above its fair value on Bitflow (happens after stacking reward cycles), there&apos;s a spread to capture:</p>
        <ol className="list-decimal list-inside space-y-1 text-slate-400 ml-1">
          <li>Flash borrow STX from FlashStack (no collateral)</li>
          <li>Buy stSTX on Bitflow stableswap</li>
          <li>Sell stSTX back to STX (at a higher rate)</li>
          <li>Repay FlashStack + 0.05% fee</li>
          <li>Keep the spread as pure profit</li>
        </ol>
        <p className="text-slate-500 text-xs mt-2">If the arb isn&apos;t profitable, the transaction reverts automatically — you pay nothing except Stacks gas (~$0.002).</p>
      </div>

      {/* Main panel */}
      <div className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
        <div className="p-5 space-y-4">
          {/* Amount input */}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Loan amount (STX)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max={MAX_STX}
                step="10"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); reset(); }}
                className="flex-1 bg-surface border border-surface-border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 text-sm"
              />
              <div className="flex gap-1">
                {[10, 50, 100].map(v => (
                  <button
                    key={v}
                    onClick={() => { setAmount(String(v)); reset(); }}
                    className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                      amountNum === v
                        ? "border-brand-500 text-brand-400 bg-brand-600/10"
                        : "border-surface-border text-slate-400 hover:text-white"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">Max {MAX_STX} STX per loan · Flash loan fee: {(amountNum * 0.0005).toFixed(4)} STX</p>
          </div>

          {/* Quote display */}
          {quote && (
            <div className={`rounded-xl p-4 space-y-2 text-sm border ${
              quote.profitable
                ? "bg-green-900/10 border-green-800/30"
                : "bg-surface border-surface-border"
            }`}>
              <div className="flex justify-between">
                <span className="text-slate-400">Leg 1: STX → stSTX</span>
                <span className="text-white">{formatStx(quote.ststxOut)} stSTX</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Leg 2: stSTX → STX</span>
                <span className="text-white">{formatStx(quote.stxBack)} STX</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total owed (principal + fee + gas)</span>
                <span className="text-slate-300">{formatStx(quote.totalOwed)} STX</span>
              </div>
              <div className="border-t border-surface-border pt-2 flex justify-between font-medium">
                <span className={quote.profitable ? "text-green-400" : "text-slate-400"}>
                  {quote.profitable ? "Estimated profit" : "Estimated loss"}
                </span>
                <span className={quote.profitable ? "text-green-400 text-base" : "text-red-400"}>
                  {quote.profitable ? "+" : ""}{formatStx(quote.profit)} STX
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">stSTX/STX ratio on Bitflow</span>
                <span className={quote.ratio > 1.0005 ? "text-green-400" : "text-slate-500"}>
                  {quote.ratio.toFixed(6)} {quote.ratio > 1.0005 ? "↑ above peg" : "≈ at peg"}
                </span>
              </div>
            </div>
          )}

          {/* Status messages */}
          {status === "no-opportunity" && (
            <div className="rounded-lg bg-amber-900/10 border border-amber-800/20 p-3 text-sm">
              <p className="text-amber-400 font-medium">No arb opportunity right now</p>
              <p className="text-slate-400 text-xs mt-1">
                stSTX is trading at or below peg ({quote?.ratio.toFixed(6)} stSTX/STX).
                Opportunities appear after stacking reward cycles distribute yields (~every 2 weeks).
                Keep the monitor running — it will catch the window when it opens.
              </p>
            </div>
          )}

          {status === "success" && (
            <div className="rounded-lg bg-green-900/15 border border-green-800/30 p-3 text-sm">
              <p className="text-green-400 font-medium">Transaction submitted</p>
              {txId && (
                <a
                  href={`https://explorer.hiro.so/txid/0x${txId}?chain=mainnet`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-brand-400 hover:underline text-xs mt-1 block break-all"
                >
                  View on Explorer → 0x{txId.slice(0, 20)}...
                </a>
              )}
              <p className="text-slate-400 text-xs mt-1">If stSTX price moved unfavorably, the transaction will revert — you only lose the Stacks tx fee.</p>
            </div>
          )}

          {status === "error" && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => checkArb(amountNum)}
              disabled={!isValid || status === "checking"}
              className="flex-1 py-3 rounded-lg bg-surface hover:bg-surface-hover border border-surface-border disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
            >
              {status === "checking" ? "Checking price..." : "Check Price"}
            </button>

            {(status === "ready" || status === "no-opportunity") && (
              <button
                onClick={() => executeArb(amountNum)}
                disabled={!isWalletConnected || !quote?.profitable}
                className="flex-1 py-3 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
              >
                {!isWalletConnected
                  ? "Connect Wallet"
                  : !quote?.profitable
                    ? "No Profit Available"
                    : `Execute — +${formatStx(quote?.profit ?? 0)} STX`}
              </button>
            )}
          </div>

          {!isWalletConnected && (
            <p className="text-xs text-slate-500 text-center">Connect your wallet to execute. Checking price doesn&apos;t require a wallet.</p>
          )}
        </div>
      </div>

      {/* When to run */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-5">
        <p className="text-sm font-medium text-white mb-3">When are opportunities most likely?</p>
        <div className="space-y-2 text-sm text-slate-400">
          <p><span className="text-brand-400">Stacking cycles</span> — stSTX accumulates yield every ~2 weeks. Right after a cycle ends, stSTX briefly trades above 1 STX until arbitrageurs equalise it. That&apos;s your window.</p>
          <p><span className="text-brand-400">Run the monitor bot</span> — the script below checks every 30 seconds and auto-executes when profitable:</p>
        </div>
        <pre className="mt-3 bg-surface rounded-lg border border-surface-border p-3 text-xs text-slate-300 overflow-x-auto">
{`EXECUTE=true DEPLOYER_MNEMONIC="..." \\
  LOAN_STX=50 \\
  node scripts/monitor-opportunities.mjs`}
        </pre>
      </div>
    </div>
  );
}
