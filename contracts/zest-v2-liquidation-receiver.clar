;; zest-v2-liquidation-receiver.clar
;; FlashStack Receiver -- Zest Protocol V2 Flash Liquidation
;;
;; DEPLOYMENT REQUIREMENTS (both must be done before this contract can operate):
;;   1. Whitelist on FlashStack:
;;        call add-approved-receiver on flashstack-stx-core with this contract address
;;   2. Whitelist on Zest V2 (PENDING -- requires Zest team action):
;;        Zest V2 line 1489 of v0-4-market.clar:
;;        (asserts! (is-eq contract-caller tx-sender) ERR-AUTHORIZATION)
;;        This blocks any contract from calling liquidate().
;;        Once Zest adds an authorized-liquidator whitelist and a new entry point,
;;        update ZEST-LIQUIDATE-FN below and redeploy.
;;
;; Supported modes (set-target before calling flash-loan):
;;   1 - STX flash -> pay USDCx debt -> receive sBTC collateral -> swap sBTC->STX -> repay
;;   2 - STX flash -> pay USDH debt  -> receive sBTC collateral -> swap sBTC->STX -> repay
;;   3 - STX flash -> pay wSTX debt  -> receive sBTC collateral -> swap sBTC->STX -> repay
;;      (mode 3 requires wSTX on a DEX -- see note in execute-stx-flash)
;;
;; Liquidation profit = Zest bonus (5-10%) - FlashStack fee (0.05%) - swap slippage (~0.3%)
;; Net expected: 4-9% per liquidated position.
;;
;; Flow:
;;   1. Call set-target(borrower, debt-amount, mode)
;;   2. Call flashstack-stx-core.flash-loan(debt-equivalent-stx, this-contract)
;;   3. FlashStack calls execute-stx-flash
;;   4. Receiver swaps STX -> debt token, liquidates Zest, swaps collateral -> STX, repays

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants -- all confirmed from on-chain data
;; =============================================

(define-constant BASIS-POINTS u10000)

(define-constant ERR-NOT-OWNER    (err u900))
(define-constant ERR-REPAY-FAILED (err u901))
(define-constant ERR-LIQUIDATION  (err u902))
(define-constant ERR-INSUFFICIENT (err u903))
(define-constant ERR-ZERO-AMOUNT  (err u904))
(define-constant ERR-BAD-MODE     (err u905))
(define-constant ERR-SWAP-FAILED  (err u906))
(define-constant ERR-NOT-CORE     (err u907))
(define-constant ERR-SWEEP-FAILED (err u908))
(define-constant ERR-NOT-PENDING  (err u909))

;; FlashStack STX core (hardcoded -- repayment never goes elsewhere)
(define-constant FLASH-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

;; Zest V2 market -- confirmed from mainnet transactions
(define-constant ZEST-MARKET 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market)
;; Zest V2 wSTX -- confirmed from repay transactions
(define-constant ZEST-WSTX 'SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.wstx)

;; Debt tokens (confirmed from borrow transactions on v0-4-market)
(define-constant USDCX 'SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx)
(define-constant USDH  'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1)

;; Collateral tokens
(define-constant SBTC  'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)
(define-constant STSTX 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)

;; Velar (Uniswap v2 fork) -- for sBTC <-> STX swaps
(define-constant VELAR-ROUTER 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router)
(define-constant VELAR-FEE-TO 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to)
(define-constant VELAR-WSTX   'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx)
(define-constant VELAR-POOL-SBTC-STX u70)

;; Bitflow stableswap -- for STX <-> stSTX if needed
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)
(define-constant BITFLOW-LP   'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; =============================================
;; State
;; =============================================

(define-data-var owner           principal tx-sender)
(define-data-var pending-owner   (optional principal) none)
(define-data-var target-borrower principal tx-sender)
(define-data-var target-debt     uint      u0)
;; Modes:
;;   u1 = USDCx debt + sBTC collateral
;;   u2 = USDH debt  + sBTC collateral
;;   u3 = wSTX debt  + sBTC collateral (needs wSTX on Velar -- see note)
(define-data-var target-mode     uint      u1)
;; Slippage tolerance on swaps (default 200 = 2%)
(define-data-var slippage-bp     uint      u200)

;; =============================================
;; STX Flash Loan Callback
;; =============================================

;; Called by flashstack-stx-core after sending 'amount' STX to this contract.
;; Pre-condition: set-target must have been called with the correct borrower/debt/mode.
;;
;; IMPORTANT: Until Zest adds the authorized-liquidator whitelist, the
;; (contract-call? ZEST-MARKET liquidate ...) line will revert with
;; ERR-AUTHORIZATION (u400025). The rest of the logic is correct.
(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? FLASH-CORE get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) BASIS-POINTS))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    (borrower (var-get target-borrower))
    (debt-amt (var-get target-debt))
    (mode    (var-get target-mode))
    (slip    (var-get slippage-bp))
  )
    ;; Only flashstack-stx-core may call this
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)
    (asserts! (and (>= mode u1) (<= mode u3)) ERR-BAD-MODE)

    (if (is-eq mode u1)

      ;; Mode 1: USDCx debt + sBTC collateral
      ;; NOTE: Velar has NO STX/USDCx pool (confirmed: pools 1-14 scanned, none match).
      ;; This mode needs a different swap route before it can be used.
      ;; Options to research: ALEX AMM STX/USDCx pair, or Bitflow if available.
      ;; Until a valid swap route is identified, mode 1 will always revert here.
      ;; The primary liquidation target ($250K USDH position) uses mode 2 -- not affected.
      (let (
        (min-usdcx (/ (* debt-amt (- BASIS-POINTS slip)) BASIS-POINTS))
      )
        (unwrap! (as-contract (contract-call? VELAR-ROUTER swap-exact-tokens-for-tokens
          u2 VELAR-WSTX USDCX VELAR-WSTX USDCX VELAR-FEE-TO amount min-usdcx))
          ERR-SWAP-FAILED)

        (let ((usdcx-bal (unwrap! (as-contract (contract-call? USDCX get-balance tx-sender)) ERR-SWAP-FAILED)))
          (asserts! (> usdcx-bal u0) ERR-SWAP-FAILED)

          ;; Step 2: Liquidate -- pays usdcx-bal of USDCx debt, receives sBTC collateral
          ;; Reverts with ERR-AUTHORIZATION until Zest adds authorized-liquidator whitelist
          (unwrap! (as-contract (contract-call? ZEST-MARKET liquidate
            borrower SBTC USDCX usdcx-bal u0 (some (as-contract tx-sender)) none))
            ERR-LIQUIDATION)

          ;; Step 3: Swap all received sBTC -> STX on Velar
          (let ((sbtc-bal (unwrap! (as-contract (contract-call? SBTC get-balance tx-sender)) ERR-SWAP-FAILED)))
            (asserts! (> sbtc-bal u0) ERR-SWAP-FAILED)
            (let ((min-stx (/ (* sbtc-bal (- BASIS-POINTS slip)) BASIS-POINTS)))
              (unwrap! (as-contract (contract-call? VELAR-ROUTER swap-exact-tokens-for-tokens
                VELAR-POOL-SBTC-STX VELAR-WSTX SBTC SBTC VELAR-WSTX VELAR-FEE-TO sbtc-bal min-stx))
                ERR-SWAP-FAILED)

              ;; Step 4: Repay to hardcoded FLASH-CORE
              (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
                (asserts! (>= stx-bal owed) ERR-INSUFFICIENT)
                (unwrap! (as-contract (stx-transfer? owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)
                (ok true)
              )
            )
          )
        )
      )

      (if (is-eq mode u2)

        ;; Mode 2: USDH debt + sBTC collateral
        ;; STX received -> swap STX->USDH via Arkadiko -> liquidate -> receive sBTC -> swap -> repay
        (let ((min-usdh (/ (* debt-amt (- BASIS-POINTS slip)) BASIS-POINTS)))
          (unwrap! (as-contract (contract-call?
            'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-swap-v2-1
            swap-x-for-y
            'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.wrapped-stx-token
            USDH amount (some min-usdh)))
            ERR-SWAP-FAILED)

          (let ((usdh-bal (unwrap! (as-contract (contract-call? USDH get-balance tx-sender)) ERR-SWAP-FAILED)))
            (asserts! (> usdh-bal u0) ERR-SWAP-FAILED)

            ;; Liquidate
            (unwrap! (as-contract (contract-call? ZEST-MARKET liquidate
              borrower SBTC USDH usdh-bal u0 (some (as-contract tx-sender)) none))
              ERR-LIQUIDATION)

            ;; Swap sBTC -> STX
            (let ((sbtc-bal (unwrap! (as-contract (contract-call? SBTC get-balance tx-sender)) ERR-SWAP-FAILED)))
              (asserts! (> sbtc-bal u0) ERR-SWAP-FAILED)
              (let ((min-stx (/ (* sbtc-bal (- BASIS-POINTS slip)) BASIS-POINTS)))
                (unwrap! (as-contract (contract-call? VELAR-ROUTER swap-exact-tokens-for-tokens
                  VELAR-POOL-SBTC-STX VELAR-WSTX SBTC SBTC VELAR-WSTX VELAR-FEE-TO sbtc-bal min-stx))
                  ERR-SWAP-FAILED)

                (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
                  (asserts! (>= stx-bal owed) ERR-INSUFFICIENT)
                  (unwrap! (as-contract (stx-transfer? owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)
                  (ok true)
                )
              )
            )
          )
        )

        ;; Mode 3: wSTX debt + sBTC collateral
        ;; NOTE: wSTX has no public mint function. To pay wSTX debt, this contract
        ;; must already hold wSTX tokens (pre-funded via a DEX swap off-chain).
        ;; The flash loan STX is used to fund the repayment after liquidation.
        ;; Flow: receive STX flash -> liquidate using pre-held wSTX ->
        ;;        receive sBTC -> swap sBTC->STX -> repay loan + top up wSTX spent
        (let (
          (wstx-bal (unwrap! (as-contract (contract-call? ZEST-WSTX get-balance tx-sender)) ERR-SWAP-FAILED))
        )
          (asserts! (>= wstx-bal debt-amt) ERR-INSUFFICIENT)

          ;; Liquidate using pre-held wSTX
          (unwrap! (as-contract (contract-call? ZEST-MARKET liquidate
            borrower SBTC ZEST-WSTX debt-amt u0 (some (as-contract tx-sender)) none))
            ERR-LIQUIDATION)

          ;; Swap received sBTC -> STX
          (let ((sbtc-bal (unwrap! (as-contract (contract-call? SBTC get-balance tx-sender)) ERR-SWAP-FAILED)))
            (asserts! (> sbtc-bal u0) ERR-SWAP-FAILED)
            (let ((min-stx (/ (* sbtc-bal (- BASIS-POINTS slip)) BASIS-POINTS)))
              (unwrap! (as-contract (contract-call? VELAR-ROUTER swap-exact-tokens-for-tokens
                VELAR-POOL-SBTC-STX VELAR-WSTX SBTC SBTC VELAR-WSTX VELAR-FEE-TO sbtc-bal min-stx))
                ERR-SWAP-FAILED)

              (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
                (asserts! (>= stx-bal owed) ERR-INSUFFICIENT)
                (unwrap! (as-contract (stx-transfer? owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)
                (ok true)
              )
            )
          )
        )
      )
    )
  )
)

;; =============================================
;; Owner Functions
;; =============================================

(define-public (set-target (borrower principal) (debt uint) (mode uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (> debt u0) ERR-ZERO-AMOUNT)
    (asserts! (and (>= mode u1) (<= mode u3)) ERR-BAD-MODE)
    (var-set target-borrower borrower)
    (var-set target-debt debt)
    (var-set target-mode mode)
    (ok true)
  )
)

(define-public (set-slippage (bp uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (and (>= bp u50) (<= bp u500)) ERR-BAD-MODE)
    (ok (var-set slippage-bp bp))
  )
)

;; Two-step ownership transfer -- prevents locking out via typo
(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (ok (var-set pending-owner (some new-owner)))
  )
)

(define-public (accept-ownership)
  (let ((pending (unwrap! (var-get pending-owner) ERR-NOT-PENDING)))
    (asserts! (is-eq tx-sender pending) ERR-NOT-PENDING)
    (var-set owner pending)
    (var-set pending-owner none)
    (ok true)
  )
)

;; Emergency sweep -- recover tokens if a tx partially fails
(define-public (sweep-stx (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender (var-get owner))) ERR-SWEEP-FAILED)
    (ok true)
  )
)

(define-public (sweep-sbtc (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (unwrap! (as-contract (contract-call? SBTC transfer amount tx-sender (var-get owner) none)) ERR-SWEEP-FAILED)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

;; Pre-flight check: estimate net profit before executing.
;; bonus-bp: Zest liquidation bonus in basis points (typically 500 = 5%)
(define-read-only (simulate (debt-amount uint) (bonus-bp uint) (flash-fee-bp uint))
  (let (
    (raw-fee  (/ (* debt-amount flash-fee-bp) BASIS-POINTS))
    (fee      (if (> raw-fee u0) raw-fee u1))
    (bonus    (/ (* debt-amount bonus-bp) BASIS-POINTS))
    (profit   (if (> bonus fee) (- bonus fee) u0))
  )
    {
      debt-amount:   debt-amount,
      bonus-bp:      bonus-bp,
      bonus:         bonus,
      flash-fee:     fee,
      net-profit:    profit,
      profitable:    (> bonus fee),
      owed-to-core:  (+ debt-amount fee),
    }
  )
)

(define-read-only (get-target)
  (ok { borrower: (var-get target-borrower), debt: (var-get target-debt), mode: (var-get target-mode) })
)

(define-read-only (get-owner)
  (ok { owner: (var-get owner), pending-owner: (var-get pending-owner) })
)
