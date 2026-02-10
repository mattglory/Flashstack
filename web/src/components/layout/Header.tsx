"use client";

import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkSelector } from "@/components/wallet/NetworkSelector";

export function Header() {
  return (
    <header className="h-16 border-b border-surface-border flex items-center justify-between px-6">
      <h1 className="text-lg font-semibold text-white">Dashboard</h1>
      <div className="flex items-center gap-4">
        <NetworkSelector />
        <ConnectButton />
      </div>
    </header>
  );
}
