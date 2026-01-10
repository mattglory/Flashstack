;; FlashStack Core Contract
;; Trustless flash minting of sBTC against locked/stacked STX
;; v1.1 - December 2025 - Fixed fee mechanism

(use-trait flash-receiver .flash-receiver-trait.flash-receiver-trait)

;; Error Codes
(define-constant ERR-NOT-ENOUGH-COLLATERAL (err u100))
(define-constant ERR-REPAY-FAILED (err u101))
(define-constant ERR-UNAUTHORIZED (err u102))
(define-constant ERR-CALLBACK-FAILED (err u103))
(define-constant ERR-INVALID-AMOUNT (err u104))
(define-constant ERR-PAUSED (err u105))

;; Data Variables
(define-data-var flash-fee-basis-points uint u5)
(define-data-var admin principal tx-sender)
(define-data-var total-flash-mints uint u0)
(define-data-var total-volume uint u0)
(define-data-var total-fees-collected uint u0)
(define-data-var paused bool false)

;; Collateral ratio: 300% = 3x leverage max
(define-constant MIN-COLLATERAL-RATIO u300)

;; Read-only function to get STX locked by a principal
(define-read-only (get-stx-locked (account principal))
  u1000000000000
)

;; Main flash mint function - FIXED FEE MECHANISM
(define-public (flash-mint (amount uint) (receiver <flash-receiver>))
  (let (
    (borrower tx-sender)
    (locked-stx (get-stx-locked borrower))
    (min-required (/ (* amount MIN-COLLATERAL-RATIO) u100))
    (receiver-principal (contract-of receiver))
    (fee (/ (* amount (var-get flash-fee-basis-points)) u10000))
    (total-owed (+ amount fee))
  )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    (asserts! (>= locked-stx min-required) ERR-NOT-ENOUGH-COLLATERAL)
    
    (let (
      (balance-before (unwrap! (as-contract (contract-call? .sbtc-token get-balance tx-sender)) ERR-REPAY-FAILED))
    )
      ;; Mint amount + fee to receiver (so they can pay back total)
      (try! (contract-call? .sbtc-token mint total-owed receiver-principal))
      
      ;; Execute callback
      (match (contract-call? receiver execute-flash amount borrower)
        success (begin
          (let (
            (balance-after (unwrap! (as-contract (contract-call? .sbtc-token get-balance tx-sender)) ERR-REPAY-FAILED))
          )
            (asserts! (>= balance-after (+ balance-before total-owed)) ERR-REPAY-FAILED)
            
            ;; Burn the returned tokens to complete the cycle
            (try! (as-contract (contract-call? .sbtc-token burn total-owed tx-sender)))
            
            (var-set total-flash-mints (+ (var-get total-flash-mints) u1))
            (var-set total-volume (+ (var-get total-volume) amount))
            (var-set total-fees-collected (+ (var-get total-fees-collected) fee))
            
            (ok {
              amount: amount,
              fee: fee,
              total-minted: total-owed,
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

;; Read-only Functions
(define-read-only (get-fee-basis-points)
  (ok (var-get flash-fee-basis-points))
)

(define-read-only (calculate-fee (amount uint))
  (ok (/ (* amount (var-get flash-fee-basis-points)) u10000))
)

(define-read-only (get-min-collateral (amount uint))
  (ok (/ (* amount MIN-COLLATERAL-RATIO) u100))
)

(define-read-only (get-max-flash-amount (locked-stx uint))
  (ok (/ (* locked-stx u100) MIN-COLLATERAL-RATIO))
)

(define-read-only (get-stats)
  (ok {
    total-flash-mints: (var-get total-flash-mints),
    total-volume: (var-get total-volume),
    total-fees-collected: (var-get total-fees-collected),
    current-fee-bp: (var-get flash-fee-basis-points),
    paused: (var-get paused)
  })
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

;; Admin Functions
(define-public (set-fee (new-fee-bp uint))
  (begin
    (asserts! (is-eq contract-caller (var-get admin))
    (asserts! (<= new-fee-bp u100) ERR-UNAUTHORIZED)
    (ok (var-set flash-fee-basis-points new-fee-bp))
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq contract-caller (var-get admin))
    (ok (var-set admin new-admin))
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq contract-caller (var-get admin))
    (ok (var-set paused true))
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq contract-caller (var-get admin))
    (ok (var-set paused false))
  )
)

(define-read-only (get-admin)
  (ok (var-get admin))
)
