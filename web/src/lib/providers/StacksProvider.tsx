"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  connect,
  disconnect,
  isConnected,
  getLocalStorage,
} from "@stacks/connect";
import type { NetworkType } from "@/lib/stacks/config";

interface StacksContextValue {
  isWalletConnected: boolean;
  stxAddress: string | null;
  network: NetworkType;
  setNetwork: (network: NetworkType) => void;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
}

const StacksContext = createContext<StacksContextValue | null>(null);

export function StacksProvider({ children }: { children: React.ReactNode }) {
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [stxAddress, setStxAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkType>(
    (process.env.NEXT_PUBLIC_NETWORK as NetworkType) ?? "mainnet"
  );

  const hydrateFromStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!isConnected()) {
      setIsWalletConnected(false);
      setStxAddress(null);
      return;
    }
    const stored = getLocalStorage();
    if (stored?.addresses?.stx?.[0]?.address) {
      setStxAddress(stored.addresses.stx[0].address);
      setIsWalletConnected(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from wallet localStorage, which is only readable client-side after mount
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  const connectWallet = useCallback(async () => {
    // forceWalletSelect: always open the wallet picker (a plain connect() defaults
    // to a previously-selected provider, so a first-time connect never prompts).
    const result = await connect({ forceWalletSelect: true });
    // Set state straight from the response (more reliable than storage timing).
    const stx =
      result?.addresses?.find((a) => a.symbol === "STX") ??
      result?.addresses?.find((a) => a.address?.startsWith("S"));
    if (stx?.address) {
      setStxAddress(stx.address);
      setIsWalletConnected(true);
    } else {
      hydrateFromStorage();
    }
  }, [hydrateFromStorage]);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setIsWalletConnected(false);
    setStxAddress(null);
  }, []);

  return (
    <StacksContext.Provider
      value={{
        isWalletConnected,
        stxAddress,
        network,
        setNetwork,
        connectWallet,
        disconnectWallet,
      }}
    >
      {children}
    </StacksContext.Provider>
  );
}

export function useStacksContext() {
  const ctx = useContext(StacksContext);
  if (!ctx) {
    throw new Error("useStacksContext must be used within a StacksProvider");
  }
  return ctx;
}
