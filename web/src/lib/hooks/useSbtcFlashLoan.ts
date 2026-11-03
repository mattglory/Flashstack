"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { SBTC_CONTRACT_ADDRESS } from "@/lib/stacks/config";
import { txIdFromResult } from "@/lib/utils/txid";

interface SbtcFlashLoanState {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
}

export function useSbtcFlashLoan() {
  const { isWalletConnected, stxAddress, network } = useStacks();
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
      if (!stxAddress) {
        setState({ status: "error", txId: null, error: "Wallet address unavailable" });
        return;
      }

      setState({ status: "pending", txId: null, error: null });

      try {
        const { request } = await import("@stacks/connect");
        const { Cl, cvToHex } = await import("@stacks/transactions");
        const { assertApprovedReceiver, assertTxAllowed, sbtcFlashLoanPostConditions, SBTC_CORE_ID } =
          await import("@/lib/stacks/tx");

        const contract = assertTxAllowed(network, SBTC_CORE_ID);
        const receiverPrincipal = assertApprovedReceiver("sbtc", `${SBTC_CONTRACT_ADDRESS}.${receiverName}`);
        const amount = BigInt(amountSats);

        // Deny mode: every sBTC movement (core -> receiver, receiver -> core)
        // is declared, and the user is bound to send 0 sBTC and 0 STX.
        // See lib/stacks/tx.ts.
        const result = await request("stx_callContract", {
          contract,
          functionName: "flash-loan",
          functionArgs: [
            cvToHex(Cl.uint(amount)),
            cvToHex(Cl.principal(receiverPrincipal)),
          ],
          network,
          postConditions: sbtcFlashLoanPostConditions(stxAddress, amount, receiverPrincipal),
          postConditionMode: "deny",
        });

        const txId = txIdFromResult(result);

        setState({ status: "success", txId, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Transaction failed";
        setState({ status: "error", txId: null, error: message });
      }
    },
    [isWalletConnected, stxAddress, network]
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
