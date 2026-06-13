;; stx-receiver-template.clar
;; FlashStack minimal STX flash loan receiver -- external developer template
;;
;; What this does:
;;   1. FlashStack core sends you the loan (STX arrives in this contract)
;;   2. Core calls execute-stx-flash below
;;   3. This template simply repays the loan + fee (a real strategy would
;;      do something profitable with the money first)
;;   4. If repayment fails, the WHOLE transaction reverts -- no one loses funds
;;
;; Before deploying: nothing to edit. The contract works as-is.
;; The wallet that deploys it becomes the owner and can withdraw any STX
;; left in the contract with (withdraw amount).

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; FlashStack core contract -- the only principal allowed to trigger the callback
(define-constant FLASH-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

;; The wallet that deploys this contract
(define-constant OWNER tx-sender)

(define-constant ERR-NOT-CORE     (err u403))
(define-constant ERR-NOT-OWNER    (err u401))
(define-constant ERR-REPAY-FAILED (err u500))

;; Called by FlashStack core during the flash loan.
;; amount = the STX you were lent (already in this contract when this runs)
(define-public (execute-stx-flash (amount uint) (core principal))
  (begin
    ;; Only the real FlashStack core may call this
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)
    (let (
      (fee-bp     (unwrap! (contract-call? FLASH-CORE get-fee-basis-points) ERR-REPAY-FAILED))
      (raw-fee    (/ (* amount fee-bp) u10000))
      (fee        (if (> raw-fee u0) raw-fee u1))
      (total-owed (+ amount fee))
    )
      ;; >>> Your strategy would go here: arbitrage, liquidation, swaps... <<<
      ;; This template does nothing and just pays the loan back.

      (asserts! (>= (stx-get-balance (as-contract tx-sender)) total-owed) ERR-REPAY-FAILED)
      (unwrap! (as-contract (stx-transfer? total-owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)
      (ok true)
    )
  )
)

;; Withdraw leftover STX (e.g. the small amount you seeded for fees)
(define-public (withdraw (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (as-contract (stx-transfer? amount tx-sender OWNER))
  )
)

(define-read-only (get-balance)
  (stx-get-balance (as-contract tx-sender))
)
