;; alex-arb-receiver-v5.clar
;; FlashStack - ALEX STX/ALEX Arbitrage Receiver
;;
;; v5 changes vs v4 (Nova audit fixes):
;;   [H-1] min-alex-out reset to u0 after each execution -- prevents stale slippage reuse
;;   [M-1] Leg 2 uses (get dy swap-result) from Leg 1 return value, not get-balance
;;         Prevents any residual ALEX in the contract from polluting Leg 2
;;   [M-2] max-fee-bp data-var: execute-stx-flash reverts if live fee exceeds owner-set max
;;   [L-1] print events added to set-min-alex-out and set-min-profit
;;   [L-2] rescue functions validate amount > u0
;;
;; v4 changes vs v3 (Nova audit fixes):
;;   [H-1] min-alex-out == 0 guard: execute-stx-flash reverts if slippage not pre-set
;;   [H-2] Minimum loan amount guard: (>= amount u1000000) prevents rounding edge cases
;;   [M-1] Defense-in-depth: core parameter asserted == FLASH-CORE
;;   [M-2] print events on execute-stx-flash, ownership transfers, rescue functions
;;   [L-1] WSTX-SCALE and ALEX-FACTOR derivation documented
;;   [L-2] simulate limitations documented
;;
;; Flow:
;;   1. Owner calls set-max-fee-bp (maximum acceptable flash fee, set once)
;;   2. Owner calls set-min-alex-out (simulate Leg 1, apply slippage tolerance)
;;   3. Owner calls set-min-profit (minimum acceptable STX profit after fees)
;;   4. Call flashstack-stx-core.flash-loan(amount, this-contract)
;;   5. Core calls execute-stx-flash (only core can call this)
;;   6. Leg 1: STX -> ALEX on ALEX AMM (slippage guarded, exact dy captured)
;;   7. Leg 2: ALEX -> STX on ALEX AMM (only dy from Leg 1, floor = total-owed + min-profit)
;;   8. Assert fee <= max-fee-bp, assert profit >= min-profit
;;   9. Repay to hardcoded FLASH-CORE, reset min-alex-out to u0
;;  10. Profit stays in contract, owner sweeps with rescue-stx

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant BASIS-POINTS u10000)

;; WSTX-SCALE: 1 microSTX = 100 wSTX-v2 fixed-point units.
;; Derived from ALEX AMM v2 token-wstx-v2 (8 decimals vs STX 6 decimals).
;; Verified from mainnet swap transactions on amm-pool-v2-01.
(define-constant WSTX-SCALE   u100)

;; ALEX-FACTOR: pool factor passed to amm-pool-v2-01 swap functions.
;; Value u100000000 = 1e8, confirmed from ALEX AMM v2 source and mainnet swap txs.
(define-constant ALEX-FACTOR  u100000000)

;; Minimum loan size to avoid integer rounding edge cases with fee floor.
;; u1000000 = 1 STX.
(define-constant MIN-LOAN-AMOUNT u1000000)

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
(define-constant ERR-MIN-ALEX-UNSET  (err u507))
(define-constant ERR-LOAN-TOO-SMALL  (err u508))
(define-constant ERR-FEE-TOO-HIGH    (err u509))
(define-constant ERR-ZERO-AMOUNT     (err u510))

;; =============================================
;; State
;; =============================================

(define-data-var contract-owner  principal tx-sender)
(define-data-var pending-owner   (optional principal) none)

;; Pre-set before each flash loan call (off-chain: simulate the swap, apply slippage)
;; min-alex-out: minimum ALEX to accept from Leg 1 (slippage guard).
;;               Defaults to u0 which is INVALID -- execute-stx-flash will revert.
;;               Auto-reset to u0 after each successful execution.
;; min-profit:   minimum STX profit to accept after repayment (anti-griefing)
;; max-fee-bp:   maximum flash fee (basis points) acceptable at execution time.
;;               Protects against fee increase race condition between simulation and execution.
;;               Default u10 = 0.1% (well above current 0.05% fee, adjust as needed).
(define-data-var min-alex-out    uint u0)
(define-data-var min-profit      uint u1)
(define-data-var max-fee-bp      uint u10)

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
    ;; Only FLASH-CORE may invoke this callback
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)

    ;; core parameter accepted for trait compliance; assert matches FLASH-CORE (defense-in-depth)
    (asserts! (is-eq core FLASH-CORE) ERR-NOT-CORE)

    ;; Minimum loan amount guard -- prevents rounding edge cases
    (asserts! (>= amount MIN-LOAN-AMOUNT) ERR-LOAN-TOO-SMALL)

    ;; Slippage pre-set guard -- reverts if owner forgot to call set-min-alex-out
    (asserts! (> min-alex u0) ERR-MIN-ALEX-UNSET)

    ;; [v5-M-2] Fee guard -- reverts if flash core fee was raised since simulation
    (asserts! (<= fee-bp (var-get max-fee-bp)) ERR-FEE-TOO-HIGH)

    ;; Leg 1: wSTX -> ALEX (slippage guarded by min-alex-out)
    ;; [v5-M-1] Capture return value to get exact dy (ALEX received) -- do not use get-balance
    (let ((leg1 (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-x-for-y
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2
      'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
      ALEX-FACTOR
      dx
      (some min-alex)
    )) ERR-SWAP-FAILED)))

      (let ((alex-received (get dy leg1)))
        (asserts! (> alex-received u0) ERR-SWAP-FAILED)

        ;; Leg 2: ALEX -> wSTX using only ALEX received from Leg 1
        ;; Floor = enough to cover loan + fee + min-profit
        (let ((min-stx-back (* (+ total-owed profit-floor) WSTX-SCALE)))
          (unwrap! (as-contract (contract-call? 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01 swap-y-for-x
            'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2
            'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex
            ALEX-FACTOR
            alex-received
            (some min-stx-back)
          )) ERR-SWAP-FAILED)

          (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
            ;; Minimum profit guard -- reverts if trade was not profitable enough
            (asserts! (>= stx-bal (+ total-owed profit-floor)) ERR-NO-PROFIT)

            ;; Repay to hardcoded FLASH-CORE -- never to caller-supplied core
            (unwrap! (as-contract (stx-transfer? total-owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)

            ;; [v5-H-1] Reset min-alex-out to u0 -- forces explicit re-authorization next loan
            (var-set min-alex-out u0)

            ;; Emit execution event for off-chain monitoring
            (print {
              event:       "execute-stx-flash",
              amount:      amount,
              alex-in:     alex-received,
              stx-back:    stx-bal,
              total-owed:  total-owed,
              profit:      (- stx-bal total-owed),
              fee-bp:      fee-bp,
            })

            ;; Profit remains in contract -- owner sweeps with rescue-stx
            (ok true)
          )
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
;; REQUIRED: execute-stx-flash reverts with ERR-MIN-ALEX-UNSET if this is u0.
;; Auto-reset to u0 after each successful execution.
(define-public (set-min-alex-out (min-out uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (print { event: "set-min-alex-out", min-out: min-out })
    (ok (var-set min-alex-out min-out))
  )
)

;; Set minimum acceptable STX profit after repayment.
;; Prevents griefing and loss-making executions.
(define-public (set-min-profit (min-stx uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (print { event: "set-min-profit", min-stx: min-stx })
    (ok (var-set min-profit min-stx))
  )
)

;; Set maximum acceptable flash fee in basis points.
;; execute-stx-flash reverts with ERR-FEE-TOO-HIGH if live fee exceeds this.
;; Default u10 = 0.1%. Current FlashStack fee is u5 = 0.05%.
;; Raise this only if you expect FlashStack to increase fees.
(define-public (set-max-fee-bp (max-bp uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (print { event: "set-max-fee-bp", max-bp: max-bp })
    (ok (var-set max-fee-bp max-bp))
  )
)

;; =============================================
;; Admin
;; =============================================

;; Two-step ownership transfer -- prevents locking out via typo
(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (print { event: "ownership-proposed", new-owner: new-owner })
    (ok (var-set pending-owner (some new-owner)))
  )
)

(define-public (accept-ownership)
  (let ((pending (unwrap! (var-get pending-owner) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender pending) ERR-NOT-PENDING)
    (var-set contract-owner pending)
    (var-set pending-owner none)
    (print { event: "ownership-accepted", new-owner: pending })
    (ok true)
  )
)

(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (print { event: "rescue-stx", amount: amount, to: to })
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-TRANSFER-FAILED)
    (ok true)
  )
)

(define-public (rescue-alex (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (print { event: "rescue-alex", amount: amount, to: to })
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

;; simulate is a planning tool only -- does not reflect live AMM state.
;; spread-bp must come from a live get-y-given-x / get-x-given-y AMM quote,
;; not a theoretical price ratio. fee-bp must be fetched from FLASH-CORE.get-fee-basis-points.
;; Race condition: live fee may change between simulation and execution.
;; ERR-FEE-TOO-HIGH (using max-fee-bp) and ERR-NO-PROFIT are the on-chain backstops.
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
    max-fee-bp:     (var-get max-fee-bp),
  })
)
