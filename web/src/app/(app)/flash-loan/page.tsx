"use client";

import { useState } from "react";
import { FlashLoanForm } from "@/components/flash-loan/FlashLoanForm";
import { StxFlashLoanForm } from "@/components/flash-loan/StxFlashLoanForm";

export default function FlashLoanPage() {
  const [tab, setTab] = useState<"stx" | "sbtc">("stx");

  return (
    <div className="max-w-3xl space-y-6">
      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 bg-surface-card border border-surface-border rounded-xl w-fit">
        <button
          onClick={() => setTab("stx")}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "stx"
              ? "bg-brand-600 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          STX Flash Loan
        </button>
        <button
          onClick={() => setTab("sbtc")}
          className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === "sbtc"
              ? "bg-brand-600 text-white"
              : "text-slate-400 hover:text-white"
          }`}
        >
          sBTC Flash Loan
        </button>
      </div>

      {tab === "stx" ? <StxFlashLoanForm /> : <FlashLoanForm />}
    </div>
  );
}
