"use client";

import { useState } from "react";
import { useStacks } from "@/lib/hooks/useStacks";
import { truncateAddress } from "@/lib/utils/format";

export function ConnectButton() {
  const { isWalletConnected, stxAddress, connectWallet, disconnectWallet } = useStacks();
  const [showHint, setShowHint] = useState(false);

  if (isWalletConnected && stxAddress) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden sm:block text-sm text-slate-400">
          {truncateAddress(stxAddress)}
        </span>
        <button
          onClick={disconnectWallet}
          className="px-4 py-2 text-sm rounded-lg border border-surface-border text-slate-300 hover:bg-surface-hover transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={async () => {
          try {
            await connectWallet();
          } catch {
            setShowHint(true);
            setTimeout(() => setShowHint(false), 4000);
          }
        }}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-500 text-white transition-colors"
      >
        Connect Wallet
      </button>

      {showHint && (
        <div className="absolute right-0 top-12 z-50 w-64 bg-surface-card border border-surface-border rounded-xl p-4 shadow-xl">
          <p className="text-sm text-white font-medium mb-1">No wallet detected</p>
          <p className="text-xs text-slate-400 mb-3">
            You need the Leather wallet extension to use FlashStack on Stacks mainnet.
          </p>
          <a
            href="https://leather.io/install-extension"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium transition-colors"
          >
            Get Leather Wallet →
          </a>
        </div>
      )}
    </div>
  );
}
