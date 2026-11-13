"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { STX_CONTRACT_ADDRESS } from "@/lib/stacks/config";
import { txIdFromResult } from "@/lib/utils/txid";

interface StxFlashLoanState {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
}

export function useStxFlashLoan() {
  const { isWalletConnected, stxAddress, network } = useStacks();
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
      if (!stxAddress) {
        setState({ status: "error", txId: null, error: "Wallet address unavailable" });
        return;
      }

      setState({ status: "pending", txId: null, error: null });

      try {
        const { request } = await import("@stacks/connect");
        const { Cl, cvToHex } = await import("@stacks/transactions");
        const { assertApprovedReceiver, assertTxAllowed, stxFlashLoanPostConditions, STX_CORE_ID } =
          await import("@/lib/stacks/tx");

        const contract = assertTxAllowed(network, STX_CORE_ID);
        const receiverPrincipal = assertApprovedReceiver("stx", `${STX_CONTRACT_ADDRESS}.${receiverName}`);
        const amount = BigInt(amountMicroStx);

        // Deny mode: every movement (core -> receiver, receiver -> core) is
        // declared, and the user is bound to send 0 STX. See lib/stacks/tx.ts.
        const result = await request("stx_callContract", {
          contract,
          functionName: "flash-loan",
          functionArgs: [
            cvToHex(Cl.uint(amount)),
            cvToHex(Cl.principal(receiverPrincipal)),
          ],
          network,
          postConditions: stxFlashLoanPostConditions(stxAddress, amount, receiverPrincipal),
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
    executeStxFlashLoan,
    reset,
  };
}
