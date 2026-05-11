;; FlashStack - Zest Flash Liquidation Receiver (STX + sBTC)
;;
;; Executes zero-capital liquidations on Zest Protocol using FlashStack flash loans.
;; Supports both STX and canonical sBTC flash loans depending on the debt asset.
;;
;; Two entry points:
;;   execute-stx-flash  - called by flashstack-stx-core  (STX debt positions)
;;   execute-sbtc-flash - called by flashstack-sbtc-core (sBTC debt positions)
;;
;; Flow (same for both):
;;   1. FlashStack core transfers asset to this contract
;;   2. This contract calls Zest's liquidation-call with borrowed funds
;;   3. Zest sends collateral bonus to this contract
;;   4. Repay FlashStack core: principal + 0.05% fee
;;   5. Surplus profit stays here - sweep via sweep-stx / sweep-sbtc
;;
;; Liquidation economics:
;;   Profit = liquidation_bonus - flash_loan_fee
;;   e.g. 5% bonus on 1000 STX loan = 50 STX bonus - 0.5 STX fee = 49.5 STX profit
;;
;; Integration note:
;;   Zest function signatures marked as TODO pending confirmation from Zest team.
;;
;; Must be whitelisted in both flashstack-stx-core and flashstack-sbtc-core before use.

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core.stx-flash-receiver-trait)
(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

;; TODO: Confirm Zest pool address with Zest team
(define-constant ZEST-POOL  'SP2ZNGJ85ENDY6QRHQ5P2D4FXKGZWCKTB2T0Z55KS.pool-borrow-v2-0)
(define-constant SBTC       'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant STX-CORE   'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)
(define-constant SBTC-CORE  'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core)

(define-constant ERR-NOT-OWNER    (err u800))
(define-constant ERR-REPAY-FAILED (err u801))
(define-constant ERR-LIQUIDATION  (err u802))
(define-constant ERR-INSUFFICIENT (err u803))
(define-constant ERR-ZERO-AMOUNT  (err u804))

;; =============================================
;; State
;; =============================================

(define-data-var owner principal tx-sender)

;; =============================================
;; STX Flash Loan Callback
;; Use when: borrower has STX-denominated debt on Zest
;; Flash borrows from: flashstack-stx-core
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
  )
    ;; ── Step 1: Liquidate the Zest position using borrowed STX ──────────────
    ;; TODO: Replace with confirmed Zest liquidation-call signature.
    ;; Typical pattern (AAVE-style):
    ;;   (as-contract (contract-call? ZEST-POOL liquidation-call
    ;;     collateral-asset   ;; e.g. 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    ;;     debt-asset         ;; STX (native)
    ;;     borrower           ;; principal being liquidated
    ;;     amount             ;; debt amount to repay
    ;;     true               ;; receive underlying collateral (not aToken)
    ;;   ))

    ;; ── Step 2: Verify we received enough to repay ───────────────────────────
    (let ((stx-balance (stx-get-balance (as-contract tx-sender))))
      (asserts! (>= stx-balance owed) ERR-INSUFFICIENT)

      ;; ── Step 3: Repay STX flash loan (principal + fee) ───────────────────
      (unwrap!
        (as-contract (stx-transfer? owed tx-sender core))
        ERR-REPAY-FAILED)

      (ok true)
    )
  )
)

;; =============================================
;; sBTC Flash Loan Callback
;; Use when: borrower has sBTC-denominated debt on Zest
;; Flash borrows from: flashstack-sbtc-core
;; =============================================

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
  )
    ;; ── Step 1: Liquidate the Zest position using borrowed sBTC ─────────────
    ;; TODO: Replace with confirmed Zest liquidation-call signature.
    ;; Typical pattern:
    ;;   (as-contract (contract-call? ZEST-POOL liquidation-call
    ;;     collateral-asset   ;; e.g. STX or xBTC
    ;;     debt-asset         ;; 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    ;;     borrower           ;; principal being liquidated
    ;;     amount             ;; sBTC debt amount to repay (sats)
    ;;     true               ;; receive underlying collateral
    ;;   ))

    ;; ── Step 2: Verify sufficient sBTC to repay ──────────────────────────────
    (let ((sbtc-balance (unwrap!
            (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              get-balance tx-sender))
            ERR-REPAY-FAILED)))
      (asserts! (>= sbtc-balance owed) ERR-INSUFFICIENT)

      ;; ── Step 3: Repay sBTC flash loan (principal + fee) ──────────────────
      (unwrap!
        (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
          transfer owed tx-sender core none))
        ERR-REPAY-FAILED)

      (ok true)
    )
  )
)

;; =============================================
;; Owner Functions
;; =============================================

(define-public (sweep-stx (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (unwrap!
      (as-contract (stx-transfer? amount tx-sender (var-get owner)))
      ERR-REPAY-FAILED)
    (ok true)
  )
)

(define-public (sweep-sbtc (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (unwrap!
      (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer amount tx-sender (var-get owner) none))
      ERR-REPAY-FAILED)
    (ok true)
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (ok (var-set owner new-owner))
  )
)

;; =============================================
;; Read-only
;; =============================================

;; Pre-flight profitability check before executing a liquidation.
;; debt-amount : amount to repay (microSTX or sats)
;; bonus-bp    : Zest liquidation bonus in basis points (e.g. u500 = 5%)
(define-read-only (simulate (debt-amount uint) (bonus-bp uint))
  (let (
    (raw-fee (/ (* debt-amount u5) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (bonus   (/ (* debt-amount bonus-bp) u10000))
    (profit  (if (> bonus fee) (- bonus fee) u0))
  )
    {
      debt-amount:  debt-amount,
      bonus-bp:     bonus-bp,
      bonus:        bonus,
      flash-fee:    fee,
      net-profit:   profit,
      profitable:   (> bonus fee),
      owed-to-core: (+ debt-amount fee),
    }
  )
)

(define-read-only (get-stx-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-read-only (get-sbtc-balance)
  (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    get-balance tx-sender))
)

(define-read-only (get-owner)
  (ok (var-get owner))
)
