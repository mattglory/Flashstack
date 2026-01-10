;; Liquidation Receiver
;; 
;; This receiver demonstrates how to use flash loans for liquidating
;; undercollateralized positions in lending protocols.
;;
;; Use Case: Liquidate a borrower's position, profit from liquidation bonus

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-LIQUIDATION-FAILED (err u501))
(define-constant ERR-INSUFFICIENT-PROFIT (err u502))
(define-constant ERR-REPAYMENT-FAILED (err u503))
(define-constant ERR-MOCK-ERROR (err u999))

;; Example liquidation parameters
(define-data-var liquidation-bonus-bp uint u1000) ;; 10% liquidation bonus

;; Main flash loan execution
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))  ;; 0.05% FlashStack fee
    (total-owed (+ amount fee))
    (liquidation-bonus (/ (* amount (var-get liquidation-bonus-bp)) u10000))
    (expected-profit (- liquidation-bonus fee))
    (collateral-received (+ amount liquidation-bonus))
    (final-balance (+ amount liquidation-bonus))
  )
    ;; Verify this is called by FlashStack
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    
    ;; Ensure liquidation would be profitable
    (asserts! (> expected-profit u0) ERR-INSUFFICIENT-PROFIT)
    
    ;; Step 1: Use flash loaned tokens to repay borrower's debt
    ;; In production, this would call the lending protocol's repay function
    (unwrap! (mock-repay-debt amount) ERR-LIQUIDATION-FAILED)
    
    ;; Step 2 & 3: Swap collateral back to sBTC if needed
    ;; In production, call DEX to swap collateral -> sBTC
    (unwrap! (mock-swap-collateral collateral-received) ERR-LIQUIDATION-FAILED)
    
    ;; Step 4: Verify we have enough to repay flash loan + keep profit
    (asserts! (>= final-balance total-owed) ERR-INSUFFICIENT-PROFIT)
    
    ;; Step 5: Repay flash loan
    (try! (as-contract (contract-call? .sbtc-token transfer 
      total-owed 
      tx-sender
      .flashstack-core
      none
    )))
    
    ;; Success! We kept: liquidation-bonus - fee
    (ok true)
  )
)

;; Mock functions - Replace with real protocol integrations

(define-private (mock-repay-debt (amount uint))
  ;; In production: Call lending protocol's repay function
  ;; Example: (contract-call? .lending-protocol repay loan-id amount)
  (ok true)
)

(define-private (mock-swap-collateral (collateral-amount uint))
  ;; In production: Call DEX to swap collateral -> sBTC
  ;; Example: (contract-call? .dex swap collateral-token sbtc-token collateral-amount min-out)
  (ok collateral-amount)
)

;; Read-only functions

(define-read-only (get-liquidation-bonus)
  (var-get liquidation-bonus-bp)
)

(define-read-only (calculate-expected-profit (amount uint))
  (let (
    (fee (/ (* amount u5) u10000))
    (bonus (/ (* amount (var-get liquidation-bonus-bp)) u10000))
  )
    {
      flash-loan-amount: amount,
      flash-loan-fee: fee,
      liquidation-bonus: bonus,
      expected-profit: (- bonus fee),
      total-to-repay: (+ amount fee)
    }
  )
)

;; Helper: Check if liquidation would be profitable
(define-read-only (is-liquidation-profitable (debt-amount uint))
  (let (
    (fee (/ (* debt-amount u5) u10000))
    (bonus (/ (* debt-amount (var-get liquidation-bonus-bp)) u10000))
  )
    (> bonus fee)
  )
)
