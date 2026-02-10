"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchProtocolStats } from "@/lib/stacks/client";
import type { ProtocolStats } from "@/lib/stacks/types";
import { useStacks } from "./useStacks";

const REFRESH_INTERVAL = 30_000;

export function useProtocolStats() {
  const { network } = useStacks();
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchProtocolStats(network);
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  }, [network]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  return { stats, loading, error };
}
