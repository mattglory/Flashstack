;; sBTC Test Receiver
;; Simplest possible flash loan receiver - borrows canonical sBTC and repays it.
;; Used to prove the flashstack-sbtc-core flow end-to-end.
;;
;; Flow: core sends sBTC -> this contract receives -> repays amount + fee -> core verifies

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-constant ERR-NOT-ENOUGH-BALANCE (err u500))
(define-constant ERR-REPAY-FAILED       (err u501))

;; Called by flashstack-sbtc-core with the borrowed sBTC already in this contract.
;; We simply repay: amount + fee.
(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    ;; Calculate fee: 0.05% of amount, minimum 1 sat
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    ;; Check we have enough sBTC (loan amount + pre-funded fee buffer)
    (balance (unwrap! (as-contract (contract-call? SBTC get-balance tx-sender)) ERR-REPAY-FAILED))
  )
    (asserts! (>= balance owed) ERR-NOT-ENOUGH-BALANCE)
    ;; Repay sBTC to core
    (unwrap! (as-contract (contract-call? SBTC transfer owed tx-sender core none)) ERR-REPAY-FAILED)
    (ok true)
  )
)
