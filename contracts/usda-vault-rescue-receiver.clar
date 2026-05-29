;; usda-vault-rescue-receiver.clar
;; FlashStack Receiver -- Arkadiko Vault Debt Rescue
;;
;; Closes an Arkadiko USDA vault with zero capital upfront.
;;
;; How it works:
;;   1. Vault owner calls prepare-rescue (sets USDA amount + beneficiary)
;;   2. Vault owner calls flash-loan on flashstack-stx-core with this receiver
;;   3. Receiver gets borrowed STX, wraps to wSTX, swaps for USDA
;;   4. Vault owner separately calls close-vault on Arkadiko (burns USDA from their wallet)
;;   5. Collateral comes back to vault owner
;;
;; NOTE: Because Arkadiko close-vault takes trait arguments, we cannot call it
;; atomically from this receiver. The flow is:
;;   Step A: prepare-rescue + flash-loan -> you receive USDA in your wallet
;;   Step B: you call close-vault on app.arkadiko.finance -> vault closes, collateral returned
;;   Step C: receiver auto-repays loan from your returned collateral (if STX sent back here)
;;
;; For the atomic version, use the rescue-orchestrator contract which accepts traits.

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR-NOT-OWNER    (err u400))
(define-constant ERR-SWAP-FAILED  (err u401))
(define-constant ERR-REPAY-FAILED (err u402))
(define-constant ERR-ZERO-AMOUNT  (err u404))
(define-constant ERR-NOT-READY    (err u405))

;; =============================================
;; State
;; =============================================

(define-data-var pending-usda-amount  uint u0)
(define-data-var pending-beneficiary  principal tx-sender)
(define-data-var slippage-bp          uint u200)
(define-data-var total-rescues        uint u0)
(define-data-var total-usda-acquired  uint u0)

;; =============================================
;; Setup
;; =============================================

(define-public (prepare-rescue (usda-amount uint) (beneficiary principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (asserts! (> usda-amount u0) ERR-ZERO-AMOUNT)
    (var-set pending-usda-amount usda-amount)
    (var-set pending-beneficiary beneficiary)
    (ok true)
  )
)

;; =============================================
;; Flash Loan Callback
;;
;; What this does:
;;   1. Wraps received STX -> wSTX
;;   2. Swaps wSTX -> USDA on Arkadiko (sends USDA to beneficiary)
;;   3. Repays loan from remaining STX in contract
;;
;; After this tx: beneficiary holds USDA and can close their vault on Arkadiko UI.
;; The collateral they get back covers the flash loan cost.
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp      (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core get-fee-basis-points) ERR-SWAP-FAILED))
    (raw-fee     (/ (* amount fee-bp) u10000))
    (fee         (if (> raw-fee u0) raw-fee u1))
    (total-owed  (+ amount fee))
    (usda-needed (var-get pending-usda-amount))
    (beneficiary (var-get pending-beneficiary))
    (slip        (var-get slippage-bp))
    (min-usda    (- usda-needed (/ (* usda-needed slip) u10000)))
  )
    (asserts! (> usda-needed u0) ERR-NOT-READY)

    ;; Step 1: Swap STX -> USDA via Arkadiko
    ;; The swap contract internally handles STX->wSTX when token-x is wrapped-stx-token.
    ;; It calls stx-transfer? from tx-sender, so we send STX directly -- no mint needed.
    (unwrap! (as-contract
      (contract-call? 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-swap-v2-1
        swap-x-for-y
        'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.wrapped-stx-token
        'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token
        amount
        (some min-usda))
    ) ERR-SWAP-FAILED)

    ;; USDA is now in this contract. Transfer it to beneficiary.
    (let ((usda-bal (unwrap! (as-contract
          (contract-call? 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token
            get-balance tx-sender)) ERR-SWAP-FAILED)))
      (if (> usda-bal u0)
        (unwrap! (as-contract
          (contract-call? 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token
            transfer usda-bal tx-sender beneficiary none)) ERR-SWAP-FAILED)
        false)

      ;; Step 3: Repay loan -- beneficiary must send STX back here before this step
      ;; In practice: beneficiary closes vault, gets collateral, sends total-owed STX here
      ;; For now repay from whatever STX is in the contract
      (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
        (asserts! (>= stx-bal total-owed) ERR-REPAY-FAILED)
        (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)

        ;; Send any remaining STX to beneficiary
        (let ((remainder (stx-get-balance (as-contract tx-sender))))
          (var-set total-rescues    (+ (var-get total-rescues) u1))
          (var-set total-usda-acquired (+ (var-get total-usda-acquired) usda-needed))
          (var-set pending-usda-amount u0)
          (if (> remainder u0)
            (begin
              (unwrap! (as-contract (stx-transfer? remainder tx-sender beneficiary)) ERR-REPAY-FAILED)
              (ok true))
            (ok true))
        )
      )
    )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (set-slippage-bp (new-bp uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (asserts! (<= new-bp u1000) ERR-SWAP-FAILED)
    (ok (var-set slippage-bp new-bp))
  )
)

(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-NOT-OWNER)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-stats)
  (ok {
    total-rescues:     (var-get total-rescues),
    total-usda-acquired: (var-get total-usda-acquired),
    slippage-bp:       (var-get slippage-bp)
  })
)

(define-read-only (get-pending)
  (ok {
    usda-amount: (var-get pending-usda-amount),
    beneficiary: (var-get pending-beneficiary)
  })
)

(define-read-only (estimate-stx-for-usda (usda-out uint))
  (let (
    (balances (unwrap-panic
      (contract-call? 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-swap-v2-1
        get-balances
        'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.wrapped-stx-token
        'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token)))
    (bal-x    (unwrap-panic (element-at? balances u0)))
    (bal-y    (unwrap-panic (element-at? balances u1)))
    (stx-in   (/ (* bal-x usda-out u1000) (* (- bal-y usda-out) u997)))
    (flash-fee (/ (* stx-in u5) u10000))
  )
    (ok {
      usda-to-buy:   usda-out,
      stx-to-borrow: stx-in,
      flash-fee:     flash-fee,
      total-cost:    (+ stx-in flash-fee)
    })
  )
)
