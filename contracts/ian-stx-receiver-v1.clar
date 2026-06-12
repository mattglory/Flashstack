;; ian-stx-receiver-v1.clar
;; Minimal FlashStack STX receiver -- external developer validation

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-constant FLASH-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)
(define-constant ERR-NOT-CORE     (err u403))
(define-constant ERR-REPAY-FAILED (err u500))

(define-public (execute-stx-flash (amount uint) (core principal))
  (begin
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)
    (let (
      (fee-bp     (unwrap! (contract-call? FLASH-CORE get-fee-basis-points) ERR-REPAY-FAILED))
      (raw-fee    (/ (* amount fee-bp) u10000))
      (fee        (if (> raw-fee u0) raw-fee u1))
      (total-owed (+ amount fee))
    )
      (asserts! (>= (stx-get-balance (as-contract tx-sender)) total-owed) ERR-REPAY-FAILED)
      (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)
      (ok true)
    )
  )
)
