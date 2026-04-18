"use client";

import { useState, useCallback } from "react";
import { useStacks } from "./useStacks";
import { STX_CONTRACT_ADDRESS, STX_CONTRACT_NAME } from "@/lib/stacks/config";

const BITFLOW_POOL    = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
const BITFLOW_POOL_C  = "stableswap-stx-ststx-v-1-2";
const STSTX_TOKEN     = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token";
const BITFLOW_LP      = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2";
const ARB_RECEIVER    = `${STX_CONTRACT_ADDRESS}.bitflow-arb-receiver`;

export interface ArbQuote {
  stxIn:      number;
  ststxOut:   number;
  stxBack:    number;
  totalOwed:  number;
  profit:     number;
  ratio:      number;
  profitable: boolean;
}

interface ArbState {
  status:  "idle" | "checking" | "ready" | "no-opportunity" | "pending" | "success" | "error";
  quote:   ArbQuote | null;
  txId:    string | null;
  error:   string | null;
}

export function useBitflowArb() {
  const { isWalletConnected } = useStacks();
  const [state, setState] = useState<ArbState>({
    status: "idle", quote: null, txId: null, error: null,
  });

  const checkArb = useCallback(async (stxAmount: number) => {
    setState({ status: "checking", quote: null, txId: null, error: null });

    try {
      const { fetchCallReadOnlyFunction, cvToJSON, Cl } = await import("@stacks/transactions");
      const { STACKS_MAINNET } = await import("@stacks/network");

      const stxMicro = Math.floor(stxAmount * 1e6);
      const fee      = Math.max(1, Math.floor(stxMicro * 5 / 10000));
      const gasCost  = 300_000;
      const totalOwed = stxMicro + fee + gasCost;

      // Leg 1: STX → stSTX
      const dyResult = await fetchCallReadOnlyFunction({
        contractAddress: BITFLOW_POOL,
        contractName:    BITFLOW_POOL_C,
        functionName:    "get-dy",
        functionArgs:    [
          Cl.principal(STSTX_TOKEN),
          Cl.principal(BITFLOW_LP),
          Cl.uint(stxMicro),
        ],
        network:       STACKS_MAINNET,
        senderAddress: STX_CONTRACT_ADDRESS,
      });
      const dyJson   = cvToJSON(dyResult);
      const ststxOut = parseInt(
        dyJson?.value?.value?.dy?.value ?? dyJson?.value?.value ?? dyJson?.value ?? "0"
      );

      if (!ststxOut) throw new Error("Could not fetch pool price");

      // Leg 2: stSTX → STX
      const dxResult = await fetchCallReadOnlyFunction({
        contractAddress: BITFLOW_POOL,
        contractName:    BITFLOW_POOL_C,
        functionName:    "get-dx",
        functionArgs:    [
          Cl.principal(STSTX_TOKEN),
          Cl.principal(BITFLOW_LP),
          Cl.uint(ststxOut),
        ],
        network:       STACKS_MAINNET,
        senderAddress: STX_CONTRACT_ADDRESS,
      });
      const dxJson = cvToJSON(dxResult);
      const stxBack = parseInt(
        dxJson?.value?.value?.dx?.value ?? dxJson?.value?.value ?? dxJson?.value ?? "0"
      );

      const profit    = stxBack - totalOwed;
      const ratio     = ststxOut / stxMicro;
      const profitable = profit > 0;

      const quote: ArbQuote = {
        stxIn:    stxMicro,
        ststxOut,
        stxBack,
        totalOwed,
        profit,
        ratio,
        profitable,
      };

      setState({
        status: profitable ? "ready" : "no-opportunity",
        quote,
        txId:  null,
        error: null,
      });
    } catch (err) {
      setState({
        status: "error",
        quote:  null,
        txId:   null,
        error:  err instanceof Error ? err.message : "Failed to fetch price",
      });
    }
  }, []);

  const executeArb = useCallback(async (stxAmount: number) => {
    if (!isWalletConnected) {
      setState(s => ({ ...s, status: "error", error: "Wallet not connected" }));
      return;
    }
    setState(s => ({ ...s, status: "pending" }));

    try {
      const { request } = await import("@stacks/connect");
      const { Cl, cvToHex } = await import("@stacks/transactions");

      const stxMicro = Math.floor(stxAmount * 1e6);

      const result = await request("stx_callContract", {
        contract:      `${STX_CONTRACT_ADDRESS}.${STX_CONTRACT_NAME}`,
        functionName:  "flash-loan",
        functionArgs:  [
          cvToHex(Cl.uint(stxMicro)),
          cvToHex(Cl.principal(ARB_RECEIVER)),
        ],
        postConditionMode: "allow",
      });

      const txId = typeof result === "object" && result !== null && "txid" in result
        ? String((result as Record<string, unknown>).txid) : null;

      setState(s => ({ ...s, status: "success", txId }));
    } catch (err) {
      setState(s => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Transaction failed",
      }));
    }
  }, [isWalletConnected]);

  const reset = useCallback(() => {
    setState({ status: "idle", quote: null, txId: null, error: null });
  }, []);

  return { ...state, checkArb, executeArb, reset };
}
