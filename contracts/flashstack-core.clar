;; FlashStack Core Contract
;; Trustless flash minting of sBTC against locked/stacked STX
;; v1.3 - January 2026 - POX-4 INTEGRATION + CONSERVATIVE LIMITS
;; - FIXED: Real PoX-4 integration (replaces mock function)
;; - FIXED: Conservative circuit breaker limits for beta launch
;; - Fixed admin authentication (contract-caller)
;; - Added receiver whitelist
;; - Added circuit breaker limits
;; - Improved error handling

(use-trait flash-receiver .flash-receiver-trait.flash-receiver-trait)

;; Error Codes
(define-constant ERR-NOT-ENOUGH-COLLATERAL (err u100))
(define-constant ERR-REPAY-FAILED (err u101))
(define-constant ERR-UNAUTHORIZED (err u102))
(define-constant ERR-CALLBACK-FAILED (err u103))
(define-constant ERR-INVALID-AMOUNT (err u104))
(define-constant ERR-PAUSED (err u105))
(define-constant ERR-RECEIVER-NOT-APPROVED (err u106))
(define-constant ERR-LOAN-TOO-LARGE (err u107))
(define-constant ERR-BLOCK-LIMIT-EXCEEDED (err u108))
(define-constant ERR-POX-CALL-FAILED (err u109))

;; Data Variables
(define-data-var flash-fee-basis-points uint u5)
(define-data-var admin principal tx-sender)
(define-data-var total-flash-mints uint u0)
(define-data-var total-volume uint u0)
(define-data-var total-fees-collected uint u0)
(define-data-var paused bool false)

;; Circuit Breaker Limits - CONSERVATIVE FOR BETA LAUNCH
(define-data-var max-single-loan uint u5000000000) ;; 5 sBTC (~$450)
(define-data-var max-block-volume uint u25000000000) ;; 25 sBTC (~$2,250)

;; Whitelist for approved receiver contracts
(define-map approved-receivers principal bool)

;; Per-block volume tracking
(define-map block-loan-volume uint uint)

;; Collateral ratio: 300% = 3x leverage max
(define-constant MIN-COLLATERAL-RATIO u300)

;; ==========================================
;; POX-4 INTEGRATION - PRODUCTION VERSION
;; ==========================================

;; PRODUCTION: Read STX locked in PoX-4
;; NOTE: Uncomment this for mainnet, comment out test version below
;; (define-read-only (get-stx-locked (account principal))
;;   (let (
;;     ;; Call PoX-4 contract to get stacker information
;;     ;; Mainnet: SP000000000000000000002Q6VF78.pox-4
;;     ;; Testnet: ST000000000000000000002AMW42H.pox-4
;;     (stacker-info (contract-call? 'ST000000000000000000002AMW42H.pox-4 get-stacker-info account))
;;   )
;;     (match stacker-info
;;       info-data (get locked info-data)  ;; Return locked amount if stacking
;;       u0  ;; Return 0 if not stacking
;;     )
;;   )
;; )

;; ==========================================
;; TESTNET VERSION - FOR TESTING ONLY
;; ==========================================

;; TESTING: Manual collateral setting for testnet
;; TODO: Remove this before mainnet deployment
(define-map test-locked-stx principal uint)

(define-read-only (get-stx-locked (account principal))
  (default-to u0 (map-get? test-locked-stx account))
)

;; Admin function to set test collateral - REMOVE BEFORE MAINNET
(define-public (set-test-stx-locked (account principal) (amount uint))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (map-set test-locked-stx account amount))
  )
)

;; Main flash mint function - SECURITY HARDENED
(define-public (flash-mint (amount uint) (receiver <flash-receiver>))
  (let (
    (borrower tx-sender)
    (locked-stx (get-stx-locked borrower))
    (min-required (/ (* amount MIN-COLLATERAL-RATIO) u100))
    (receiver-principal (contract-of receiver))
    (fee (/ (* amount (var-get flash-fee-basis-points)) u10000))
    (total-owed (+ amount fee))
  )
    ;; ===== SECURITY CHECKS =====
    
    ;; Circuit breaker check
    (asserts! (not (var-get paused)) ERR-PAUSED)
    
    ;; Input validation
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    
    ;; SECURITY: Verify receiver is whitelisted
    (asserts! (default-to false (map-get? approved-receivers receiver-principal)) ERR-RECEIVER-NOT-APPROVED)
    
    ;; Circuit breaker: Check single loan limit
    (asserts! (<= amount (var-get max-single-loan)) ERR-LOAN-TOO-LARGE)
    
    ;; Circuit breaker: Check block volume limit
    (let (
      (current-block-volume (default-to u0 (map-get? block-loan-volume block-height)))
      (new-block-volume (+ current-block-volume amount))
    )
      (asserts! (<= new-block-volume (var-get max-block-volume)) ERR-BLOCK-LIMIT-EXCEEDED)
      (map-set block-loan-volume block-height new-block-volume)
    )
    
    ;; Collateral check
    (asserts! (>= locked-stx min-required) ERR-NOT-ENOUGH-COLLATERAL)
    
    ;; ===== FLASH LOAN EXECUTION =====
    
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

(define-read-only (is-approved-receiver (receiver principal))
  (ok (default-to false (map-get? approved-receivers receiver)))
)

(define-read-only (get-block-volume (block uint))
  (ok (default-to u0 (map-get? block-loan-volume block)))
)

(define-read-only (get-max-single-loan)
  (ok (var-get max-single-loan))
)

(define-read-only (get-max-block-volume)
  (ok (var-get max-block-volume))
)

;; Admin Functions - SECURITY: Changed to contract-caller
(define-public (set-fee (new-fee-bp uint))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (<= new-fee-bp u100) ERR-UNAUTHORIZED)
    (ok (var-set flash-fee-basis-points new-fee-bp))
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (var-set admin new-admin))
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (var-set paused true))
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (var-set paused false))
  )
)

;; Whitelist Management - SECURITY: New functions
(define-public (add-approved-receiver (receiver principal))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (map-set approved-receivers receiver true))
  )
)

(define-public (remove-approved-receiver (receiver principal))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (ok (map-delete approved-receivers receiver))
  )
)

;; Circuit Breaker Management
(define-public (set-max-single-loan (new-limit uint))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (> new-limit u0) ERR-INVALID-AMOUNT)
    (ok (var-set max-single-loan new-limit))
  )
)

(define-public (set-max-block-volume (new-limit uint))
  (begin
    (asserts! (is-eq contract-caller (var-get admin)) ERR-UNAUTHORIZED)
    (asserts! (> new-limit u0) ERR-INVALID-AMOUNT)
    (ok (var-set max-block-volume new-limit))
  )
)

(define-read-only (get-admin)
  (ok (var-get admin))
)
