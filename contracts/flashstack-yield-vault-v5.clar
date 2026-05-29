;; flashstack-yield-vault-v5.clar
;;
;; Auto-compounding STX vault powered by FlashStack flash loans.
;; v5 changes vs v4 (audit-driven):
;;   [C-1/C-2] rescue-stx removed — was an unconstrained depositor drain vector
;;   [H-1]     Deposit cooldown (LOCK-BLOCKS) blocks sandwich-deposit attacks
;;   [H-2]     Repayment hardcoded to FLASH-CORE constant — ignores caller-supplied core
;;   [H-3]     Configurable slippage guard (max-slippage-bp) replaces u1 min-dy
;;   [M-1]     vault-owner migrated to data-var with two-step ownership transfer
;;   [M-2]     Withdrawals allowed while paused — only deposits are blocked
;;   [M-4]     ERR-FEE-FETCH added for fee-read failures (was misusing ERR-REPAY-FAILED)
;;   [L-1]     Print events on deposit, withdraw, and compound
;;   [L-2]     BASIS-POINTS constant replaces magic u10000
;;
;; Flow:
;;   deposit(amount)   -- mint shares at current price (subject to LOCK-BLOCKS cooldown)
;;   withdraw(shares)  -- burn shares, receive STX + accumulated yield
;;
;;   To compound (keeper script):
;;     call flash-loan(loan-amount, .flashstack-yield-vault-v5) on flashstack-stx-core
;;     -> core sends STX here, calls execute-stx-flash
;;     -> arb runs, loan repaid to FLASH-CORE (hardcoded), spread stays in vault
;;     -> share price increases for all depositors
;;
;; Share price = vault_balance * PRECISION / total_shares
;; Monotonically non-decreasing: callback reverts if spread < flash fee.
;;
;; Depositor protection: at the start of execute-stx-flash the vault holds
;; (depositor_funds + amount). By computing pre-bal = start_bal - amount we
;; recover the depositor balance without any external snapshot. The check
;; stx-now >= pre-bal + total-owed reduces to spread >= fee, guaranteeing
;; depositor principal is never consumed by an unprofitable compound cycle.

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; Inline sip-010 trait for stSTX balance reads
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

(define-constant BASIS-POINTS     u10000)
(define-constant SHARE-PRECISION  u1000000) ;; 1 share = 1,000,000 units; matches microSTX scale
(define-constant MIN-DEPOSIT      u1000000) ;; 1 STX minimum deposit
(define-constant LOCK-BLOCKS      u10)      ;; blocks between deposit and first withdrawal eligibility

;; Hardcoded flash loan core — repayment never goes to a caller-supplied address
(define-constant FLASH-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

;; Bitflow STX/stSTX stableswap pool
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)
(define-constant STSTX         'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)
(define-constant BITFLOW-LP    'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; Error codes
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
(define-constant ERR-FEE-FETCH           (err u410))
(define-constant ERR-COOLDOWN            (err u411))
(define-constant ERR-NOT-PENDING-OWNER   (err u412))
(define-constant ERR-INVALID-SLIPPAGE    (err u413))

;; =============================================
;; State
;; =============================================

(define-data-var vault-owner         principal tx-sender)
(define-data-var pending-owner       (optional principal) none)
(define-data-var total-shares        uint u0)
(define-data-var paused              bool false)
(define-data-var total-compounded    uint u0)
(define-data-var compound-count      uint u0)
(define-data-var last-compound-block uint u0)
(define-data-var max-slippage-bp     uint u100) ;; 1% default slippage tolerance on swaps

;; Shares per depositor
(define-map user-shares       principal uint)
;; Block at which each user last deposited (for withdrawal cooldown)
(define-map user-deposit-block principal uint)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-vault-balance)
  (stx-get-balance (as-contract tx-sender))
)

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

(define-read-only (get-user-stx-value (user principal))
  (let ((user-sh  (get-user-shares user))
        (total-sh (var-get total-shares))
        (bal      (get-vault-balance)))
    (if (or (is-eq total-sh u0) (is-eq user-sh u0))
      u0
      (/ (* user-sh bal) total-sh))
  )
)

(define-read-only (get-user-withdraw-eligible-block (user principal))
  (+ (default-to u0 (map-get? user-deposit-block user)) LOCK-BLOCKS)
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
    max-slippage-bp:      (var-get max-slippage-bp),
    vault-owner:          (var-get vault-owner),
  })
)

;; =============================================
;; Deposit / Withdraw
;; =============================================

;; Deposit STX and receive vault shares.
;; Records current block for withdrawal cooldown (blocks sandwich-deposit attacks).
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
    (map-set user-shares       depositor (+ (get-user-shares depositor) new-shares))
    (map-set user-deposit-block depositor stacks-block-height)
    (var-set total-shares (+ total-sh new-shares))

    (print { event: "deposit", user: depositor, amount: amount, shares: new-shares, block: stacks-block-height })
    (ok new-shares)
  )
)

;; Burn shares and receive proportional STX.
;; Withdrawals are allowed even when paused — users can always exit.
;; Cooldown: LOCK-BLOCKS must have elapsed since the user's last deposit.
(define-public (withdraw (shares uint))
  (let (
    (withdrawer  tx-sender)
    (user-sh     (get-user-shares withdrawer))
    (total-sh    (var-get total-shares))
    (vault-bal   (get-vault-balance))
    (stx-out     (/ (* shares vault-bal) total-sh))
    (eligible-at (get-user-withdraw-eligible-block withdrawer))
  )
    (asserts! (> shares u0)           ERR-ZERO-AMOUNT)
    (asserts! (>= user-sh shares)     ERR-INSUFFICIENT-SHARES)
    (asserts! (> stx-out u0)          ERR-ZERO-AMOUNT)
    (asserts! (>= stacks-block-height eligible-at) ERR-COOLDOWN)

    (map-set user-shares withdrawer (- user-sh shares))
    (var-set total-shares (- total-sh shares))
    (try! (as-contract (stx-transfer? stx-out tx-sender withdrawer)))

    (print { event: "withdraw", user: withdrawer, shares: shares, stx-out: stx-out, block: stacks-block-height })
    (ok stx-out)
  )
)

;; =============================================
;; Flash Loan Callback (called by flashstack-stx-core)
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (start-bal  (stx-get-balance (as-contract tx-sender)))
    (pre-bal    (- start-bal amount))

    ;; Fee fetched dynamically. ERR-FEE-FETCH on failure (distinct from repayment errors).
    (fee-bp     (unwrap! (contract-call? FLASH-CORE get-fee-basis-points) ERR-FEE-FETCH))
    (raw-fee    (/ (* amount fee-bp) BASIS-POINTS))
    (fee        (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))

    ;; Slippage: min output = amount * (10000 - max-slippage-bp) / 10000
    (slippage-bp (var-get max-slippage-bp))
    (min-ststx   (/ (* amount (- BASIS-POINTS slippage-bp)) BASIS-POINTS))
  )
    ;; Only flashstack-stx-core may invoke this callback
    (asserts! (is-eq contract-caller FLASH-CORE) ERR-NOT-CORE)

    ;; Leg 1: STX -> stSTX on Bitflow (with slippage guard)
    (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-x-for-y
      STSTX BITFLOW-LP amount min-ststx
    )) ERR-SWAP-FAILED)

    (let ((ststx-bal (unwrap!
          (contract-call? STSTX get-balance (as-contract tx-sender))
          ERR-SWAP-FAILED)))
      (asserts! (> ststx-bal u0) ERR-SWAP-FAILED)

      ;; Leg 2: stSTX -> STX on Bitflow (with slippage guard)
      (let ((min-stx-back (/ (* ststx-bal (- BASIS-POINTS slippage-bp)) BASIS-POINTS)))
        (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-y-for-x
          STSTX BITFLOW-LP ststx-bal min-stx-back
        )) ERR-SWAP-FAILED)

        ;; Enforce: spread >= fee (protects depositor principal)
        (let ((stx-now (stx-get-balance (as-contract tx-sender))))
          (asserts! (>= stx-now (+ pre-bal total-owed)) ERR-NO-PROFIT)

          ;; Repay to hardcoded FLASH-CORE — never to caller-supplied core address
          (unwrap! (as-contract (stx-transfer? total-owed tx-sender FLASH-CORE)) ERR-REPAY-FAILED)

          (let ((net-yield (- (stx-get-balance (as-contract tx-sender)) pre-bal)))
            (var-set total-compounded    (+ (var-get total-compounded) net-yield))
            (var-set compound-count      (+ (var-get compound-count) u1))
            (var-set last-compound-block stacks-block-height)

            (print { event: "compound", amount: amount, fee: fee, net-yield: net-yield,
                     compound-count: (var-get compound-count), block: stacks-block-height })
            (ok true)
          )
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
    (asserts! (is-eq tx-sender (var-get vault-owner)) ERR-NOT-OWNER)
    (ok (var-set paused val))
  )
)

;; Slippage tolerance for Bitflow swaps (1–500 bps, i.e. 0.01%–5%).
;; Lower = stricter. Default 100 = 1%.
(define-public (set-max-slippage-bp (bp uint))
  (begin
    (asserts! (is-eq tx-sender (var-get vault-owner)) ERR-NOT-OWNER)
    (asserts! (and (>= bp u1) (<= bp u500)) ERR-INVALID-SLIPPAGE)
    (ok (var-set max-slippage-bp bp))
  )
)

;; Step 1 of two-step ownership transfer: propose a new owner.
(define-public (propose-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get vault-owner)) ERR-NOT-OWNER)
    (ok (var-set pending-owner (some new-owner)))
  )
)

;; Step 2: new owner accepts the role. Prevents accidental lock-out.
(define-public (accept-ownership)
  (let ((pending (unwrap! (var-get pending-owner) ERR-NOT-PENDING-OWNER)))
    (asserts! (is-eq tx-sender pending) ERR-NOT-PENDING-OWNER)
    (var-set vault-owner pending)
    (var-set pending-owner none)
    (ok true)
  )
)
