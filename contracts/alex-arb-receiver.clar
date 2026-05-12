;; FlashStack - ALEX STX/ALEX Arbitrage Receiver
;;
;; Borrows STX from flashstack-stx-core, executes a STX -> ALEX -> STX
;; round-trip on ALEX's AMM pool, repays FlashStack, keeps the spread.
;;
;; Live contracts verified from mainnet transactions 2026-05-12:
;;   ALEX AMM:    SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01
;;   wSTX token:  SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2
;;   ALEX token:  SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
;;   Pool factor: u100000000 (wSTX/ALEX pool)
;;
;; Amount conversion:
;;   ALEX uses 8-decimal fixed-point (ONE_8 = 10^8). STX has 6 decimals.
;;   1 microSTX = 100 wSTX-v2 units. So: dx = amount_microstx * 100.
;;
;; Arb opportunity:
;;   ALEX token accrues protocol revenue. When buy pressure builds before
;;   emissions or governance events, ALEX briefly trades above fair value.
;;   Flash-borrow STX, buy ALEX cheap, sell back for more STX, repay.
;;
;; Note: ALEX AMM has a blocklist check (is-blocklisted-or-default).
;;   New contracts are NOT blocked by default. If a runtime u403 error
;;   occurs, contact ALEX team to confirm the contract is permitted.

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR-NOT-OWNER    (err u500))
(define-constant ERR-SWAP-FAILED  (err u501))
(define-constant ERR-NO-PROFIT    (err u502))
(define-constant ERR-REPAY-FAILED (err u503))

;; ALEX AMM pool v2
(define-constant ALEX-POOL   'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01)
;; wSTX-v2: STX wrapper used as token-x in the ALEX pool
(define-constant WSTX        'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2)
;; ALEX governance token: token-y in the pool
(define-constant ALEX-TOKEN  'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex)
;; Pool factor identifying the wSTX/ALEX pool (confirmed from live swap txs)
(define-constant ALEX-FACTOR u100000000)
;; Conversion: 1 microSTX = 100 wSTX-v2 fixed-point units
(define-constant WSTX-SCALE  u100)

;; =============================================
;; Flash Loan Callback
;; =============================================

;; Called by flashstack-stx-core after sending (amount) microSTX to this contract.
;; Executes STX -> ALEX -> STX round-trip and repays principal + fee.
(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp      (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                    get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee     (/ (* amount fee-bp) u10000))
    (fee         (if (> raw-fee u0) raw-fee u1))
    (total-owed  (+ amount fee))
    ;; Convert microSTX to wSTX-v2 fixed-point for ALEX pool input
    (dx          (* amount WSTX-SCALE))
  )
    ;; Leg 1: wSTX -> ALEX
    ;; Literal principals required for trait args so Clarity can verify impl-trait at compile time.
    ;; as-contract required: STX is held by this contract, not by the external caller.
    (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-x-for-y
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2   ;; token-x: wSTX-v2 (STX wrapper)
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex        ;; token-y: ALEX governance token
      ALEX-FACTOR                                                    ;; pool factor u100000000
      dx                                                             ;; dx in wSTX-v2 fixed-point
      none                                                           ;; min-dy: repay check is the gate
    )) ERR-SWAP-FAILED)

    ;; Read ALEX balance received from leg 1
    (let ((alex-bal (unwrap!
            (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
              get-balance tx-sender))
            ERR-SWAP-FAILED)))
      (asserts! (> alex-bal u0) ERR-SWAP-FAILED)

      ;; Leg 2: ALEX -> wSTX (back to STX)
      ;; Pool pulls ALEX from us and sends wSTX (= STX) back.
      (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-y-for-x
        'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2   ;; token-x: wSTX-v2 (what we receive)
        'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex        ;; token-y: ALEX (what we spend)
        ALEX-FACTOR                                                    ;; pool factor
        alex-bal                                                       ;; dy: all ALEX from leg 1
        none                                                           ;; min-dx: repay check enforces floor
      )) ERR-SWAP-FAILED)

      ;; Verify we received enough STX to cover repayment
      (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
        (asserts! (>= stx-bal total-owed) ERR-REPAY-FAILED)
        ;; Repay FlashStack: principal + fee
        (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)
        (ok true)
      )
    )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-REPAY-FAILED)
    (ok true)
  )
)

(define-public (rescue-alex (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap!
      (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
        transfer amount tx-sender to none))
      ERR-REPAY-FAILED)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

;; Pre-flight profit estimate.
;; This is a rough estimate based only on fee arithmetic -- actual profit
;; depends on the pool price at execution time. Use as a sanity check only.
;; bonus-bp: expected spread capture in basis points (e.g. u100 = 1%)
(define-read-only (simulate (loan-amount uint) (spread-bp uint))
  (let (
    (raw-fee (/ (* loan-amount u5) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (spread  (/ (* loan-amount spread-bp) u10000))
    (profit  (if (> spread fee) (- spread fee) u0))
  )
    {
      loan-amount:  loan-amount,
      spread-bp:    spread-bp,
      spread:       spread,
      flash-fee:    fee,
      net-profit:   profit,
      profitable:   (> spread fee),
      owed-to-core: (+ loan-amount fee),
    }
  )
)

(define-read-only (get-stx-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-read-only (get-alex-balance)
  (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex get-balance tx-sender))
)
