"use client";

import { useStacks } from "@/lib/hooks/useStacks";
import { useUserStats } from "@/lib/hooks/useUserStats";
import { formatStx, formatSbtc } from "@/lib/utils/format";
import { StatCard } from "./StatCard";

export function UserStats() {
  const { isWalletConnected, connectWallet } = useStacks();
  const { userStats, loading, error } = useUserStats();

  if (!isWalletConnected) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Your Position</h2>
        <div className="bg-surface-card border border-surface-border rounded-xl p-8 text-center">
          <p className="text-slate-400 mb-4">
            Connect your wallet to view your position
          </p>
          <button
            onClick={connectWallet}
            className="px-6 py-2.5 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors"
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Your Position</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-card border border-surface-border rounded-xl p-5 animate-pulse"
            >
              <div className="h-4 w-24 bg-surface-hover rounded mb-3" />
              <div className="h-8 w-32 bg-surface-hover rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Your Position</h2>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
          <p className="text-red-400 text-sm">Failed to load your stats: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Your Position</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          label="STX Locked"
          value={userStats ? `${formatStx(userStats.stxLocked)} STX` : "0 STX"}
          subtext="Collateral locked in PoX"
        />
        <StatCard
          label="Max Flash Amount"
          value={
            userStats
              ? `${formatSbtc(userStats.maxFlashAmount)} sBTC`
              : "0 sBTC"
          }
          subtext="Based on 300% collateral ratio"
        />
      </div>
    </div>
  );
}
