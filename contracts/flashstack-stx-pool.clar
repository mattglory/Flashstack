;; FlashStack STX Pool — External Liquidity Provider Model
;; Anyone can deposit STX and earn yield from flash loan fees.
;; This is the "mini Aave pool" upgrade to the single-admin reserve model.
;;
;; How it works:
;;   1. LPs deposit STX — they receive pool shares proportional to their deposit
;;   2. Flash loan borrowers pay 0.05% fee per loan
;;   3. Fees accumulate in the pool, increasing share value
;;   4. LPs withdraw STX + accrued yield at any time (pro-rata)
;;
;; Share model (like Aave aTokens):
;;   shares_minted = deposit * total_shares / total_stx
;;   stx_on_withdraw = shares * total_stx / total_shares
;;   As fees accumulate, total_stx grows while shares stay the same
;;   => each share is worth more STX over time
;;
;; Security:
;;   - Flash loans verified: reserve must grow by >= fee after each loan
;;   - Reentrancy-safe: reserve checked after callback returns
;;   - Receiver whitelist: only approved contracts can borrow
;;   - Circuit breaker: pause and max-single-loan limits

(use-trait stx-flash-receiver-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR-NOT-ADMIN            (err u400))
(define-constant ERR-ZERO-AMOUNT          (err u401))
(define-constant ERR-REPAY-FAILED         (err u402))
(define-constant ERR-INSUFFICIENT-RESERVE (err u403))
(define-constant ERR-EXCEEDS-LIMIT        (err u404))
(define-constant ERR-PAUSED               (err u405))
(define-constant ERR-NOT-APPROVED         (err u406))
(define-constant ERR-INVALID-FEE          (err u407))
(define-constant ERR-NO-SHARES            (err u408))
(define-constant ERR-INSUFFICIENT-SHARES  (err u409))

;; =============================================
;; Data vars
;; =============================================

(define-data-var admin              principal CONTRACT-OWNER)
(define-data-var fee-basis-points   uint      u5)           ;; 0.05% default
(define-data-var paused             bool      false)
(define-data-var max-single-loan    uint      u5000000000)  ;; 5,000 STX default
(define-data-var total-shares       uint      u0)
(define-data-var total-loans        uint      u0)
(define-data-var total-volume       uint      u0)
(define-data-var total-fees         uint      u0)

;; Precision multiplier for share calculations (avoids integer rounding)
(define-constant SHARE-PRECISION u1000000)

;; Approved receiver whitelist
(define-map approved-receivers  principal bool)

;; LP shares per depositor
(define-map lp-shares           principal uint)

;; =============================================
;; LP Deposit / Withdraw
;; =============================================

;; Deposit STX into the pool and receive shares
(define-public (deposit (amount uint))
  (let (
    (depositor    tx-sender)
    (pool-balance (stx-get-balance (as-contract tx-sender)))
    (current-shares (var-get total-shares))

    ;; Mint shares proportional to deposit
    ;; First depositor gets amount * SHARE-PRECISION shares
    ;; Subsequent depositors: shares = amount * total_shares / pool_balance
    (new-shares (if (is-eq current-shares u0)
      (* amount SHARE-PRECISION)
      (/ (* amount current-shares) pool-balance)
    ))
  )
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)

    ;; Transfer STX from depositor to pool
    (unwrap! (stx-transfer? amount depositor (as-contract tx-sender)) ERR-REPAY-FAILED)

    ;; Credit shares
    (map-set lp-shares depositor
      (+ (default-to u0 (map-get? lp-shares depositor)) new-shares)
    )
    (var-set total-shares (+ current-shares new-shares))

    (ok new-shares)
  )
)

;; Withdraw STX by burning shares
(define-public (withdraw (shares uint))
  (let (
    (withdrawer       tx-sender)
    (depositor-shares (default-to u0 (map-get? lp-shares withdrawer)))
    (current-shares   (var-get total-shares))
    (pool-balance     (stx-get-balance (as-contract tx-sender)))

    ;; STX owed = shares * pool_balance / total_shares
    (stx-amount (/ (* shares pool-balance) current-shares))
  )
    (asserts! (> shares u0) ERR-ZERO-AMOUNT)
    (asserts! (>= depositor-shares shares) ERR-INSUFFICIENT-SHARES)
    (asserts! (> stx-amount u0) ERR-ZERO-AMOUNT)

    ;; Burn shares
    (map-set lp-shares withdrawer (- depositor-shares shares))
    (var-set total-shares (- current-shares shares))

    ;; Send STX back
    (unwrap! (as-contract (stx-transfer? stx-amount tx-sender withdrawer)) ERR-REPAY-FAILED)

    (ok stx-amount)
  )
)

;; =============================================
;; Flash Loan
;; =============================================

(define-public (flash-loan
    (amount uint)
    (receiver <stx-flash-receiver-trait>)
  )
  (let (
    (receiver-principal (contract-of receiver))
    (raw-fee   (/ (* amount (var-get fee-basis-points)) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (reserve-before (stx-get-balance (as-contract tx-sender)))
  )
    (asserts! (not (var-get paused))                                                    ERR-PAUSED)
    (asserts! (> amount u0)                                                             ERR-ZERO-AMOUNT)
    (asserts! (<= amount (var-get max-single-loan))                                     ERR-EXCEEDS-LIMIT)
    (asserts! (default-to false (map-get? approved-receivers receiver-principal))       ERR-NOT-APPROVED)
    (asserts! (>= reserve-before amount)                                                ERR-INSUFFICIENT-RESERVE)

    ;; Send STX to receiver
    (unwrap! (as-contract (stx-transfer? amount tx-sender receiver-principal)) ERR-REPAY-FAILED)

    ;; Invoke receiver callback
    (try! (contract-call? receiver execute-stx-flash amount (as-contract tx-sender)))

    ;; Verify pool grew by at least the fee — this is the repayment guarantee
    (let ((reserve-after (stx-get-balance (as-contract tx-sender))))
      (asserts! (>= reserve-after (+ reserve-before fee)) ERR-REPAY-FAILED)

      ;; Update stats
      (var-set total-loans  (+ (var-get total-loans) u1))
      (var-set total-volume (+ (var-get total-volume) amount))
      (var-set total-fees   (+ (var-get total-fees) fee))

      ;; Fee stays in pool — automatically increases share value for all LPs

      (ok true)
    )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (add-approved-receiver (receiver principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (ok (map-set approved-receivers receiver true))
  )
)

(define-public (remove-approved-receiver (receiver principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (ok (map-delete approved-receivers receiver))
  )
)

(define-public (set-fee-basis-points (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (and (>= new-fee u1) (<= new-fee u1000)) ERR-INVALID-FEE)
    (ok (var-set fee-basis-points new-fee))
  )
)

(define-public (set-paused (val bool))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (ok (var-set paused val))
  )
)

(define-public (set-max-single-loan (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (ok (var-set max-single-loan amount))
  )
)

(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) ERR-NOT-ADMIN)
    (ok (var-set admin new-admin))
  )
)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-pool-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-read-only (get-shares (lp principal))
  (default-to u0 (map-get? lp-shares lp))
)

;; Calculate current STX value of an LP's shares
(define-read-only (get-stx-value (lp principal))
  (let (
    (shares         (default-to u0 (map-get? lp-shares lp)))
    (current-shares (var-get total-shares))
    (pool-balance   (stx-get-balance (as-contract tx-sender)))
  )
    (if (or (is-eq current-shares u0) (is-eq shares u0))
      u0
      (/ (* shares pool-balance) current-shares)
    )
  )
)

(define-read-only (get-stats)
  (ok {
    pool-balance:      (stx-get-balance (as-contract tx-sender)),
    total-shares:      (var-get total-shares),
    total-loans:       (var-get total-loans),
    total-volume:      (var-get total-volume),
    total-fees:        (var-get total-fees),
    fee-basis-points:  (var-get fee-basis-points),
    paused:            (var-get paused),
    max-single-loan:   (var-get max-single-loan),
  })
)

(define-read-only (get-fee-basis-points)
  (ok (var-get fee-basis-points))
)

(define-read-only (is-approved-receiver (receiver principal))
  (default-to false (map-get? approved-receivers receiver))
)

(define-read-only (calculate-fee (amount uint))
  (let ((raw-fee (/ (* amount (var-get fee-basis-points)) u10000)))
    (ok (if (> raw-fee u0) raw-fee u1))
  )
)

(define-read-only (get-admin)
  (ok (var-get admin))
)
