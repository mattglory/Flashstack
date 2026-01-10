;; error code
(define-constant ERR-FEE-FETCH-FAILED (err u200))

;; Dynamic Test Receiver - Queries protocol for current fee
(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    ;; Query the protocol for current fee rate
    (fee-bp (unwrap! (contract-call? .flashstack-core get-fee-basis-points) ERR-FEE-FETCH-FAILED))
    (fee (/ (* amount fee-bp) u10000))
    (total-owed (+ amount fee))
  )
    ;; Transfer the borrowed amount + fee back to flashstack-core
    ;; Use as-contract because the tokens are in this contract's balance
    (as-contract (contract-call? .sbtc-token transfer 
      total-owed 
      tx-sender 
      .flashstack-core 
      none))
  )
)
