;; Leverage Loop Receiver
;; 
;; This receiver demonstrates how to use flash loans to create
;; leveraged positions by recursively borrowing and depositing.
;;
;; Use Case: Amplify exposure to an asset (long) or yield strategy

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-LEVERAGE-TOO-HIGH (err u501))
(define-constant ERR-INSUFFICIENT-COLLATERAL (err u502))
(define-constant ERR-DEPOSIT-FAILED (err u503))
(define-constant ERR-BORROW-FAILED (err u504))
(define-constant ERR-REPAYMENT-FAILED (err u505))

;; Maximum leverage allowed (in basis points, 30000 = 3x)
(define-constant MAX-LEVERAGE-BP u30000)

;; Main flash loan execution for leverage
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))  ;; 0.05% FlashStack fee
    (total-owed (+ amount fee))
  )
    ;; Verify this is called by FlashStack
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    
    ;; Step 1: Deposit flash loaned amount as collateral
    (unwrap! (mock-deposit-collateral amount borrower) ERR-DEPOSIT-FAILED)
    
    ;; Step 2: Borrow maximum allowed against deposited collateral
    ;; Typically 75% LTV = can borrow 0.75 * amount
    (let ((borrowed-amount (unwrap! (mock-borrow-max borrower amount) ERR-BORROW-FAILED)))
      
      ;; Step 3: Deposit borrowed amount as additional collateral
      (unwrap! (mock-deposit-collateral borrowed-amount borrower) ERR-DEPOSIT-FAILED)
      
      ;; Step 4: Borrow again against new collateral (leverage loop)
      (let ((second-borrow (unwrap! (mock-borrow-max borrower borrowed-amount) ERR-BORROW-FAILED)))
        
        ;; Step 5: Deposit second borrow (creating 3x leverage)
        (unwrap! (mock-deposit-collateral second-borrow borrower) ERR-DEPOSIT-FAILED)
        
        ;; Step 6: Calculate total position and debt
        (let (
          (total-position (+ amount borrowed-amount second-borrow))
          (total-debt (+ borrowed-amount second-borrow))
          (leverage-achieved (/ (* total-position u10000) amount))
        )
          
          ;; Verify leverage is within limits
          (asserts! (<= leverage-achieved MAX-LEVERAGE-BP) ERR-LEVERAGE-TOO-HIGH)
          
          ;; Step 7: Borrow amount to repay flash loan
          (let ((repay-amount (unwrap! (mock-borrow-for-repayment total-owed borrower) ERR-BORROW-FAILED)))
            
            ;; Step 8: Repay flash loan
            (try! (as-contract (contract-call? .sbtc-token transfer 
              total-owed 
              tx-sender
              .flashstack-core
              none
            )))
            
            ;; Success! Created leveraged position
            (ok true)
          )
        )
      )
    )
  )
)

;; Mock functions - Replace with real protocol integrations

(define-private (mock-deposit-collateral (amount uint) (user principal))
  ;; In production: Deposit to lending protocol
  ;; Example: (contract-call? .lending-protocol deposit amount)
  (ok true)
)

(define-private (mock-borrow-max (user principal) (collateral uint))
  ;; In production: Borrow maximum against collateral (e.g., 75% LTV)
  ;; Example: (contract-call? .lending-protocol borrow max-amount)
  (ok (/ (* collateral u75) u100)) ;; 75% LTV
)

(define-private (mock-borrow-for-repayment (amount uint) (user principal))
  ;; In production: Borrow to repay flash loan
  (ok amount)
)

;; Read-only functions

(define-read-only (calculate-leverage-economics
    (initial-capital uint)
    (target-leverage-bp uint)  ;; e.g., 20000 = 2x
    (ltv-bp uint))  ;; e.g., 7500 = 75% LTV
  (let (
    (total-position (/ (* initial-capital target-leverage-bp) u10000))
    (total-debt (- total-position initial-capital))
    (flash-loan-needed (- total-position initial-capital))
    (flash-fee (/ (* flash-loan-needed u5) u10000))
    (collateral-ratio (/ (* initial-capital u10000) total-debt))
  )
    {
      initial-capital: initial-capital,
      target-leverage-bp: target-leverage-bp,
      ltv-bp: ltv-bp,
      total-position: total-position,
      total-debt: total-debt,
      flash-loan-needed: flash-loan-needed,
      flash-fee: flash-fee,
      effective-leverage: (/ total-position initial-capital),
      collateral-ratio-bp: collateral-ratio,
      is-safe: (>= collateral-ratio u15000) ;; 150% minimum
    }
  )
)

(define-read-only (calculate-liquidation-price
    (entry-price uint)
    (leverage-bp uint)
    (liquidation-ltv-bp uint))  ;; e.g., 8500 = 85% LTV before liquidation
  (let (
    (leverage-multiplier (/ leverage-bp u10000))
    (safe-ltv (/ liquidation-ltv-bp u10000))
    ;; Price drop % before liquidation = (1 - safe_ltv / leverage)
    (price-drop-bp (- u10000 (/ (* safe-ltv u10000) leverage-multiplier)))
    (liquidation-price (- entry-price 
                          (/ (* entry-price price-drop-bp) u10000)))
  )
    {
      entry-price: entry-price,
      leverage-bp: leverage-bp,
      liquidation-ltv-bp: liquidation-ltv-bp,
      liquidation-price: liquidation-price,
      max-price-drop-bp: price-drop-bp,
      buffer-percent: (/ price-drop-bp u100)
    }
  )
)
