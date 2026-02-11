"use client";

import { useState, useEffect } from "react";
import { useStacks } from "@/lib/hooks/useStacks";
import { useFlashLoan } from "@/lib/hooks/useFlashLoan";
import { useProtocolStats } from "@/lib/hooks/useProtocolStats";
import { useUserStats } from "@/lib/hooks/useUserStats";
import { formatSbtc, formatFeeBp } from "@/lib/utils/format";
import { CONTRACT_ADDRESS, RECEIVER_CONTRACTS } from "@/lib/stacks/config";
import { StatCard } from "@/components/dashboard/StatCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";

export function FlashLoanForm() {
  const { isWalletConnected, connectWallet } = useStacks();
  const { stats } = useProtocolStats();
  const { userStats } = useUserStats();
  const { status, txId, error, executeFlashLoan, reset } = useFlashLoan();

  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState<string>(RECEIVER_CONTRACTS[0].name);

  // Calculate fee preview
  const amountMicro = amount ? Math.floor(parseFloat(amount) * 1e8) : 0;
  const feeBp = stats?.currentFeeBp ?? 5;
  const feePreview = Math.floor((amountMicro * feeBp) / 10000);
  const totalOwed = amountMicro + feePreview;

  const isPaused = stats?.paused ?? false;
  const maxFlash = userStats?.maxFlashAmount ?? 0n;
  const exceedsMax = amountMicro > 0 && BigInt(amountMicro) > maxFlash;

  if (!isWalletConnected) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-xl p-8 text-center">
        <p className="text-slate-400 mb-4">
          Connect your wallet to execute flash loans
        </p>
        <button
          onClick={connectWallet}
          className="px-6 py-2.5 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountMicro || isPaused) return;
    await executeFlashLoan(String(amountMicro), receiver);
  };

  return (
    <div className="space-y-6">
      {/* Protocol Status */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Execute Flash Loan</h2>
        {stats && <StatusBadge paused={stats.paused} />}
      </div>

      {/* Fee & Limits Info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Current Fee"
          value={formatFeeBp(feeBp)}
          subtext={`${feeBp} basis points`}
        />
        <StatCard
          label="Your Max Flash"
          value={`${formatSbtc(maxFlash)} sBTC`}
          subtext="Based on locked STX"
        />
        <StatCard
          label="Total Mints"
          value={stats?.totalFlashMints.toLocaleString() ?? "..."}
        />
      </div>

      {/* Flash Loan Form */}
      <form onSubmit={handleSubmit} className="bg-surface-card border border-surface-border rounded-xl p-6 space-y-5">
        {/* Amount Input */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Loan Amount (sBTC)
          </label>
          <input
            type="number"
            step="0.00000001"
            min="0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); reset(); }}
            placeholder="0.00"
            className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-border text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500 text-lg"
          />
          {exceedsMax && (
            <p className="text-red-400 text-xs mt-1">
              Exceeds your max flash amount ({formatSbtc(maxFlash)} sBTC)
            </p>
          )}
        </div>

        {/* Receiver Selector */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Receiver Contract
          </label>
          <select
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-surface border border-surface-border text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {RECEIVER_CONTRACTS.map((r) => (
              <option key={r.name} value={r.name}>
                {r.label} — {r.description}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">
            {CONTRACT_ADDRESS}.{receiver}
          </p>
        </div>

        {/* Fee Preview */}
        {amountMicro > 0 && (
          <div className="bg-surface rounded-lg border border-surface-border p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Loan Amount</span>
              <span className="text-white">{formatSbtc(BigInt(amountMicro))} sBTC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Fee ({formatFeeBp(feeBp)})</span>
              <span className="text-white">{formatSbtc(BigInt(feePreview))} sBTC</span>
            </div>
            <div className="border-t border-surface-border pt-2 flex justify-between text-sm font-medium">
              <span className="text-slate-300">Total Repayment</span>
              <span className="text-white">{formatSbtc(BigInt(totalOwed))} sBTC</span>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!amountMicro || isPaused || status === "pending" || exceedsMax}
          className="w-full px-6 py-3 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700 disabled:text-slate-500 text-white transition-colors"
        >
          {status === "pending"
            ? "Submitting..."
            : isPaused
            ? "Protocol Paused"
            : "Execute Flash Loan"}
        </button>

        {/* Status Messages */}
        {status === "success" && (
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <p className="text-green-400 text-sm font-medium">Transaction submitted</p>
            {txId && (
              <a
                href={`https://explorer.hiro.so/txid/${txId}?chain=testnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400/80 text-xs underline mt-1 block"
              >
                View on Explorer
              </a>
            )}
          </div>
        )}

        {status === "error" && error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </form>
    </div>
  );
}
