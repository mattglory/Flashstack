"use client";

import { useStacks } from "@/lib/hooks/useStacks";
import type { NetworkType } from "@/lib/stacks/config";

export function NetworkSelector() {
  const { network, setNetwork } = useStacks();

  const options: { value: NetworkType; label: string }[] = [
    { value: "testnet", label: "Testnet" },
    { value: "mainnet", label: "Mainnet" },
  ];

  return (
    <select
      value={network}
      onChange={(e) => setNetwork(e.target.value as NetworkType)}
      className="px-3 py-2 text-sm rounded-lg bg-surface-card border border-surface-border text-slate-300 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
