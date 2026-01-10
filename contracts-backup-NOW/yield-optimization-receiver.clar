;; Yield Optimization Receiver
;; 
;; This receiver demonstrates how to use flash loans to optimize yield
;; by compounding rewards or moving between yield strategies.
;;
;; Use Case: Harvest and compound yield without selling position

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-REWARDS (err u501))
(define-constant ERR-COMPOUND-FAILED (err u502))
(define-constant ERR-REPAYMENT-FAILED (err u503))
(define-constant ERR-STRATEGY-FAILED (err u504))

;; Main flash loan execution for yield optimization
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u5) u10000))  ;; 0.05% FlashStack fee
    (total-owed (+ amount fee))
  )
    ;; Verify this is called by FlashStack
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    
    ;; Step 1: Harvest pending rewards from yield protocol
    (let ((rewards-harvested (unwrap! (mock-harvest-rewards borrower) ERR-COMPOUND-FAILED)))
      
      ;; Step 2: Add flash loaned capital to harvested rewards
      (let ((total-to-compound (+ rewards-harvested amount)))
        
        ;; Step 3: Compound everything back into yield strategy
        (unwrap! (mock-compound-into-strategy total-to-compound borrower) ERR-COMPOUND-FAILED)
        
        ;; Step 4: Borrow back against increased position to repay flash loan
        ;; We can borrow more now because position is larger
        (let ((borrowed-back (unwrap! (mock-borrow-against-position 
                total-owed 
                borrower) ERR-COMPOUND-FAILED)))
          
          ;; Verify we can repay
          (asserts! (>= borrowed-back total-owed) ERR-INSUFFICIENT-REWARDS)
          
          ;; Step 5: Repay flash loan
          (try! (as-contract (contract-call? .sbtc-token transfer 
            total-owed 
            tx-sender
            .flashstack-core
            none
          )))
          
          ;; Success! Position increased by rewards, debt increased minimally
          (ok true)
        )
      )
    )
  )
)

;; Mock functions - Replace with real yield protocol integrations

(define-private (mock-harvest-rewards (user principal))
  ;; In production: Call yield protocol to harvest rewards
  ;; Example: (contract-call? .yield-protocol harvest-rewards)
  (ok u50000000) ;; 0.5 sBTC rewards example
)

(define-private (mock-compound-into-strategy (amount uint) (user principal))
  ;; In production: Reinvest into yield strategy
  ;; Example: (contract-call? .yield-protocol stake amount)
  (ok true)
)

(define-private (mock-borrow-against-position (amount uint) (user principal))
  ;; In production: Borrow against increased position
  ;; Example: (contract-call? .lending-protocol borrow amount)
  (ok amount)
)

;; Read-only functions

(define-read-only (calculate-compound-benefit
    (current-position uint)
    (pending-rewards uint)
    (current-apy uint)  ;; In basis points (500 = 5%)
    (compound-frequency uint)) ;; Times per year
  (let (
    (fee-per-compound (/ (* current-position u50) u10000))
    (total-fees-annual (* fee-per-compound compound-frequency))
    (yield-with-compound (/ (* (+ current-position pending-rewards) 
                              current-apy 
                              compound-frequency) 
                           u10000))
    (yield-without-compound (/ (* current-position current-apy) u10000))
    (additional-yield (- yield-with-compound yield-without-compound))
    (net-benefit (- additional-yield total-fees-annual))
  )
    {
      current-position: current-position,
      pending-rewards: pending-rewards,
      current-apy-bp: current-apy,
      compounds-per-year: compound-frequency,
      fee-per-compound: fee-per-compound,
      total-annual-fees: total-fees-annual,
      yield-with-compounding: yield-with-compound,
      yield-without-compounding: yield-without-compound,
      additional-yield: additional-yield,
      net-annual-benefit: net-benefit,
      is-beneficial: (> net-benefit u0)
    }
  )
)
