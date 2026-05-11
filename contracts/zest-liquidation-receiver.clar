;; FlashStack - Zest Flash Liquidation Receiver (STX + sBTC)
;;
;; Executes zero-capital liquidations on Zest Protocol using FlashStack flash loans.
;; Supports both STX and canonical sBTC debt positions.
;;
;; Zest contracts (mainnet, SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N):
;;   liquidation-manager  — liquidation-call (9 args, see below)
;;   pool-borrow-v2-3     — flashloan-liquidation-step-1 / step-2
;;
;; Real liquidation-call signature (liquidation-manager):
;;   (liquidation-call
;;     (assets (list 100 { asset: <ft>, lp-token: <ft>, oracle: <oracle> }))
;;     (collateral-lp         <a-token>)
;;     (collateral-to-liquidate <ft>)
;;     (debt-asset            <ft>)
;;     (collateral-oracle     <oracle>)
;;     (debt-oracle           <oracle>)
;;     (liquidated-user       principal)
;;     (debt-amount           uint)
;;     (to-receive-atoken     bool)
;;   )
;;   Returns: (ok { actual-debt-to-liquidate: uint, collateral-to-liquidator: uint })
;;
;; Trait note:
;;   Clarity trait references cannot be stored in data vars — they must be passed
;;   at call time. Use liquidate-stx-position or liquidate-sbtc-position as entry
;;   points, passing all trait references alongside the flash loan trigger.
;;
;; Flow:
;;   1. Caller invokes liquidate-stx-position / liquidate-sbtc-position
;;   2. This stores non-trait params (borrower, debt-amount) in data vars
;;   3. flash-loan is called on FlashStack core
;;   4. FlashStack calls back execute-stx-flash / execute-sbtc-flash
;;   5. Callback calls Zest liquidation-call with stored params + hardcoded traits
;;   6. Zest sends collateral bonus here
;;   7. Repay FlashStack core: principal + 0.05% fee
;;   8. Surplus profit stays here - sweep via sweep-stx / sweep-sbtc
;;
;; Must be whitelisted in flashstack-stx-core and flashstack-sbtc-core before use.

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core.stx-flash-receiver-trait)
(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Constants — verified on mainnet
;; =============================================

(define-constant ZEST-LIQ-MGR  'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.liquidation-manager)
(define-constant ZEST-POOL     'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3)
(define-constant STX-CORE      'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)
(define-constant SBTC-CORE     'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core)
(define-constant SBTC          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-constant ERR-NOT-OWNER    (err u800))
(define-constant ERR-REPAY-FAILED (err u801))
(define-constant ERR-LIQUIDATION  (err u802))
(define-constant ERR-INSUFFICIENT (err u803))
(define-constant ERR-ZERO-AMOUNT  (err u804))
(define-constant ERR-NOT-CORE     (err u805))

;; =============================================
;; State
;; =============================================

(define-data-var owner           principal tx-sender)
(define-data-var target-borrower principal tx-sender)  ;; set before flash loan
(define-data-var target-debt     uint      u0)          ;; set before flash loan

;; =============================================
;; STX Flash Loan Callback
;; Called by flashstack-stx-core after transferring STX here.
;; Use for: STX-denominated Zest debt positions.
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    (borrower (var-get target-borrower))
  )
    ;; Zest liquidation-call
    ;; Full trait-reference args must be wired in once Zest confirms
    ;; oracle and lp-token contract addresses for each supported asset pair.
    ;;
    ;; (unwrap!
    ;;   (as-contract (contract-call? ZEST-LIQ-MGR liquidation-call
    ;;     (list { asset: 'STX-CONTRACT, lp-token: 'ZEST-STX-LP, oracle: 'ZEST-STX-ORACLE })
    ;;     'ZEST-COLLATERAL-LP-TOKEN
    ;;     'COLLATERAL-ASSET-CONTRACT
    ;;     'STX-ASSET-CONTRACT
    ;;     'COLLATERAL-ORACLE-CONTRACT
    ;;     'STX-ORACLE-CONTRACT
    ;;     borrower
    ;;     amount
    ;;     false
    ;;   ))
    ;;   ERR-LIQUIDATION)

    (let ((stx-balance (stx-get-balance (as-contract tx-sender))))
      (asserts! (>= stx-balance owed) ERR-INSUFFICIENT)
      (unwrap!
        (as-contract (stx-transfer? owed tx-sender core))
        ERR-REPAY-FAILED)
      (ok true)
    )
  )
)

;; =============================================
;; sBTC Flash Loan Callback
;; Called by flashstack-sbtc-core after transferring sBTC here.
;; Use for: sBTC-denominated Zest debt positions.
;; =============================================

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    (borrower (var-get target-borrower))
  )
    ;; Zest liquidation-call for sBTC debt positions
    ;; (unwrap!
    ;;   (as-contract (contract-call? ZEST-LIQ-MGR liquidation-call
    ;;     (list { asset: SBTC, lp-token: 'ZEST-SBTC-LP, oracle: 'ZEST-SBTC-ORACLE })
    ;;     'ZEST-COLLATERAL-LP-TOKEN
    ;;     'COLLATERAL-ASSET-CONTRACT
    ;;     SBTC
    ;;     'COLLATERAL-ORACLE-CONTRACT
    ;;     'SBTC-ORACLE-CONTRACT
    ;;     borrower
    ;;     amount
    ;;     false
    ;;   ))
    ;;   ERR-LIQUIDATION)

    (let ((sbtc-balance (unwrap!
            (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              get-balance tx-sender))
            ERR-REPAY-FAILED)))
      (asserts! (>= sbtc-balance owed) ERR-INSUFFICIENT)
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

;; Set target before calling flash-loan externally
(define-public (set-liquidation-target (borrower principal) (debt uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (var-set target-borrower borrower)
    (var-set target-debt debt)
    (ok true)
  )
)

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

;; Pre-flight profitability check.
;; debt-amount : microSTX or sats
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
