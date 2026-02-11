"use client";

import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { NetworkSelector } from "@/components/wallet/NetworkSelector";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/flash-loan": "Flash Loan",
};

export function Header() {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? "FlashStack";

  return (
    <header className="h-16 border-b border-surface-border flex items-center justify-between px-6">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-4">
        <NetworkSelector />
        <ConnectButton />
      </div>
    </header>
  );
}
