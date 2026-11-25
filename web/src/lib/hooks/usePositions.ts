"use client";

import { useState, useEffect, useCallback } from "react";
import { LP_POOLS, PoolAsset } from "@/lib/stacks/config";
import { fetchPoolUserPosition } from "@/lib/stacks/pool-client";
import { useStacks } from "./useStacks";

export interface LpPosition {
  asset: PoolAsset;
  symbol: string;
  decimals: number;
  shares: bigint;
  value: bigint; // current value in the asset's base units
}

/** The user's real LP positions across every listed pool (STX, sBTC, …). */
export function usePositions() {
  const { isWalletConnected, stxAddress, network } = useStacks();
  const [positions, setPositions] = useState<LpPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isWalletConnected || !stxAddress) { setPositions([]); return; }
    setLoading(true);
    try {
      const assets = Object.keys(LP_POOLS) as PoolAsset[];
      const results = await Promise.all(
        assets.map(async (a) => {
          const p = await fetchPoolUserPosition(a, stxAddress, network);
          return {
            asset: a,
            symbol: LP_POOLS[a].symbol,
            decimals: LP_POOLS[a].decimals,
            shares: p.shares,
            value: p.stxValue,
          };
        })
      );
      setPositions(results);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [isWalletConnected, stxAddress, network]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch/poll that syncs with an external system (chain API); setState runs in the async callback path
  useEffect(() => { load(); }, [load]);

  return { positions, loading, error };
}
