;; FlashStack Core - Fixed Fee Version
;; Mints amount + fee so receiver can pay back

(define-public (flash-mint (amount uint) (receiver <flash-receiver>))
  (let (
    (borrower tx-sender)
    (locked-stx (get-stx-locked borrower))
    (min-required (/ (* amount MIN-COLLATERAL-RATIO) u100))
    (receiver-principal (contract-of receiver))
    (fee (/ (* amount (var-get flash-fee-basis-points)) u10000))
    (total-amount (+ amount fee))  ;; Mint extra for fee
  )
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= locked-stx min-required) ERR-NOT-ENOUGH-COLLATERAL)
    
    (let (
      (balance-before (unwrap! (as-contract (contract-call? .sbtc-token get-balance tx-sender)) ERR-REPAY-FAILED))
    )
      ;; Mint amount + fee to receiver
      (try! (contract-call? .sbtc-token mint total-amount receiver-principal))
      
      ;; Execute callback
      (match (contract-call? receiver execute-flash amount borrower)
        success (begin
          (let (
            (balance-after (unwrap! (as-contract (contract-call? .sbtc-token get-balance tx-sender)) ERR-REPAY-FAILED))
          )
            ;; Verify we got amount + fee back
            (asserts! (>= balance-after (+ balance-before total-amount)) ERR-REPAY-FAILED)
            
            ;; Update stats
            (var-set total-flash-mints (+ (var-get total-flash-mints) u1))
            (var-set total-volume (+ (var-get total-volume) amount))
            (var-set total-fees-collected (+ (var-get total-fees-collected) fee))
            
            (ok {
              amount: amount,
              fee: fee,
              borrower: borrower,
              flash-mint-id: (var-get total-flash-mints)
            })
          )
        )
        error ERR-CALLBACK-FAILED
      )
    )
  )
)