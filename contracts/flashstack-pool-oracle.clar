;; FlashStack Pool Oracle
;;
;; A read-only oracle wrapper around flashstack-stx-pool.
;; Exposes a clean, manipulation-resistant share price that lending protocols
;; (Zest, ALEX, etc.) can consume as a collateral price feed.
;;
;; Why this is manipulation-resistant:
;;   - Share value = pool_balance / total_shares
;;   - Pool balance only increases (fees flow in, verified by reserve invariant)
;;   - Flash loans cannot inflate the pool: the reserve invariant check inside
;;     flashstack-stx-pool ensures balance grows by >= fee after every loan
;;   - No external price feeds required — purely on-chain, single-asset
;;
;; Integration pattern for lending protocols:
;;   1. Call get-share-price to get current STX value per share (in microstacks)
;;   2. Call get-total-shares to get total supply
;;   3. Use get-lp-value(lp-principal) to get a specific LP's collateral value
;;   4. All values are in microstacks (1 STX = 1,000,000)

;; =============================================
;; Constants
;; =============================================

(define-constant POOL 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool)
(define-constant SHARE-PRECISION u1000000) ;; matches pool contract

;; =============================================
;; Core Price Functions
;; =============================================

;; Returns the current value of one pool share in microstacks.
;; At launch: 1 share = 1 microSTX (1:1)
;; Over time: increases as flash loan fees accumulate
;;
;; Formula: share_price = pool_balance * SHARE_PRECISION / total_shares
;; Result is in microstacks-per-share scaled by SHARE_PRECISION
;; i.e. divide result by 1,000,000 to get microstacks per share
(define-read-only (get-share-price)
  (let (
    (pool-balance (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-pool-balance))
    (total-shares (get total-shares (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-stats))))
  )
    (if (is-eq total-shares u0)
      (ok SHARE-PRECISION) ;; at launch, 1 share = 1 microSTX
      (ok (/ (* pool-balance SHARE-PRECISION) total-shares))
    )
  )
)

;; Returns total shares in circulation
(define-read-only (get-total-shares)
  (get total-shares (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-stats)))
)

;; Returns total pool balance in microstacks
(define-read-only (get-pool-balance)
  (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-pool-balance)
)

;; Returns the STX value of a specific LP's position in microstacks.
;; This is the collateral value a lending protocol should use.
(define-read-only (get-lp-value (lp principal))
  (let (
    (shares       (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-shares lp))
    (pool-balance (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-pool-balance))
    (total-shares (get total-shares (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-stats))))
  )
    (if (or (is-eq total-shares u0) (is-eq shares u0))
      (ok u0)
      (ok (/ (* shares pool-balance) total-shares))
    )
  )
)

;; Returns shares held by a specific LP
(define-read-only (get-lp-shares (lp principal))
  (ok (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-shares lp))
)

;; =============================================
;; Lending Protocol Integration Helpers
;; =============================================

;; Returns a complete snapshot for lending protocol integration:
;;   share-price:    current price per share in microstacks (scaled by 1e6)
;;   total-shares:   total shares in circulation
;;   pool-balance:   total STX in pool (microstacks)
;;   yield-accrued:  total fees earned by pool since launch (microstacks)
;;   is-healthy:     true if pool has funds and is not empty
(define-read-only (get-collateral-snapshot)
  (let (
    (stats        (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-stats)))
    (pool-balance (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool get-pool-balance))
    (total-shares (get total-shares stats))
    (total-fees   (get total-fees stats))
  )
    (ok {
      share-price:   (if (is-eq total-shares u0)
                       SHARE-PRECISION
                       (/ (* pool-balance SHARE-PRECISION) total-shares)),
      total-shares:  total-shares,
      pool-balance:  pool-balance,
      yield-accrued: total-fees,
      total-loans:   (get total-loans stats),
      is-healthy:    (> pool-balance u0),
    })
  )
)
