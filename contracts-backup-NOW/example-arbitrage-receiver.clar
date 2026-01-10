;; Example Arbitrage Receiver Contract
;; Demonstrates how to use FlashStack for arbitrage opportunities
;; v1.1 - Works with fixed fee mechanism

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error Codes
(define-constant ERR-ARBITRAGE-FAILED (err u200))
(define-constant ERR-INSUFFICIENT-PROFIT (err u201))

;; Simulated DEX prices for demo
(define-data-var dex-a-price uint u1000000)
(define-data-var dex-b-price uint u1050000)

;; Execute flash loan callback
;; Receiver gets amount + fee, must return amount + fee
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))
    (total-owed (+ amount fee))
  )
    ;; In production: Use the sBTC for arbitrage
    ;; 1. Buy on cheap DEX (using amount)
    ;; 2. Sell on expensive DEX
    ;; 3. Keep profit, return amount + fee
    
    ;; For demo: We received amount + fee, just return it
    ;; (In real scenario, profit would come from arbitrage)
    
    ;; Transfer back to FlashStack
    (as-contract (contract-call? .sbtc-token transfer 
      total-owed 
      tx-sender
      .flashstack-core
      none
    ))
  )
)

;; Read-only helper functions
(define-read-only (calculate-potential-profit (amount uint))
  (let (
    (buy-price (var-get dex-a-price))
    (sell-price (var-get dex-b-price))
    (fee (/ (* amount u5) u10000))
    (price-diff (- sell-price buy-price))
    (gross-profit (/ (* amount price-diff) buy-price))
    (net-profit (- gross-profit fee))
  )
    (ok {
      amount: amount,
      gross-profit: gross-profit,
      fee: fee,
      net-profit: net-profit,
      profitable: (> net-profit u0)
    })
  )
)

;; Admin functions for testing
(define-public (set-dex-a-price (price uint))
  (begin
    (asserts! (> price u0) ERR-ARBITRAGE-FAILED)
    (ok (var-set dex-a-price price))
  )
)

(define-public (set-dex-b-price (price uint))
  (begin
    (asserts! (> price u0) ERR-ARBITRAGE-FAILED)
    (ok (var-set dex-b-price price))
  )
)
