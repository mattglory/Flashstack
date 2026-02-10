"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchStxLocked, fetchMaxFlashAmount } from "@/lib/stacks/client";
import type { UserStats } from "@/lib/stacks/types";
import { useStacks } from "./useStacks";

export function useUserStats() {
  const { isWalletConnected, stxAddress, network } = useStacks();
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isWalletConnected || !stxAddress) {
      setUserStats(null);
      return;
    }

    setLoading(true);
    try {
      const stxLocked = await fetchStxLocked(stxAddress, network);
      const maxFlashAmount = await fetchMaxFlashAmount(stxLocked, network);
      setUserStats({ stxLocked, maxFlashAmount });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch user stats");
    } finally {
      setLoading(false);
    }
  }, [isWalletConnected, stxAddress, network]);

  useEffect(() => {
    load();
  }, [load]);

  return { userStats, loading, error };
}
