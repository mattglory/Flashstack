"use client";

import { useState, useEffect, useCallback } from "react";
import { useStacks } from "./useStacks";
import { LP_POOLS, PoolAsset } from "@/lib/stacks/config";
import { fetchPoolStats, fetchPoolUserPosition } from "@/lib/stacks/pool-client";
import type { PoolStats, PoolUserPosition } from "@/lib/stacks/types";

type TxStatus = "idle" | "pending" | "success" | "error";

interface TxState {
  status: TxStatus;
  txId: string | null;
  error: string | null;
}

const IDLE: TxState = { status: "idle", txId: null, error: null };

export function usePool(asset: PoolAsset) {
  const pool = LP_POOLS[asset];
  const { isWalletConnected, stxAddress: address, network } = useStacks();

  const [stats, setStats] = useState<PoolStats | null>(null);
  const [position, setPosition] = useState<PoolUserPosition | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [deposit, setDeposit] = useState<TxState>(IDLE);
  const [withdraw, setWithdraw] = useState<TxState>(IDLE);

  // Fetch pool stats + user position
  const refresh = useCallback(async () => {
    try {
      const s = await fetchPoolStats(asset, network);
      setStats(s);
    } catch { /* ignore */ }
    setLoadingStats(false);

    if (isWalletConnected && address) {
      try {
        const p = await fetchPoolUserPosition(asset, address, network);
        setPosition(p);
      } catch { /* ignore */ }
    }
  }, [asset, isWalletConnected, address, network]);

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
    if (!address) {
      setDeposit({ status: "error", txId: null, error: "Wallet address unavailable" });
      return;
    }
    setDeposit({ status: "pending", txId: null, error: null });
    try {
      const { request } = await import("@stacks/connect");
      const { Cl, cvToHex, Pc } = await import("@stacks/transactions");

      // Bound the deposit: the wallet enforces that exactly `amount` leaves the user.
      const amt = BigInt(amountMicroStx);
      const postCondition = pool.nativeStx
        ? Pc.principal(address).willSendEq(amt).ustx()
        : Pc.principal(address).willSendEq(amt).ft(pool.tokenContract! as `${string}.${string}`, pool.tokenName!);

      const result = await request("stx_callContract", {
        contract: `${pool.address}.${pool.name}`,
        functionName: "deposit",
        functionArgs: [cvToHex(Cl.uint(amt))],
        postConditions: [postCondition],
        postConditionMode: "deny",
      });

      const txId = typeof result === "object" && result !== null && "txid" in result
        ? String((result as Record<string, unknown>).txid) : null;
      setDeposit({ status: "success", txId, error: null });
    } catch (err) {
      setDeposit({ status: "error", txId: null, error: err instanceof Error ? err.message : "Failed" });
    }
  }, [isWalletConnected, pool, address]);

  // Withdraw shares from pool. minReceive = the minimum the pool must send back
  // (in the asset's base units), enforced by a deny-mode post-condition.
  const executeWithdraw = useCallback(async (shares: string, minReceive: string) => {
    if (!isWalletConnected) {
      setWithdraw({ status: "error", txId: null, error: "Wallet not connected" });
      return;
    }
    setWithdraw({ status: "pending", txId: null, error: null });
    try {
      const { request } = await import("@stacks/connect");
      const { Cl, cvToHex, Pc } = await import("@stacks/transactions");

      const poolId = `${pool.address}.${pool.name}` as `${string}.${string}`;
      const min = BigInt(minReceive);
      const postCondition = pool.nativeStx
        ? Pc.principal(poolId).willSendGte(min).ustx()
        : Pc.principal(poolId).willSendGte(min).ft(pool.tokenContract! as `${string}.${string}`, pool.tokenName!);

      const result = await request("stx_callContract", {
        contract: poolId,
        functionName: "withdraw",
        functionArgs: [cvToHex(Cl.uint(BigInt(shares)))],
        postConditions: [postCondition],
        postConditionMode: "deny",
      });

      const txId = typeof result === "object" && result !== null && "txid" in result
        ? String((result as Record<string, unknown>).txid) : null;
      setWithdraw({ status: "success", txId, error: null });
    } catch (err) {
      setWithdraw({ status: "error", txId: null, error: err instanceof Error ? err.message : "Failed" });
    }
  }, [isWalletConnected, pool]);

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
