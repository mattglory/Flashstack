import { CONTRACT_ADDRESS, RECEIVER_CONTRACTS } from "@/lib/stacks/config";

export default function ReceiversPage() {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Receiver Contracts</h1>
        <p className="text-slate-400 text-sm">
          All receivers are deployed on Stacks mainnet at{" "}
          <span className="text-slate-300 font-mono text-xs">{CONTRACT_ADDRESS}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {RECEIVER_CONTRACTS.map((r) => (
          <a
            key={r.name}
            href={`https://explorer.hiro.so/address/${CONTRACT_ADDRESS}.${r.name}`}
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
            <p className="font-mono text-xs text-slate-600 truncate">
              .{r.name}
            </p>
          </a>
        ))}
      </div>

      <div className="bg-surface-card border border-surface-border rounded-xl p-6">
        <h2 className="text-white font-semibold mb-3">Build Your Own Receiver</h2>
        <p className="text-slate-400 text-sm mb-4">
          Implement the <span className="text-slate-300 font-mono">flash-receiver-trait</span> to create a custom strategy.
        </p>
        <pre className="bg-surface rounded-lg border border-surface-border p-4 text-xs text-slate-300 overflow-x-auto">
{`(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee-bp (unwrap! (contract-call? .flashstack-core
                       get-fee-basis-points) (err u999)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (total   (+ amount fee))
  )
    ;; your strategy here
    (as-contract (contract-call? .sbtc-token transfer
      total tx-sender .flashstack-core none))
  )
)`}
        </pre>
      </div>
    </div>
  );
}
