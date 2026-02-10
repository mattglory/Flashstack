"use client";

import { useStacks } from "@/lib/hooks/useStacks";
import { truncateAddress } from "@/lib/utils/format";

export function ConnectButton() {
  const { isWalletConnected, stxAddress, connectWallet, disconnectWallet } =
    useStacks();

  if (isWalletConnected && stxAddress) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">
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
    <button
      onClick={connectWallet}
      className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition-colors"
    >
      Connect Wallet
    </button>
  );
}
