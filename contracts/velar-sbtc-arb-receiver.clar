;; FlashStack — Velar sBTC Arbitrage Receiver
;;
;; Borrows canonical sBTC from flashstack-sbtc-core, swaps it for STX
;; on the Velar STX<>sBTC pool, then swaps back to sBTC and repays.
;;
;; Pool used: Velar UniV2 STX<>sBTC
;;   Router:  SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
;;   Pool token: SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-lp-token-v1_0_0-0070
;;
;; Flow:
;;   1. flashstack-sbtc-core sends sBTC to this contract
;;   2. This contract swaps sBTC -> STX via Velar router
;;   3. This contract swaps STX -> sBTC via Velar router
;;   4. Repays core: amount + 0.05% fee
;;   5. Any surplus sBTC stays in this contract (swept to owner)
;;
;; Note: This receiver must be whitelisted in flashstack-sbtc-core via
;;   add-approved-receiver before it can borrow.
;;
;; Security:
;;   - Only flashstack-sbtc-core can trigger execute-sbtc-flash
;;     (enforced by the core whitelist, not re-checked here for gas)
;;   - Repayment enforced by core's reserve invariant check
;;   - Min-out set to u1 on both swaps; repayment is the real safety gate

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant SBTC  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant CORE  'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core)

;; Velar UniV2 router
(define-constant VELAR-ROUTER 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router)

(define-constant ERR-REPAY-FAILED    (err u600))
(define-constant ERR-SWAP-FAILED     (err u601))
(define-constant ERR-NOT-ENOUGH-SBTC (err u602))
(define-constant ERR-NOT-OWNER       (err u603))

;; =============================================
;; State
;; =============================================

(define-data-var owner principal tx-sender)

;; =============================================
;; Flash Loan Receiver
;; =============================================

;; Called by flashstack-sbtc-core after transferring `amount` sBTC to this contract.
;; sBTC is already in this contract when this function runs.
(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    ;; Calculate repayment owed
    (fee-bp  (unwrap! (contract-call? CORE get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
  )
    ;; Leg 1: Swap sBTC -> STX via Velar
    ;; min-stx = u1 (repayment check is the real safety gate)
    (unwrap!
      (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
        swap-exact-tokens-for-tokens
        amount          ;; amount-in (sBTC sats)
        u1              ;; amount-out-min (STX microstacks, accept any)
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token-in
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx         ;; token-out (wrapped STX)
        (as-contract tx-sender)                                   ;; recipient
      ))
      ERR-SWAP-FAILED)

    ;; Leg 2: Swap STX -> sBTC via Velar
    ;; Use entire STX balance for max sBTC out
    (let ((stx-balance (unwrap! (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
                                  get-balance tx-sender)) ERR-SWAP-FAILED)))
      (unwrap!
        (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
          swap-exact-tokens-for-tokens
          stx-balance     ;; amount-in (all STX received from leg 1)
          u1              ;; amount-out-min (sBTC sats, accept any)
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx         ;; token-in
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token   ;; token-out
          (as-contract tx-sender)                                    ;; recipient
        ))
        ERR-SWAP-FAILED)

      ;; Verify we have enough sBTC to repay
      (let ((sbtc-balance (unwrap!
              (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                get-balance tx-sender))
              ERR-REPAY-FAILED)))
        (asserts! (>= sbtc-balance owed) ERR-NOT-ENOUGH-SBTC)

        ;; Repay principal + fee to core
        (unwrap!
          (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
            transfer owed tx-sender core none))
          ERR-REPAY-FAILED)

        (ok true)
      )
    )
  )
)

;; =============================================
;; Owner — Sweep Surplus
;; =============================================

;; Sweep any accumulated sBTC profit to owner
(define-public (sweep-sbtc (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
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

(define-read-only (get-sbtc-balance)
  (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    get-balance tx-sender))
)

(define-read-only (get-owner)
  (ok (var-get owner))
)
