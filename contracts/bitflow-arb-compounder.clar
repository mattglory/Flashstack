;; bitflow-arb-compounder.clar
;; FlashStack Auto-Compounding Arb Receiver
;;
;; Same as bitflow-arb-receiver but profit is automatically deposited
;; back into flashstack-stx-pool after repayment, increasing share value
;; for all LP depositors.
;;
;; Flow:
;;   flash-loan(amount) on flashstack-stx-core
;;     -> STX sent to this contract
;;     -> Leg 1: STX -> stSTX on Bitflow stableswap
;;     -> Leg 2: stSTX -> STX on Bitflow stableswap
;;     -> Repay core (amount + fee)
;;     -> Deposit remaining profit into flashstack-stx-pool
;;     -> Every LP share value increases automatically
;;
;; Live contracts:
;;   Bitflow pool:  SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2
;;   stSTX token:   SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token
;;   LP pool:       SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; Minimal SIP-010 trait for stSTX token calls
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
(define-constant ERR-REPAY-FAILED (err u403))

;; Bitflow STX/stSTX stableswap pool
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)

;; stSTX SIP-010 token
(define-constant STSTX 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)

;; Bitflow LP token (required by pool interface)
(define-constant BITFLOW-LP 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; Slippage tolerance in basis points (100 = 1%)
(define-data-var slippage-bp uint u100)

;; Lifetime stats
(define-data-var total-arbs-executed  uint u0)
(define-data-var total-profit-compounded uint u0)

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    ;; Calculate repayment owed to core
    (fee-bp     (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) ERR-SWAP-FAILED))
    (raw-fee    (/ (* amount fee-bp) u10000))
    (fee        (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))

    ;; Slippage bounds
    (slip       (var-get slippage-bp))
    (min-ststx  (- amount (/ (* amount slip) u10000)))
    (min-stx    total-owed)
  )
    ;; Leg 1: STX -> stSTX
    (unwrap! (contract-call? BITFLOW-POOL swap-x-for-y
      STSTX
      BITFLOW-LP
      amount
      min-ststx
    ) ERR-SWAP-FAILED)

    ;; Read stSTX balance after leg 1
    (let (
      (ststx-balance (unwrap!
        (contract-call? STSTX get-balance (as-contract tx-sender))
        ERR-SWAP-FAILED))
    )
      (asserts! (> ststx-balance u0) ERR-SWAP-FAILED)

      ;; Leg 2: stSTX -> STX
      (unwrap! (contract-call? BITFLOW-POOL swap-y-for-x
        STSTX
        BITFLOW-LP
        ststx-balance
        min-stx
      ) ERR-SWAP-FAILED)

      ;; Verify we have enough to repay
      (let ((stx-now (stx-get-balance (as-contract tx-sender))))
        (asserts! (>= stx-now total-owed) ERR-REPAY-FAILED)

        ;; Repay core
        (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)

        ;; Deposit profit into LP pool (increases share value for all depositors)
        (let ((profit (stx-get-balance (as-contract tx-sender))))
          (if (> profit u0)
            (begin
              (unwrap! (as-contract (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool deposit profit)) ERR-REPAY-FAILED)
              (var-set total-arbs-executed (+ (var-get total-arbs-executed) u1))
              (var-set total-profit-compounded (+ (var-get total-profit-compounded) profit))
              (ok true)
            )
            (begin
              (var-set total-arbs-executed (+ (var-get total-arbs-executed) u1))
              (ok true)
            )
          )
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
    (asserts! (<= new-bp u500) ERR-SWAP-FAILED)
    (ok (var-set slippage-bp new-bp))
  )
)

;; Rescue stuck STX if any edge case leaves dust
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
    total-arbs:      (var-get total-arbs-executed),
    total-compounded: (var-get total-profit-compounded),
    slippage-bp:     (var-get slippage-bp)
  })
)

(define-read-only (get-slippage-bp)
  (ok (var-get slippage-bp))
)
