"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { fetchProtocolStats } from "@/lib/stacks/client";
import { CONTRACT_ADDRESS, CONTRACT_NAME } from "@/lib/stacks/config";

interface FlashLoanState {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
}

export function useFlashLoan() {
  const { isWalletConnected, network } = useStacks();
  const [state, setState] = useState<FlashLoanState>({
    status: "idle",
    txId: null,
    error: null,
  });

  const executeFlashLoan = useCallback(
    async (amountMicroSbtc: string, receiverContract: string) => {
      if (!isWalletConnected) {
        setState({ status: "error", txId: null, error: "Wallet not connected" });
        return;
      }

      setState({ status: "pending", txId: null, error: null });

      try {
        const { request } = await import("@stacks/connect");
        const result = await request("stx_callContract", {
          contract: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
          functionName: "flash-mint",
          functionArgs: [
            `u${amountMicroSbtc}`,
            `'${CONTRACT_ADDRESS}.${receiverContract}`,
          ],
        });

        const txId = typeof result === "object" && result !== null && "txid" in result
          ? String((result as Record<string, unknown>).txid)
          : null;

        setState({ status: "success", txId, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setState({ status: "error", txId: null, error: message });
      }
    },
    [isWalletConnected]
  );

  const reset = useCallback(() => {
    setState({ status: "idle", txId: null, error: null });
  }, []);

  return {
    ...state,
    executeFlashLoan,
    reset,
  };
}
