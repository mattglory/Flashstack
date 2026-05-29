;; flashstack-yield-vault.clar
;;
;; Auto-compounding STX vault powered by FlashStack flash loans.
;;
;; Users deposit STX and receive vault shares. A keeper triggers a flash loan
;; on flashstack-stx-core with this vault as the receiver. The callback runs
;; a Bitflow STX/stSTX round-trip arb, repays the loan, and keeps the spread
;; in the vault -- increasing the STX value of every share.
;;
;; Flow:
;;   deposit(amount)   -- mint shares at current price
;;   withdraw(shares)  -- burn shares, receive STX + accumulated yield
;;
;;   To compound (keeper script):
;;     call flash-loan(loan-amount, .flashstack-yield-vault) on flashstack-stx-core
;;     -> core sends STX here, calls execute-stx-flash
;;     -> arb runs, loan repaid, spread stays in vault
;;     -> share price increases
;;
;; Share price = vault_balance * PRECISION / total_shares
;; Monotonically non-decreasing: the callback reverts if spread < flash fee.
;;
;; Depositor protection: at the start of execute-stx-flash the vault holds
;; (depositor_funds + amount). By computing pre-bal = start_bal - amount we
;; recover the depositor balance without any external snapshot. The check
;; stx-now >= pre-bal + total-owed reduces to spread >= fee, guaranteeing
;; depositor principal is never consumed by an unprofitable compound cycle.
;;
;; This contract implements stx-flash-receiver-trait.
;; It must be whitelisted in flashstack-stx-core (add-approved-receiver).
;;
;; Live contracts:
;;   flashstack-stx-core: SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
;;   Bitflow pool:        SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2
;;   stSTX token:         SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; Inline sip-010 trait -- required for contract-call? to ststx-token
(define-trait sip-010-trait
  (
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)

;; =============================================
;; Constants
;; =============================================

(define-constant VAULT-OWNER     tx-sender)
(define-constant SHARE-PRECISION u1000000)  ;; 1 share = 1,000,000 units; matches microSTX scale
(define-constant MIN-DEPOSIT     u1000000)  ;; 1 STX minimum deposit

(define-constant ERR-NOT-OWNER           (err u400))
(define-constant ERR-SWAP-FAILED         (err u401))
(define-constant ERR-NO-PROFIT           (err u402))
(define-constant ERR-REPAY-FAILED        (err u403))
(define-constant ERR-NOT-CORE            (err u404))
(define-constant ERR-PAUSED              (err u405))
(define-constant ERR-MIN-DEPOSIT         (err u406))
(define-constant ERR-ZERO-SHARES         (err u407))
(define-constant ERR-INSUFFICIENT-SHARES (err u408))
(define-constant ERR-ZERO-AMOUNT         (err u409))

;; Bitflow STX/stSTX stableswap pool
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)
;; stSTX SIP-010 token (y-token in the Bitflow pool)
(define-constant STSTX         'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)
;; Bitflow LP token (required as parameter by the pool interface)
(define-constant BITFLOW-LP    'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; =============================================
;; State
;; =============================================

(define-data-var total-shares        uint u0)
(define-data-var paused              bool false)
(define-data-var total-compounded    uint u0)   ;; lifetime net yield deposited to vault
(define-data-var compound-count      uint u0)
(define-data-var last-compound-block uint u0)

;; Shares per depositor
(define-map user-shares principal uint)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-vault-balance)
  (stx-get-balance (as-contract tx-sender))
)

;; Current STX value per share, scaled by SHARE-PRECISION.
;; Returns SHARE-PRECISION (1:1) before any deposits.
(define-read-only (get-share-price)
  (let ((shares (var-get total-shares))
        (bal    (get-vault-balance)))
    (if (> shares u0)
      (/ (* bal SHARE-PRECISION) shares)
      SHARE-PRECISION)
  )
)

(define-read-only (get-user-shares (user principal))
  (default-to u0 (map-get? user-shares user))
)

;; Current STX value of a user's position (principal + accrued yield).
(define-read-only (get-user-stx-value (user principal))
  (let ((user-sh  (get-user-shares user))
        (total-sh (var-get total-shares))
        (bal      (get-vault-balance)))
    (if (or (is-eq total-sh u0) (is-eq user-sh u0))
      u0
      (/ (* user-sh bal) total-sh))
  )
)

(define-read-only (get-stats)
  (ok {
    vault-balance:        (get-vault-balance),
    total-shares:         (var-get total-shares),
    share-price:          (get-share-price),
    total-compounded:     (var-get total-compounded),
    compound-count:       (var-get compound-count),
    last-compound-block:  (var-get last-compound-block),
    paused:               (var-get paused),
  })
)

;; =============================================
;; Deposit / Withdraw
;; =============================================

;; Deposit STX and receive vault shares.
;; Shares minted = amount * total_shares / vault_balance (or 1:1 for first depositor).
(define-public (deposit (amount uint))
  (let (
    (depositor  tx-sender)
    (vault-bal  (get-vault-balance))
    (total-sh   (var-get total-shares))
    (new-shares (if (is-eq total-sh u0)
      (* amount SHARE-PRECISION)
      (/ (* amount total-sh) vault-bal)
    ))
  )
    (asserts! (not (var-get paused)) ERR-PAUSED)
    (asserts! (>= amount MIN-DEPOSIT) ERR-MIN-DEPOSIT)
    (asserts! (> new-shares u0) ERR-ZERO-SHARES)

    (try! (stx-transfer? amount depositor (as-contract tx-sender)))
    (map-set user-shares depositor (+ (get-user-shares depositor) new-shares))
    (var-set total-shares (+ total-sh new-shares))

    (ok new-shares)
  )
)

;; Burn shares and receive proportional STX (principal + accrued yield).
;; STX returned = shares * vault_balance / total_shares
(define-public (withdraw (shares uint))
  (let (
    (withdrawer tx-sender)
    (user-sh    (get-user-shares withdrawer))
    (total-sh   (var-get total-shares))
    (vault-bal  (get-vault-balance))
    (stx-out    (/ (* shares vault-bal) total-sh))
  )
    (asserts! (not (var-get paused))   ERR-PAUSED)
    (asserts! (> shares u0)            ERR-ZERO-AMOUNT)
    (asserts! (>= user-sh shares)      ERR-INSUFFICIENT-SHARES)
    (asserts! (> stx-out u0)           ERR-ZERO-AMOUNT)

    (map-set user-shares withdrawer (- user-sh shares))
    (var-set total-shares (- total-sh shares))
    (try! (as-contract (stx-transfer? stx-out tx-sender withdrawer)))

    (ok stx-out)
  )
)

;; =============================================
;; Flash Loan Callback (called by flashstack-stx-core)
;; =============================================
;;
;; To trigger a compound cycle, the keeper calls:
;;   flash-loan(loan-amount, .flashstack-yield-vault) on flashstack-stx-core
;; The core sends loan-amount STX here then calls this function.
;;
;; Depositor protection math:
;;   At callback entry: vault holds (depositor_funds + amount)
;;   pre-bal = stx-get-balance - amount = depositor_funds
;;   After arb: stx-now = depositor_funds + amount + spread
;;   Check: stx-now >= pre-bal + total-owed
;;     i.e: depositor_funds + amount + spread >= depositor_funds + amount + fee
;;     i.e: spread >= fee
;;   This guarantees depositor principal is never eroded.

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    ;; Depositor balance = total vault balance minus the just-arrived flash loan.
    ;; Core sends (amount) STX to this contract before calling execute-stx-flash,
    ;; so stx-get-balance at this point = depositor_funds + amount.
    (start-bal  (stx-get-balance (as-contract tx-sender)))
    (pre-bal    (- start-bal amount))

    ;; Fee rate fetched dynamically -- never hardcode
    (fee-bp     (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee    (/ (* amount fee-bp) u10000))
    (fee        (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
  )
    ;; Only flashstack-stx-core may invoke this callback.
    ;; Prevents direct calls attempting to drain vault funds via the swap legs.
    (asserts! (is-eq contract-caller .flashstack-stx-core) ERR-NOT-CORE)
      ;; Leg 1: STX -> stSTX on Bitflow
      ;; Only the flash-borrowed amount is swapped -- depositor funds are untouched.
      ;; as-contract required: STX is in the contract's balance, not the tx-sender's.
      ;; min-ststx = u1: the profitability check below is the actual safety gate.
      (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-x-for-y
        STSTX
        BITFLOW-LP
        amount
        u1
      )) ERR-SWAP-FAILED)

      ;; Read stSTX balance after leg 1
      (let ((ststx-bal (unwrap!
            (contract-call? STSTX get-balance (as-contract tx-sender))
            ERR-SWAP-FAILED)))
        (asserts! (> ststx-bal u0) ERR-SWAP-FAILED)

        ;; Leg 2: stSTX -> STX on Bitflow
        (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-y-for-x
          STSTX
          BITFLOW-LP
          ststx-bal
          u1
        )) ERR-SWAP-FAILED)

        ;; Enforce: spread >= fee (protects depositor principal)
        (let ((stx-now (stx-get-balance (as-contract tx-sender))))
          (asserts! (>= stx-now (+ pre-bal total-owed)) ERR-NO-PROFIT)

          ;; Repay principal + fee to flashstack-stx-core
          (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)

          ;; Net yield = vault balance after repayment minus original depositor balance.
          ;; This STX stays in the vault -- share price increases for all depositors.
          (let ((net-yield (- (stx-get-balance (as-contract tx-sender)) pre-bal)))
            (var-set total-compounded    (+ (var-get total-compounded) net-yield))
            (var-set compound-count      (+ (var-get compound-count) u1))
            (var-set last-compound-block stacks-block-height)
            (ok true)
          )
        )
      )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (set-paused (val bool))
  (begin
    (asserts! (is-eq tx-sender VAULT-OWNER) ERR-NOT-OWNER)
    (ok (var-set paused val))
  )
)

;; Emergency rescue for stuck STX (owner only).
(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender VAULT-OWNER) ERR-NOT-OWNER)
    (try! (as-contract (stx-transfer? amount tx-sender to)))
    (ok true)
  )
)
