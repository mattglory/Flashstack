;; SNP-FlashStack Integration Receiver - Minimal Working Version
;; This receiver integrates FlashStack flash loans with SNP yield aggregation
;; Built by Matt Glory - December 2025

(impl-trait .flash-receiver-trait.flash-receiver-trait)

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-VAULT-DEPOSIT-FAILED (err u501))
(define-constant ERR-VAULT-WITHDRAW-FAILED (err u502))
(define-constant ERR-INSUFFICIENT-BALANCE (err u503))
(define-constant ERR-VAULT-LIMIT-REACHED (err u201))
;; Data vars
(define-data-var authorized-vaults (list 10 principal) (list))
(define-data-var contract-owner principal tx-sender)

;; Admin functions
(define-public (authorize-vault (vault principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (var-set authorized-vaults 
      (unwrap! (as-max-len? (append (var-get authorized-vaults) vault) u10) ERR-VAULT-LIMIT-REACHED)
    (ok true)
  )
)

;; Main flash loan execution
(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u50) u100000))
    (total-owed (+ amount fee))
  )
    (asserts! (is-eq contract-caller .flashstack-core) ERR-NOT-AUTHORIZED)
    (try! (optimize-yield amount borrower))
    ;; Return as-contract result directly (like test-receiver)
    (as-contract (contract-call? .sbtc-token transfer 
      total-owed tx-sender .flashstack-core none))
  )
)

;; Yield optimization strategy
(define-private (optimize-yield (flash-amount uint) (user principal))
  (let (
    (withdraw-amount (+ flash-amount (/ (* flash-amount u50) u100000)))
  )
    (try! (mock-deposit flash-amount))
    (try! (mock-withdraw withdraw-amount))
    (ok true)
  )
)

;; Mock functions - replace with real SNP vault calls
(define-private (mock-deposit (amount uint))
  (if (> amount u0)
    (ok true)
    ERR-INSUFFICIENT-BALANCE
  )
)

(define-private (mock-withdraw (amount uint))
  (if (> amount u0)
    (ok true)
    ERR-INSUFFICIENT-BALANCE
  )
)

(define-private (is-authorized-vault (vault principal))
  (is-some (index-of (var-get authorized-vaults) vault))
)

;; Read-only functions
(define-read-only (get-stats)
  {
    authorized-vaults: (var-get authorized-vaults)
  }
)

(define-read-only (calculate-leverage-benefit
    (user-capital uint)
    (leverage uint)
    (vault-apy uint)
    (fee uint))
  (let (
    (total-capital (* user-capital leverage))
    (flash-amount (* user-capital (- leverage u1)))
    (fees (/ (* flash-amount fee) u10000))
    (yield (/ (* total-capital vault-apy) u10000))
    (net (- yield fees))
  )
    {
      capital: user-capital,
      leverage: leverage,
      total: total-capital,
      flash: flash-amount,
      fees: fees,
      yield: yield,
      net: net,
      profitable: (> net u0)
    }
  )
)
