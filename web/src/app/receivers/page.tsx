import { CONTRACT_ADDRESS, RECEIVER_CONTRACTS, STX_CONTRACT_ADDRESS, STX_RECEIVER_CONTRACTS, STX_CONTRACT_NAME } from "@/lib/stacks/config";

export default function ReceiversPage() {
  return (
    <div className="max-w-5xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Receiver Contracts</h1>
        <p className="text-slate-400 text-sm">
          All receivers are deployed on Stacks mainnet and verified on-chain.
        </p>
      </div>

      {/* STX Flash Loan Receivers */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-white font-semibold">STX Flash Loans</h2>
          <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Live</span>
        </div>
        <p className="text-slate-500 text-xs mb-4 font-mono">
          Core: {STX_CONTRACT_ADDRESS}.{STX_CONTRACT_NAME}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          {STX_RECEIVER_CONTRACTS.map((r) => (
            <a
              key={r.name}
              href={`https://explorer.hiro.so/address/${r.address}.${r.name}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-surface-card border border-surface-border rounded-xl p-5 hover:border-brand-500/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-white font-medium text-sm group-hover:text-brand-400 transition-colors">
                  {r.label}
                </span>
                <svg className="w-3.5 h-3.5 text-slate-500 group-hover:text-brand-400 transition-colors mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
              <p className="text-slate-400 text-xs mb-3">{r.description}</p>
              <p className="font-mono text-xs text-slate-600 truncate">.{r.name}</p>
            </a>
          ))}
        </div>
      </div>

      {/* sBTC Flash Loan Receivers */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-white font-semibold">sBTC Flash Loans</h2>
          <span className="text-xs bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2 py-0.5 rounded-full">Mainnet</span>
        </div>
        <p className="text-slate-500 text-xs mb-4 font-mono">
          Core: {CONTRACT_ADDRESS}.flashstack-core
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {RECEIVER_CONTRACTS.map((r) => (
            <a
              key={r.name}
              href={`https://explorer.hiro.so/address/${r.address}.${r.name}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-surface-card border border-surface-border rounded-xl p-5 hover:border-brand-500/50 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-white font-medium text-sm group-hover:text-brand-400 transition-colors">
                  {r.label}
                </span>
                <svg className="w-3.5 h-3.5 text-slate-500 group-hover:text-brand-400 transition-colors mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </div>
              <p className="text-slate-400 text-xs mb-3">{r.description}</p>
              <p className="font-mono text-xs text-slate-600 truncate">.{r.name}</p>
            </a>
          ))}
        </div>
      </div>

      {/* Build Your Own */}
      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <h2 className="text-white font-semibold mb-1">Build Your Own Receiver</h2>
        <p className="text-slate-400 text-sm mb-4">
          Implement <span className="text-slate-300 font-mono">stx-flash-receiver-trait</span> for STX loans.
          Borrow capital, run your strategy, repay in one atomic transaction.
          Zero collateral required — you only pay the Stacks tx fee (~$0.002).
          If your strategy does not profit enough to repay, the entire transaction reverts at no cost to you.
        </p>
        <pre className="bg-surface rounded-lg border border-surface-border p-4 text-xs text-slate-300 overflow-x-auto">
{`;; STX flash loan receiver template
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp    (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) (err u999)))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
  )
    ;; === YOUR STRATEGY HERE ===
    ;; Example: swap STX -> stSTX on Bitflow when stSTX > 1 STX peg
    ;; swap back -> net more STX than you borrowed -> repay -> keep profit

    ;; Repay principal + fee
    (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) (err u500))
    (ok true)
  )
)`}
        </pre>
      </div>
    </div>
  );
}
