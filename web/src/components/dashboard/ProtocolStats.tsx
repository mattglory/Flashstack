"use client";

import { useProtocolStats } from "@/lib/hooks/useProtocolStats";
import { StatCard } from "./StatCard";
import { StatusBadge } from "./StatusBadge";

function formatStx(micro: bigint) {
  return (Number(micro) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function ProtocolStats() {
  const { stats, loading, error } = useProtocolStats();

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Protocol Stats</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-surface-card border border-surface-border rounded-xl p-5 animate-pulse">
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
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
        <p className="text-red-400 text-sm">Failed to load protocol stats: {error}</p>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Protocol Stats</h2>
        <StatusBadge paused={stats.paused} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Total Flash Loans"
          value={stats.totalFlashMints.toLocaleString()}
        />
        <StatCard
          label="Total Volume"
          value={`${formatStx(stats.totalVolume)} STX`}
        />
        <StatCard
          label="Fees Collected"
          value={`${formatStx(stats.totalFeesCollected)} STX`}
        />
        <StatCard
          label="Fee Rate"
          value={`${(stats.currentFeeBp / 100).toFixed(2)}%`}
          subtext={`${stats.currentFeeBp} basis points`}
        />
        <StatCard
          label="Max Single Loan"
          value={`${formatStx(stats.maxSingleLoan)} STX`}
          subtext="Circuit breaker limit"
        />
      </div>
    </div>
  );
}
