;; Collateral Swap Receiver
;; 
;; This receiver demonstrates how to use flash loans to swap collateral
;; in a lending position without closing and reopening.
;;
;; Use Case: Move from low-yield collateral to high-yield collateral

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-SWAP-FAILED (err u501))
(define-constant ERR-INSUFFICIENT-COLLATERAL (err u502))
(define-constant ERR-REPAYMENT-FAILED (err u503))

;; Main flash loan execution
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))  ;; 0.05% FlashStack fee
    (total-owed (+ amount fee))
  )
    ;; Verify this is called by FlashStack
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    
    ;; Step 1: Use flash loaned sBTC to repay existing debt
    ;; This releases the old collateral
    (unwrap! (mock-repay-existing-debt amount borrower) ERR-SWAP-FAILED)
    
    ;; Step 2: Receive old collateral back
    (let ((old-collateral-amount (mock-get-collateral-amount borrower)))
      
      ;; Step 3: Swap old collateral to new collateral on DEX
      ;; Example: USDA -> STX for better staking rewards
      (let ((new-collateral-received (unwrap! (mock-swap-old-to-new-collateral 
              old-collateral-amount) ERR-SWAP-FAILED)))
        
        ;; Step 4: Deposit new collateral into lending protocol
        (unwrap! (mock-deposit-new-collateral new-collateral-received borrower) ERR-SWAP-FAILED)
        
        ;; Step 5: Borrow against new collateral to repay flash loan
        ;; New collateral should have better LTV or yield
        (let ((borrowed-back (unwrap! (mock-borrow-against-new-collateral 
                total-owed 
                borrower) ERR-INSUFFICIENT-COLLATERAL)))
          
          ;; Verify we borrowed enough
          (asserts! (>= borrowed-back total-owed) ERR-INSUFFICIENT-COLLATERAL)
          
          ;; Step 6: Repay flash loan
          (try! (as-contract (contract-call? .sbtc-token transfer 
            total-owed 
            tx-sender
            .flashstack-core
            none
          )))
          
          ;; Success! Collateral swapped, position maintained
          (ok true)
        )
      )
    )
  )
)

;; Mock functions - Replace with real protocol integrations

(define-private (mock-repay-existing-debt (amount uint) (user principal))
  ;; In production: Call lending protocol to repay debt
  ;; Example: (contract-call? .lending-protocol repay-debt amount)
  (ok true)
)

(define-private (mock-get-collateral-amount (user principal))
  ;; In production: Query user's collateral balance
  ;; Example: (contract-call? .lending-protocol get-collateral user)
  u150000000000 ;; 1500 units example
)

(define-private (mock-swap-old-to-new-collateral (old-amount uint))
  ;; In production: Call DEX to swap collateral types
  ;; Example: (contract-call? .dex swap old-token new-token old-amount min-out)
  (ok u160000000000) ;; 10% better value example
)

(define-private (mock-deposit-new-collateral (amount uint) (user principal))
  ;; In production: Deposit new collateral to lending protocol
  ;; Example: (contract-call? .lending-protocol deposit-collateral amount)
  (ok true)
)

(define-private (mock-borrow-against-new-collateral (amount uint) (user principal))
  ;; In production: Borrow against newly deposited collateral
  ;; Example: (contract-call? .lending-protocol borrow amount)
  (ok amount)
)

;; Read-only functions

(define-read-only (calculate-swap-economics 
    (debt-amount uint)
    (old-collateral-value uint)
    (new-collateral-value uint))
  (let (
    (fee (/ (* debt-amount u50) u10000))
    (value-improvement (- new-collateral-value old-collateral-value))
  )
    {
      flash-loan-amount: debt-amount,
      flash-loan-fee: fee,
      old-collateral-value: old-collateral-value,
      new-collateral-value: new-collateral-value,
      value-improvement: value-improvement,
      net-benefit: (- value-improvement fee),
      is-profitable: (> value-improvement fee)
    }
  )
)

;; Helper: Estimate if swap would be beneficial
(define-read-only (is-swap-beneficial 
    (current-apy uint) 
    (new-apy uint)
    (debt-amount uint))
  (let (
    (fee (/ (* debt-amount u50) u10000))
    (apy-improvement (* (- new-apy current-apy) debt-amount))
  )
    ;; Swap beneficial if APY improvement > flash loan fee
    (> apy-improvement fee)
  )
)
