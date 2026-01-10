;; Simple Working Receiver - No Profit Demo
(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  ;; Just return the tokens we received (no fee)
  ;; This shows the flash mint mechanism works
  (as-contract (contract-call? .sbtc-token transfer 
    amount
    tx-sender
    .flashstack-core
    none
  ))
)