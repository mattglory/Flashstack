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
  const [network, setNetwork] = useState<NetworkType>("testnet");

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
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  const connectWallet = useCallback(async () => {
    try {
      await connect();
      hydrateFromStorage();
    } catch (err) {
      console.error("Wallet connection failed:", err);
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
