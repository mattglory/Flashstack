;; alex-arb-receiver-v3.clar
;; FlashStack - ALEX STX/ALEX Arbitrage Receiver
;;
;; v3 changes vs v2 (Nova audit fixes):
;;   [H-1] execute-stx-flash now asserts contract-caller == FLASH-CORE
;;   [H-2] Repayment hardcoded to FLASH-CORE constant - ignores core parameter
;;   [H-3] Minimum profit guard using ERR-NO-PROFIT (was defined but unused)
;;   [H-4] Slippage guards on both swap legs via min-alex-out / total-owed floor
;;   [M-1] simulate accepts fee-bp parameter - no longer hardcodes u5
;;   [L-1] ERR-TRANSFER-FAILED added for rescue functions
;;   [L-2] Two-step ownership transfer (data-var + pending-owner)
;;   [I-1] Dead constants removed (ALEX-POOL, WSTX, ERR-NO-PROFIT now used)
;;
;; Flow:
;;   1. Owner calls set-min-alex-out(expected ALEX from Leg 1 * slippage tolerance)
;;   2. Owner calls set-min-profit(minimum acceptable STX profit after fees)
;;   3. Call flashstack-stx-core.flash-loan(amount, this-contract)
;;   4. Core calls execute-stx-flash (only core can call this)
;;   5. Leg 1: STX -> ALEX on ALEX AMM (slippage guarded)
;;   6. Leg 2: ALEX -> STX on ALEX AMM (floor = total-owed + min-profit)
;;   7. Assert profit >= min-profit, repay to hardcoded FLASH-CORE
;;   8. Profit stays in contract, owner sweeps with rescue-stx

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant BASIS-POINTS u10000)
(define-constant WSTX-SCALE   u100)    ;; 1 microSTX = 100 wSTX-v2 units
(define-constant ALEX-FACTOR  u100000000)

;; Hardcoded flash core -- repayment never goes to caller-supplied address
(define-constant FLASH-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

;; ALEX AMM pool v2 (confirmed from mainnet swap transactions)
(define-constant ALEX-AMM    'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01)
(define-constant WSTX-V2     'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2)
(define-constant ALEX-TOKEN  'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex)

;; Error codes
(define-constant ERR-NOT-OWNER       (err u500))
(define-constant ERR-SWAP-FAILED     (err u501))
(define-constant ERR-NO-PROFIT       (err u502))
(define-constant ERR-REPAY-FAILED    (err u503))
(define-constant ERR-TRANSFER-FAILED (err u504))
(define-constant ERR-NOT-CORE        (err u505))
(define-constant ERR-NOT-PENDING     (err u506))

;; =============================================
;; State
;; =============================================

(define-data-var contract-owner  principal tx-sender)
(define-data-var pending-owner   (optional principal) none)

;; Pre-set before each flash loan call (off-chain: simulate the swap, apply slippage)
;; min-alex-out: minimum ALEX to accept from Leg 1 (slippage guard)
;; min-profit:   minimum STX profit to accept after repayment (anti-griefing)
(define-data-var min-alex-out    uint u0)
(define-data-var min-profit      uint u1) ;; default: 1 microSTX

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp     (unwrap! (contract-call? FLASH-CORE get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee    (/ (* amount fee-bp) BASIS-POINTS))
    (fee        (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
    (dx         (* amount WSTX-SCALE))
    (min-alex   (var-get min-alex-out))
    (profit-floor (var-get min-profit))
  )
    ;; [H-1] Only FLASH-CORE may invoke this callback
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)

    ;; Leg 1: wSTX -> ALEX (slippage guarded by min-alex-out)
    (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-x-for-y
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
      ALEX-FACTOR
      dx
      (if (> min-alex u0) (some min-alex) none)
    )) ERR-SWAP-FAILED)

    (let ((alex-bal (unwrap!
            (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
              get-balance tx-sender))
            ERR-SWAP-FAILED)))
      (asserts! (> alex-bal u0) ERR-SWAP-FAILED)

      ;; Leg 2: ALEX -> wSTX (floor = need enough to cover loan + fee + min-profit)
      (let ((min-stx-back (* (+ total-owed profit-floor) WSTX-SCALE)))
        (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-y-for-x
          'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2
          'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
          ALEX-FACTOR
          alex-bal
          (some min-stx-back)
        )) ERR-SWAP-FAILED)

        (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
          ;; [H-3] Minimum profit guard -- reverts if trade was not profitable enough
          (asserts! (>= stx-bal (+ total-owed profit-floor)) ERR-NO-PROFIT)

          ;; [H-2] Repay to hardcoded FLASH-CORE -- never to caller-supplied core
          (unwrap! (as-contract (stx-transfer? total-owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)

          ;; Profit remains in contract -- owner sweeps with rescue-stx
          (ok true)
        )
      )
    )
  )
)

;; =============================================
;; Pre-flight Setup (call before each flash loan)
;; =============================================

;; Set minimum acceptable ALEX from Leg 1.
;; Compute off-chain: simulate swap, apply slippage (e.g. 99% of expected output).
(define-public (set-min-alex-out (min-out uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (ok (var-set min-alex-out min-out))
  )
)

;; Set minimum acceptable STX profit after repayment.
;; Prevents griefing and loss-making executions.
(define-public (set-min-profit (min-stx uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (ok (var-set min-profit min-stx))
  )
)

;; =============================================
;; Admin
;; =============================================

;; [L-2] Two-step ownership transfer
(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (ok (var-set pending-owner (some new-owner)))
  )
)

(define-public (accept-ownership)
  (let ((pending (unwrap! (var-get pending-owner) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender pending) ERR-NOT-PENDING)
    (var-set contract-owner pending)
    (var-set pending-owner none)
    (ok true)
  )
)

;; [L-1] Rescue with dedicated error code
(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-TRANSFER-FAILED)
    (ok true)
  )
)

(define-public (rescue-alex (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (unwrap!
      (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
        transfer amount tx-sender to none))
      ERR-TRANSFER-FAILED)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

;; [M-1] simulate now accepts fee-bp as parameter -- no stale hardcoded value
(define-read-only (simulate (loan-amount uint) (spread-bp uint) (fee-bp uint))
  (let (
    (raw-fee (/ (* loan-amount fee-bp) BASIS-POINTS))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (spread  (/ (* loan-amount spread-bp) BASIS-POINTS))
    (profit  (if (> spread fee) (- spread fee) u0))
  )
    {
      loan-amount:  loan-amount,
      spread-bp:    spread-bp,
      fee-bp:       fee-bp,
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

(define-read-only (get-settings)
  (ok {
    contract-owner: (var-get contract-owner),
    pending-owner:  (var-get pending-owner),
    min-alex-out:   (var-get min-alex-out),
    min-profit:     (var-get min-profit),
  })
)
