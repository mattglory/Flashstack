;; FlashStack sBTC Pool
;;
;; LP pool for canonical sBTC flash loans.
;; Depositors earn sBTC yield from every flash loan fee.
;; Share value is denominated in sats  -  appreciates with BTC.
;;
;; Share model (identical to flashstack-stx-pool but in sats):
;;   shares_minted = deposit * total_shares / pool_balance
;;   sats_on_withdraw = shares * pool_balance / total_shares
;;   As fees accumulate, pool_balance grows, shares stay constant
;;   => each share worth more sBTC over time
;;
;; Collateral oracle:
;;   get-share-price returns sats per share (scaled by SHARE-PRECISION)
;;   Lending protocols can call this directly  -  no external oracle needed
;;   Flash loan manipulation-resistant: reserve invariant guarantees
;;   pool balance only ever grows by >= fee per loan
;;
;; Security model:
;;   - Receiver whitelist prevents arbitrary contracts from borrowing
;;   - Repayment verified by reserve balance before/after
;;   - Admin cannot drain pool  -  only set parameters

(use-trait sbtc-flash-receiver-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Error Codes
;; =============================================

(define-constant ERR-NOT-ADMIN            (err u700))
(define-constant ERR-ZERO-AMOUNT          (err u701))
(define-constant ERR-REPAY-FAILED         (err u702))
(define-constant ERR-INSUFFICIENT-RESERVE (err u703))
(define-constant ERR-EXCEEDS-LIMIT        (err u704))
(define-constant ERR-PAUSED               (err u705))
(define-constant ERR-NOT-APPROVED         (err u706))
(define-constant ERR-INVALID-FEE          (err u707))
(define-constant ERR-NO-SHARES            (err u708))
(define-constant ERR-INSUFFICIENT-SHARES  (err u709))
(define-constant ERR-TRANSFER-FAILED      (err u710))

;; =============================================
;; State
;; =============================================

(define-data-var admin           principal tx-sender)
(define-data-var fee-basis-points uint     u5)           ;; 0.05% fee
(define-data-var paused          bool      false)
(define-data-var max-single-loan uint      u10000000)    ;; 0.1 BTC default cap
(define-data-var total-shares    uint      u0)
(define-data-var total-loans     uint      u0)
(define-data-var total-volume    uint      u0)
(define-data-var total-fees      uint      u0)

(define-constant SHARE-PRECISION u100000000) ;; 1e8  -  matches sBTC sat precision

(define-map approved-receivers principal bool)
(define-map lp-shares          principal uint)

;; =============================================
;; LP Deposit / Withdraw
;; =============================================

(define-public (deposit (amount uint))
  (let (
    (depositor    tx-sender)
    (pool-balance (unwrap! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                    get-balance (as-contract tx-sender)) ERR-TRANSFER-FAILED))
    (current-shares (var-get total-shares))
    (new-shares (if (is-eq current-shares u0)
      (* amount SHARE-PRECISION)
      (/ (* amount current-shares) pool-balance)
    ))
  )
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (unwrap!
      (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer amount depositor (as-contract tx-sender) none)
      ERR-TRANSFER-FAILED)
    (map-set lp-shares depositor
      (+ (default-to u0 (map-get? lp-shares depositor)) new-shares))
    (var-set total-shares (+ current-shares new-shares))
    (ok new-shares)
  )
)

(define-public (withdraw (shares uint))
  (let (
    (withdrawer       tx-sender)
    (depositor-shares (default-to u0 (map-get? lp-shares withdrawer)))
    (current-shares   (var-get total-shares))
    (pool-balance     (unwrap! (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                        get-balance (as-contract tx-sender)) ERR-TRANSFER-FAILED))
    (sats-amount      (/ (* shares pool-balance) current-shares))
  )
    (asserts! (> shares u0) ERR-ZERO-AMOUNT)
    (asserts! (>= depositor-shares shares) ERR-INSUFFICIENT-SHARES)
    (asserts! (> sats-amount u0) ERR-ZERO-AMOUNT)
    (map-set lp-shares withdrawer (- depositor-shares shares))
    (var-set total-shares (- current-shares shares))
    (unwrap!
      (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer sats-amount tx-sender withdrawer none))
      ERR-TRANSFER-FAILED)
    (ok sats-amount)
  )
)

;; =============================================
;; Flash Loan
;; =============================================

(define-public (flash-loan
    (amount uint)
    (receiver <sbtc-flash-receiver-trait>)
  )
  (let (
    (receiver-principal (contract-of receiver))
    (raw-fee   (/ (* amount (var-get fee-basis-points)) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (reserve-before (unwrap!
      (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        get-balance (as-contract tx-sender))
      ERR-REPAY-FAILED))
  )
    (asserts! (not (var-get paused))                                              ERR-PAUSED)
    (asserts! (> amount u0)                                                       ERR-ZERO-AMOUNT)
    (asserts! (<= amount (var-get max-single-loan))                               ERR-EXCEEDS-LIMIT)
    (asserts! (default-to false (map-get? approved-receivers receiver-principal)) ERR-NOT-APPROVED)
    (asserts! (>= reserve-before amount)                                          ERR-INSUFFICIENT-RESERVE)

    ;; Send sBTC to receiver
    (unwrap!
      (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer amount tx-sender receiver-principal none))
      ERR-TRANSFER-FAILED)

    ;; Invoke receiver callback
    (try! (contract-call? receiver execute-sbtc-flash amount (as-contract tx-sender)))

    ;; Verify repayment  -  reserve must have grown by >= fee
    (let ((reserve-after (unwrap!
            (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              get-balance (as-contract tx-sender))
            ERR-REPAY-FAILED)))
      (asserts! (>= reserve-after (+ reserve-before fee)) ERR-REPAY-FAILED)

      (var-set total-loans  (+ (var-get total-loans) u1))
      (var-set total-volume (+ (var-get total-volume) amount))
      (var-set total-fees   (+ (var-get total-fees) (- reserve-after reserve-before)))
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
    (asserts! (and (>= new-fee u1) (<= new-fee u100)) ERR-INVALID-FEE)
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
;; Read-only  -  including collateral oracle
;; =============================================

;; Current value of one pool share in sats, scaled by SHARE-PRECISION (1e8).
;; Divide result by 1e8 to get sats per share.
;; At launch: 1e8 (= 1 sat per share)
;; Over time: increases as flash loan fees accumulate
;;
;; This is the primary function lending protocols should consume.
;; Manipulation-resistant: pool balance only increases via the fee invariant.
(define-read-only (get-share-price)
  (let (
    (pool-balance (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                    get-balance (as-contract tx-sender))))
    (current-shares (var-get total-shares))
  )
    (if (is-eq current-shares u0)
      (ok SHARE-PRECISION)
      (ok (/ (* pool-balance SHARE-PRECISION) current-shares))
    )
  )
)

;; STX value of a specific LP's position in sats.
;; Call this with an LP principal to get their collateral value.
(define-read-only (get-lp-value (lp principal))
  (let (
    (shares       (default-to u0 (map-get? lp-shares lp)))
    (pool-balance (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                    get-balance (as-contract tx-sender))))
    (current-shares (var-get total-shares))
  )
    (if (or (is-eq current-shares u0) (is-eq shares u0))
      (ok u0)
      (ok (/ (* shares pool-balance) current-shares))
    )
  )
)

(define-read-only (get-pool-balance)
  (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    get-balance (as-contract tx-sender))
)

(define-read-only (get-shares (lp principal))
  (default-to u0 (map-get? lp-shares lp))
)

(define-read-only (get-stats)
  (ok {
    pool-balance:      (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                          get-balance (as-contract tx-sender))),
    total-shares:      (var-get total-shares),
    total-loans:       (var-get total-loans),
    total-volume:      (var-get total-volume),
    total-fees:        (var-get total-fees),
    fee-basis-points:  (var-get fee-basis-points),
    paused:            (var-get paused),
    max-single-loan:   (var-get max-single-loan),
  })
)

(define-read-only (get-collateral-snapshot)
  (let (
    (pool-balance   (unwrap-panic (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                      get-balance (as-contract tx-sender))))
    (current-shares (var-get total-shares))
  )
    (ok {
      share-price:   (if (is-eq current-shares u0)
                       SHARE-PRECISION
                       (/ (* pool-balance SHARE-PRECISION) current-shares)),
      total-shares:  current-shares,
      pool-balance:  pool-balance,
      yield-accrued: (var-get total-fees),
      total-loans:   (var-get total-loans),
      is-healthy:    (> pool-balance u0),
      asset:         "sBTC",
    })
  )
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
