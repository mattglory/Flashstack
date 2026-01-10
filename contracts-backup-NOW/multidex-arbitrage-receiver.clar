;; Multi-DEX Arbitrage Receiver
;; 
;; This receiver demonstrates advanced arbitrage across multiple DEXs
;; using flash loans to capture price differences.
;;
;; Use Case: Buy low on DEX A, sell high on DEX B, profit from spread

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-PROFIT (err u501))
(define-constant ERR-BUY-FAILED (err u502))
(define-constant ERR-SELL-FAILED (err u503))
(define-constant ERR-REPAYMENT-FAILED (err u504))
(define-constant ERR-SLIPPAGE-TOO-HIGH (err u505))

;; Constants for slippage protection
(define-constant MAX-SLIPPAGE-BP u200) ;; 2% max slippage (realistic for flash loans)

;; Main flash loan execution for multi-DEX arbitrage
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))  ;; 0.05% FlashStack fee
    (total-owed (+ amount fee))
  )
    ;; Verify this is called by FlashStack
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    
    ;; Step 1: Buy asset on cheap DEX (DEX A)    ;; Use flash loaned sBTC to buy BTC
    (let ((btc-bought (unwrap! (buy-on-dex-a amount) ERR-BUY-FAILED)))
      
      ;; Verify we got expected amount (slippage check)
      (unwrap! (verify-slippage amount btc-bought) ERR-SLIPPAGE-TOO-HIGH)
      
      ;; Step 2: Sell asset on expensive DEX (DEX B)
      ;; Sell BTC for sBTC at higher price
      (let ((sbtc-received (unwrap! (sell-on-dex-b btc-bought) ERR-SELL-FAILED)))
        
        ;; Verify we got expected amount (slippage check)
        (unwrap! (verify-slippage btc-bought sbtc-received) ERR-SLIPPAGE-TOO-HIGH)
        
        ;; Step 3: Check profitability
        (let ((profit (- sbtc-received total-owed)))
          (asserts! (> profit u0) ERR-INSUFFICIENT-PROFIT)
          
          ;; Step 4: Repay flash loan
          (try! (as-contract (contract-call? .sbtc-token transfer 
            total-owed 
            tx-sender
            .flashstack-core
            none
          )))
          
          ;; Success! Keep the profit
          (ok true)
        )
      )
    )
  )
)
;; DEX Integration Functions (Mock - Replace with real DEX calls)

(define-private (buy-on-dex-a (sbtc-amount uint))
  ;; In production: Call DEX A swap function
  ;; Example: (contract-call? .alex-swap swap-tokens sbtc-token btc-token sbtc-amount min-btc)
  (ok (/ (* sbtc-amount u99) u100)) ;; Simulate 1% slippage (better than 2%)
)

(define-private (sell-on-dex-b (btc-amount uint))
  ;; In production: Call DEX B swap function
  ;; Example: (contract-call? .stackswap swap-tokens btc-token sbtc-token btc-amount min-sbtc)
  (ok (/ (* btc-amount u102) u100)) ;; Simulate selling at 2% premium (within slippage tolerance)
)

;; Slippage protection
(define-private (verify-slippage (expected uint) (actual uint))
  (let (
    (difference (if (> actual expected) 
                   (- actual expected) 
                   (- expected actual)))
    (slippage-bp (/ (* difference u10000) expected))
  )
    (if (<= slippage-bp MAX-SLIPPAGE-BP)
      (ok true)
      ERR-SLIPPAGE-TOO-HIGH
    )
  )
)

;; Read-only functions
(define-read-only (calculate-arbitrage-profit
    (amount uint)
    (buy-price uint)  ;; Price on DEX A (units per sBTC)
    (sell-price uint)) ;; Price on DEX B (units per sBTC)
  (let (
    (fee (/ (* amount u5) u10000))
    (total-owed (+ amount fee))
    (btc-bought (/ (* amount u1000000) buy-price))
    (sbtc-received (/ (* btc-bought sell-price) u1000000))
    (gross-profit (- sbtc-received amount))
    (net-profit (- sbtc-received total-owed))
  )
    {
      amount-to-borrow: amount,
      fee: fee,
      total-to-repay: total-owed,
      btc-bought: btc-bought,
      sbtc-received: sbtc-received,
      gross-profit: gross-profit,
      net-profit: net-profit,
      is-profitable: (> net-profit u0),
      roi-bp: (if (> net-profit u0) 
                 (/ (* net-profit u10000) amount) 
                 u0)
    }
  )
)

;; Helper: Get current price spread between DEXs
(define-read-only (get-price-spread 
    (dex-a-price uint) 
    (dex-b-price uint))
  (let (
    (spread (if (> dex-b-price dex-a-price)
               (- dex-b-price dex-a-price)
               u0))
    (spread-bp (if (> spread u0)
                  (/ (* spread u10000) dex-a-price)
                  u0))
  )
    {
      dex-a-price: dex-a-price,
      dex-b-price: dex-b-price,
      spread: spread,
      spread-bp: spread-bp,
      is-arbitrage-opportunity: (> spread-bp u50) ;; Must be > flash loan fee
    }
  )
)
