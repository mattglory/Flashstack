"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { SBTC_CONTRACT_ADDRESS, SBTC_CONTRACT_NAME } from "@/lib/stacks/config";

interface SbtcFlashLoanState {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
}

export function useSbtcFlashLoan() {
  const { isWalletConnected } = useStacks();
  const [state, setState] = useState<SbtcFlashLoanState>({
    status: "idle",
    txId: null,
    error: null,
  });

  const executeSbtcFlashLoan = useCallback(
    async (amountSats: string, receiverName: string) => {
      if (!isWalletConnected) {
        setState({ status: "error", txId: null, error: "Wallet not connected" });
        return;
      }

      setState({ status: "pending", txId: null, error: null });

      try {
        const { request } = await import("@stacks/connect");
        const { Cl, cvToHex } = await import("@stacks/transactions");

        const receiverPrincipal = `${SBTC_CONTRACT_ADDRESS}.${receiverName}`;

        // PostConditionMode.Allow — flash loans move sBTC internally through
        // receiver contracts. Allow mode disables restrictive wallet post-conditions.
        const result = await request("stx_callContract", {
          contract: `${SBTC_CONTRACT_ADDRESS}.${SBTC_CONTRACT_NAME}`,
          functionName: "flash-loan",
          functionArgs: [
            cvToHex(Cl.uint(BigInt(amountSats))),
            cvToHex(Cl.principal(receiverPrincipal)),
          ],
          postConditionMode: "allow",
        });

        const txId =
          typeof result === "object" && result !== null && "txid" in result
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
    executeSbtcFlashLoan,
    reset,
  };
}
