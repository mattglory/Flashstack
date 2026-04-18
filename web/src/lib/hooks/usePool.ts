"use client";

import { useState, useEffect, useCallback } from "react";
import { useStacks } from "./useStacks";
import { POOL_CONTRACT_ADDRESS, POOL_CONTRACT_NAME } from "@/lib/stacks/config";
import { fetchPoolStats, fetchPoolUserPosition } from "@/lib/stacks/pool-client";
import type { PoolStats, PoolUserPosition } from "@/lib/stacks/types";

type TxStatus = "idle" | "pending" | "success" | "error";

interface TxState {
  status: TxStatus;
  txId: string | null;
  error: string | null;
}

const IDLE: TxState = { status: "idle", txId: null, error: null };

export function usePool() {
  const { isWalletConnected, stxAddress: address, network } = useStacks();

  const [stats, setStats] = useState<PoolStats | null>(null);
  const [position, setPosition] = useState<PoolUserPosition | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [deposit, setDeposit] = useState<TxState>(IDLE);
  const [withdraw, setWithdraw] = useState<TxState>(IDLE);

  // Fetch pool stats + user position
  const refresh = useCallback(async () => {
    try {
      const s = await fetchPoolStats(network);
      setStats(s);
    } catch { /* ignore */ }
    setLoadingStats(false);

    if (isWalletConnected && address) {
      try {
        const p = await fetchPoolUserPosition(address, network);
        setPosition(p);
      } catch { /* ignore */ }
    }
  }, [isWalletConnected, address, network]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Deposit STX into pool
  const executeDeposit = useCallback(async (amountMicroStx: string) => {
    if (!isWalletConnected) {
      setDeposit({ status: "error", txId: null, error: "Wallet not connected" });
      return;
    }
    setDeposit({ status: "pending", txId: null, error: null });
    try {
      const { request } = await import("@stacks/connect");
      const { Cl, cvToHex } = await import("@stacks/transactions");

      const result = await request("stx_callContract", {
        contract: `${POOL_CONTRACT_ADDRESS}.${POOL_CONTRACT_NAME}`,
        functionName: "deposit",
        functionArgs: [cvToHex(Cl.uint(BigInt(amountMicroStx)))],
        postConditionMode: "allow",
      });

      const txId = typeof result === "object" && result !== null && "txid" in result
        ? String((result as Record<string, unknown>).txid) : null;
      setDeposit({ status: "success", txId, error: null });
    } catch (err) {
      setDeposit({ status: "error", txId: null, error: err instanceof Error ? err.message : "Failed" });
    }
  }, [isWalletConnected]);

  // Withdraw shares from pool
  const executeWithdraw = useCallback(async (shares: string) => {
    if (!isWalletConnected) {
      setWithdraw({ status: "error", txId: null, error: "Wallet not connected" });
      return;
    }
    setWithdraw({ status: "pending", txId: null, error: null });
    try {
      const { request } = await import("@stacks/connect");
      const { Cl, cvToHex } = await import("@stacks/transactions");

      const result = await request("stx_callContract", {
        contract: `${POOL_CONTRACT_ADDRESS}.${POOL_CONTRACT_NAME}`,
        functionName: "withdraw",
        functionArgs: [cvToHex(Cl.uint(BigInt(shares)))],
        postConditionMode: "allow",
      });

      const txId = typeof result === "object" && result !== null && "txid" in result
        ? String((result as Record<string, unknown>).txid) : null;
      setWithdraw({ status: "success", txId, error: null });
    } catch (err) {
      setWithdraw({ status: "error", txId: null, error: err instanceof Error ? err.message : "Failed" });
    }
  }, [isWalletConnected]);

  return {
    stats,
    position,
    loadingStats,
    deposit,
    withdraw,
    executeDeposit,
    executeWithdraw,
    resetDeposit: () => setDeposit(IDLE),
    resetWithdraw: () => setWithdraw(IDLE),
    refresh,
  };
}
