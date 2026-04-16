;; Bitflow Arbitrage Receiver
;; Borrows STX from flashstack-stx-core, executes STX/stSTX round-trip
;; on Bitflow stableswap, repays with profit.
;;
;; Live contracts used:
;;   Bitflow pool:  SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2
;;   stSTX token:   SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token
;;
;; Why this works:
;;   stSTX accumulates staking yield. When yield accrues, stSTX briefly
;;   trades above 1 STX on Bitflow before arbitrageurs equalise it.
;;   This receiver captures that spread atomically in one flash loan tx.
;;
;; Bitflow swap-x-for-y: STX (x) -> stSTX (y)
;; Bitflow swap-y-for-x: stSTX (y) -> STX (x)

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; Minimal SIP-010 trait for calling stSTX token
(define-trait sip-010-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)

;; =============================================
;; Constants
;; =============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR-NOT-OWNER    (err u400))
(define-constant ERR-SWAP-FAILED  (err u401))
(define-constant ERR-NO-PROFIT    (err u402))
(define-constant ERR-REPAY-FAILED (err u403))

;; Bitflow STX/stSTX stableswap pool
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)

;; stSTX SIP-010 token (y-token in the pool)
(define-constant STSTX 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)

;; Bitflow STX/stSTX LP token (lp-token parameter)
(define-constant BITFLOW-LP 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; Slippage tolerance in basis points (default 100 = 1%)
(define-data-var slippage-bp uint u100)

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    ;; Calculate repayment
    (fee-bp    (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) ERR-SWAP-FAILED))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))

    ;; Min stSTX out from leg 1 (amount minus slippage)
    (slip      (var-get slippage-bp))
    (min-ststx (- amount (/ (* amount slip) u10000)))

    ;; Min STX back from leg 2 (must cover total-owed)
    (min-stx   total-owed)
  )
    ;; Leg 1: STX -> stSTX on Bitflow
    (unwrap! (contract-call? BITFLOW-POOL swap-x-for-y
      STSTX        ;; y-token (stSTX SIP-010)
      BITFLOW-LP   ;; lp-token (LP token for this pool)
      amount       ;; STX amount in microstacks
      min-ststx    ;; minimum stSTX to receive
    ) ERR-SWAP-FAILED)

    ;; Get how much stSTX we received
    (let (
      (ststx-balance (unwrap!
        (contract-call? STSTX get-balance (as-contract tx-sender))
        ERR-SWAP-FAILED))
    )
      (asserts! (> ststx-balance u0) ERR-SWAP-FAILED)

      ;; Leg 2: stSTX -> STX on Bitflow
      (unwrap! (contract-call? BITFLOW-POOL swap-y-for-x
        STSTX        ;; y-token (stSTX SIP-010)
        BITFLOW-LP   ;; lp-token (LP token for this pool)
        ststx-balance ;; all stSTX we hold
        min-stx      ;; minimum STX back (must cover repayment)
      ) ERR-SWAP-FAILED)

      ;; Repay STX + fee back to flashstack-stx-core
      (let ((stx-now (stx-get-balance (as-contract tx-sender))))
        (asserts! (>= stx-now total-owed) ERR-REPAY-FAILED)
        (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)
        (ok true)
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
    (asserts! (<= new-bp u500) ERR-SWAP-FAILED) ;; max 5% slippage
    (ok (var-set slippage-bp new-bp))
  )
)

;; Rescue stuck STX (admin only)
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

(define-read-only (get-slippage-bp)
  (ok (var-get slippage-bp))
)

(define-read-only (estimate-profit (amount uint))
  (let (
    (fee-bp    (unwrap-panic (contract-call? .flashstack-stx-core get-fee-basis-points)))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (slip      (var-get slippage-bp))
    (min-ststx (- amount (/ (* amount slip) u10000)))
  )
    (ok {
      loan-amount:   amount,
      fee-to-pay:    fee,
      total-owed:    (+ amount fee),
      min-ststx-leg1: min-ststx,
      note: "Profit = STX received from leg2 - total-owed. Positive when stSTX trades above peg."
    })
  )
)
