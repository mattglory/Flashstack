"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { STX_CONTRACT_ADDRESS, STX_CONTRACT_NAME, STX_RECEIVER_CONTRACTS } from "@/lib/stacks/config";

interface StxFlashLoanState {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
}

export function useStxFlashLoan() {
  const { isWalletConnected } = useStacks();
  const [state, setState] = useState<StxFlashLoanState>({
    status: "idle",
    txId: null,
    error: null,
  });

  const executeStxFlashLoan = useCallback(
    async (amountMicroStx: string, receiverName: string) => {
      if (!isWalletConnected) {
        setState({ status: "error", txId: null, error: "Wallet not connected" });
        return;
      }

      setState({ status: "pending", txId: null, error: null });

      try {
        const { request } = await import("@stacks/connect");
        const { Cl, cvToHex } = await import("@stacks/transactions");

        const receiverPrincipal = `${STX_CONTRACT_ADDRESS}.${receiverName}`;

        // PostConditionMode.Allow (0x02) — flash loans move STX internally
        // through receiver contracts. Leather adds restrictive post-conditions
        // by default which block these internal transfers. Allow mode disables that.
        const result = await request("stx_callContract", {
          contract: `${STX_CONTRACT_ADDRESS}.${STX_CONTRACT_NAME}`,
          functionName: "flash-loan",
          functionArgs: [
            cvToHex(Cl.uint(BigInt(amountMicroStx))),
            cvToHex(Cl.principal(receiverPrincipal)),
          ],
          postConditionMode: "allow",
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
    executeStxFlashLoan,
    reset,
  };
}
