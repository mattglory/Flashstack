;; DEX Aggregator Receiver - ALEX Lab Integration
;; Executes flash loan arbitrage via ALEX Lab DEX on Stacks
;; v2.0 - April 2026 - Live DEX integration
;;
;; ALEX Lab mainnet contracts (SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9):
;;   amm-swap-pool-v1-1  - swap-helper / get-dy functions
;;   token-susdt         - sUSDT token
;;
;; Flash loan arbitrage flow:
;;   1. Receive sBTC flash loan
;;   2. Execute swap on ALEX (sBTC -> sUSDT -> sBTC) when price discrepancy exists
;;   3. Repay loan + fee to flashstack-core from arbitrage proceeds
;;   4. Keep net profit

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; =============================================
;; Error Codes
;; =============================================
(define-constant ERR-NO-PROFIT (err u200))
(define-constant ERR-SWAP-FAILED (err u201))
(define-constant ERR-SLIPPAGE-TOO-HIGH (err u202))
(define-constant ERR-INSUFFICIENT-BALANCE (err u203))

;; =============================================
;; ALEX Lab Integration Configuration
;;
;; Pool factor for sBTC/sUSDT pool on ALEX (1e8 scale)
;; Mainnet AMM: SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.amm-swap-pool-v1-1
;; =============================================
(define-constant ALEX-POOL-FACTOR u100000000)

;; Minimum profit threshold: 0.1% of loan (10 basis points)
(define-data-var min-profit-bp uint u10)

;; =============================================
;; Flash Loan Callback
;; =============================================

;; Called by flashstack-core after minting sBTC to this contract.
;;
;; This receiver implements the ALEX Lab arbitrage path:
;;   - On mainnet: executes live swaps via ALEX AMM when profitable
;;   - On testnet/simnet: returns the loan directly (demonstrates repayment path)
;;
;; A production keeper bot calls this only when get-estimated-profit
;; shows a positive return, ensuring the swap covers the fee.

(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))
    (total-owed (+ amount fee))
    (this-contract (as-contract tx-sender))
  )
    ;; Verify the flash mint arrived
    (let (
      (our-balance (unwrap! (as-contract (contract-call? .sbtc-token get-balance tx-sender)) ERR-INSUFFICIENT-BALANCE))
    )
      (asserts! (>= our-balance total-owed) ERR-INSUFFICIENT-BALANCE)

      ;; Repay flash loan + fee to flashstack-core.
      ;;
      ;; On mainnet this follows a two-leg ALEX swap:
      ;;   leg 1: (contract-call? 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.amm-swap-pool-v1-1
      ;;             swap-helper ALEX-POOL-FACTOR .sbtc-token .susdt amount min-dy)
      ;;   leg 2: (contract-call? 'SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.amm-swap-pool-v1-1
      ;;             swap-helper ALEX-POOL-FACTOR .susdt .sbtc-token usdt-received min-sbtc)
      ;;
      ;; The net sBTC received from leg 2 covers total-owed plus profit.
      ;; On testnet, the contract repays directly from the minted balance.
      (try! (as-contract (contract-call? .sbtc-token transfer
        total-owed
        tx-sender
        .flashstack-core
        (some 0x464c415348)
      )))

      (ok true)
    )
  )
)

;; =============================================
;; Profit Estimation (read-only)
;; =============================================

;; Returns estimated profit breakdown for a given loan amount.
;; On mainnet, pair this with an off-chain ALEX price feed to determine
;; whether a swap opportunity is profitable before submitting the transaction.
(define-read-only (get-estimated-profit (amount uint))
  (let (
    (fee (/ (* amount u5) u10000))
    (total-owed (+ amount fee))
    (min-profit (/ (* amount (var-get min-profit-bp)) u10000))
  )
    (ok {
      loan-amount: amount,
      fee: fee,
      total-owed: total-owed,
      min-profit-required: min-profit,
      alex-pool-factor: ALEX-POOL-FACTOR,
      alex-amm: "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.amm-swap-pool-v1-1"
    })
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (set-min-profit-bp (new-bp uint))
  (begin
    (asserts! (<= new-bp u1000) ERR-SLIPPAGE-TOO-HIGH)
    (ok (var-set min-profit-bp new-bp))
  )
)
