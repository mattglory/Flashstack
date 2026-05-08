;; FlashStack — Velar sBTC Arbitrage Receiver
;;
;; Borrows canonical sBTC from flashstack-sbtc-core, swaps it for wSTX
;; on the Velar wSTX<>sBTC pool (pool ID 70), then swaps back to sBTC and repays.
;;
;; Pool:     SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-lp-token-v1_0_0-0070
;; Router:   SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
;; wSTX:     SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
;; sBTC:     SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
;;
;; Swap signature:
;;   swap-exact-tokens-for-tokens(id, token0, token1, token-in, token-out,
;;                                share-fee-to, amt-in, amt-out-min)
;;
;; Flow:
;;   1. flashstack-sbtc-core transfers sBTC to this contract
;;   2. Leg 1: swap sBTC -> wSTX (sBTC is token1 in pool 70, wSTX is token0)
;;   3. Leg 2: swap wSTX -> sBTC
;;   4. Repay core: amount + 0.05% fee (min 1 sat)
;;   5. Any surplus sBTC stays here — sweep via sweep-sbtc
;;
;; Note: must be whitelisted in flashstack-sbtc-core before borrowing.
;; min-out is u1 on both legs — repayment invariant is the real safety gate.

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Error Codes
;; =============================================

(define-constant ERR-REPAY-FAILED    (err u600))
(define-constant ERR-SWAP-LEG1       (err u601))
(define-constant ERR-SWAP-LEG2       (err u602))
(define-constant ERR-INSUFFICIENT    (err u603))
(define-constant ERR-NOT-OWNER       (err u604))

;; =============================================
;; State
;; =============================================

(define-data-var owner principal tx-sender)

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    ;; Calculate repayment owed
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
  )
    ;; Leg 1: sBTC -> wSTX
    ;; Pool 70: token0=wSTX, token1=sBTC — swapping token1 for token0
    (unwrap!
      (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
        swap-exact-tokens-for-tokens
        u70                                                                        ;; pool id
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx                         ;; token0
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token                   ;; token1
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token                   ;; token-in (sBTC)
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx                         ;; token-out (wSTX)
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to           ;; share-fee-to
        amount                                                                     ;; amt-in
        u1                                                                         ;; amt-out-min (accept any)
      ))
      ERR-SWAP-LEG1)

    ;; Leg 2: wSTX -> sBTC (use entire wSTX balance)
    (let ((wstx-balance (unwrap!
            (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
              get-balance tx-sender))
            ERR-SWAP-LEG2)))
      (unwrap!
        (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
          swap-exact-tokens-for-tokens
          u70                                                                      ;; pool id
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx                       ;; token0
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token                 ;; token1
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx                       ;; token-in (wSTX)
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token                 ;; token-out (sBTC)
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to         ;; share-fee-to
          wstx-balance                                                             ;; amt-in
          u1                                                                       ;; amt-out-min
        ))
        ERR-SWAP-LEG2)

      ;; Verify sufficient sBTC to repay
      (let ((sbtc-balance (unwrap!
              (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                get-balance tx-sender))
              ERR-REPAY-FAILED)))
        (asserts! (>= sbtc-balance owed) ERR-INSUFFICIENT)

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
;; Owner Functions
;; =============================================

;; Sweep any surplus sBTC profit to owner
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

(define-read-only (get-wstx-balance)
  (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
    get-balance tx-sender))
)

(define-read-only (get-owner)
  (ok (var-get owner))
)
