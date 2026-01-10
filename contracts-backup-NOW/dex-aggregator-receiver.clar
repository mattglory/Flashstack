;; DEX Aggregator Receiver
;; Finds best price across multiple DEXs and executes arbitrage
;; v1.0 - December 2025

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error Codes
(define-constant ERR-NO-PROFIT (err u200))
(define-constant ERR-INSUFFICIENT-LIQUIDITY (err u201))
(define-constant ERR-SLIPPAGE-TOO-HIGH (err u202))

;; Simulated DEX prices (in production, read from actual DEXs)
;; Prices represent sBTC per BTC (e.g., u50000 = 50,000 sBTC = 1 BTC)
(define-data-var alex-price uint u50000)   ;; 50,000 sBTC per BTC
(define-data-var velar-price uint u50250)  ;; 50,250 sBTC per BTC (0.5% higher)
(define-data-var bitflow-price uint u50100) ;; 50,100 sBTC per BTC (0.2% higher)

;; Configuration
(define-data-var max-slippage uint u100) ;; 1% max slippage (100 basis points)

;; Execute flash loan callback
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))
    (total-owed (+ amount fee))
    (alex (var-get alex-price))
    (velar (var-get velar-price))
    (bitflow (var-get bitflow-price))
  )
    ;; Step 1: Find best buy price (lowest)
    (let (
      (best-buy-price (get-min-price alex bitflow))
      (best-buy-dex (if (< alex bitflow) "ALEX" "Bitflow"))
    )
      ;; Step 2: Find best sell price (highest)
      (let (
        (best-sell-price (get-max-price velar bitflow))
        (best-sell-dex (if (> velar bitflow) "Velar" "Bitflow"))
      )
        ;; Step 3: Calculate expected profit
        (let (
          (btc-bought (/ amount best-buy-price))
          (sbtc-received (/ (* btc-bought best-sell-price) u1))
          (gross-profit (- sbtc-received amount))
          (net-profit (- gross-profit fee))
        )
          ;; Step 4: Verify profitability
          (asserts! (> net-profit u0) ERR-NO-PROFIT)
          
          ;; Step 5: Execute trades (simulated)
          ;; In production:
          ;; - Buy BTC on best-buy-dex with amount
          ;; - Sell BTC on best-sell-dex
          ;; - Receive sbtc-received
          
          ;; Step 6: Return loan + fee to FlashStack
          (try! (as-contract (contract-call? .sbtc-token transfer 
            total-owed 
            tx-sender
            .flashstack-core
            none
          )))
          
          ;; Return success
          (ok true)
        )
      )
    )
  )
)

;; Helper functions
(define-read-only (get-min-price (a uint) (b uint))
  (if (< a b) a b)
)

(define-read-only (get-max-price (a uint) (b uint))
  (if (> a b) a b)
)

;; Calculate potential profit before executing
(define-read-only (calculate-arbitrage-profit (amount uint))
  (let (
    (fee (/ (* amount u5) u10000))
    (alex (var-get alex-price))
    (velar (var-get velar-price))
    (bitflow (var-get bitflow-price))
    (best-buy (get-min-price alex bitflow))
    (best-sell (get-max-price velar bitflow))
  )
    (let (
      (btc-amount (/ amount best-buy))
      (sbtc-received (/ (* btc-amount best-sell) u1))
      (gross-profit (- sbtc-received amount))
      (net-profit (- gross-profit fee))
    )
      (ok {
        amount: amount,
        best-buy-price: best-buy,
        best-sell-price: best-sell,
        gross-profit: gross-profit,
        fee: fee,
        net-profit: net-profit,
        profitable: (> net-profit u0),
        roi: (if (> amount u0) (/ (* net-profit u10000) amount) u0)
      })
    )
  )
)

;; Admin functions for testing
(define-public (set-alex-price (price uint))
  (begin
    (asserts! (> price u0) ERR-INSUFFICIENT-LIQUIDITY)
    (ok (var-set alex-price price))
  )
)

(define-public (set-velar-price (price uint))
  (begin
    (asserts! (> price u0) ERR-INSUFFICIENT-LIQUIDITY)
    (ok (var-set velar-price price))
  )
)

(define-public (set-bitflow-price (price uint))
  (begin
    (asserts! (> price u0) ERR-INSUFFICIENT-LIQUIDITY)
    (ok (var-set bitflow-price price))
  )
)

(define-public (set-max-slippage (slippage uint))
  (begin
    (asserts! (<= slippage u500) ERR-SLIPPAGE-TOO-HIGH)
    (ok (var-set max-slippage slippage))
  )
)
