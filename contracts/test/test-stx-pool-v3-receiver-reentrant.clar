;; TEST-ONLY receiver for flashstack-stx-pool-v3's F-9 fix (native STX). One contract, five
;; callback behaviours selected by set-mode, so the regression suite can drive
;; every lock path through the same approved receiver:
;;   u0  honest: repay amount + fee by plain transfer
;;   u1  F-9 vector: "repay" by calling the pool's own deposit (amount + fee)
;;   u2  reenter withdraw on shares seeded earlier by seed-deposit, then repay
;;   u3  under-repay: return ok without repaying (ERR-REPAY-FAILED path)
;;   u4  reenter flash-loan itself (via the honest test-pool-receiver-good,
;;       since a contract cannot pass itself as a trait), then repay. The VM
;;       aborts this with CircularReference before the pool's lock is reached.
;; Pool calls are wrapped in as-contract so they are funded by, and credited
;; to, this contract (see test-pool-v2-receiver-deposit-reentrant.clar), and
;; use try! so a blocked reentry surfaces the pool's own ERR-REENTRANT.
(impl-trait .stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-data-var mode uint u0)
(define-data-var seeded-shares uint u0)

(define-public (set-mode (m uint))
  (ok (var-set mode m))
)

(define-public (seed-deposit (amount uint))
  (let ((s (try! (as-contract (contract-call? .flashstack-stx-pool-v3 deposit amount)))))
    (ok (var-set seeded-shares s))
  )
)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? .flashstack-stx-pool-v3 get-fee-basis-points) (err u901)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (m       (var-get mode))
  )
    (if (is-eq m u1)
      (try! (as-contract (contract-call? .flashstack-stx-pool-v3 deposit (+ amount fee))))
      u0)
    (if (is-eq m u2)
      (try! (as-contract (contract-call? .flashstack-stx-pool-v3 withdraw (var-get seeded-shares))))
      u0)
    (if (is-eq m u4)
      (try! (contract-call? .flashstack-stx-pool-v3 flash-loan u1000 .test-pool-receiver-good))
      false)
    (if (or (is-eq m u0) (is-eq m u2) (is-eq m u4))
      (try! (as-contract (stx-transfer? (+ amount fee) tx-sender core)))
      false)
    (ok true)
  )
)
