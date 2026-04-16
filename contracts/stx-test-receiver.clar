;; STX Test Receiver
;; Simplest possible flash loan receiver - borrows STX and repays immediately.
;; Use this to verify flashstack-stx-core is working before deploying arb strategies.

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-constant ERR-REPAY (err u500))

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) ERR-REPAY))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
  )
    ;; Repay principal + fee to core
    (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY)
    (ok true)
  )
)
