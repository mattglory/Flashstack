;; FlashStack STX Pool v3 -- Testnet Adversarial Receiver
;;
;; TESTNET ONLY (docs/TESTNET_STAGING.md section 6e, Flashstack-ajv.6.9). Proves
;; flashstack-stx-pool-v3's F-9 reentrancy lock on chain. It deliberately breaks
;; RECEIVER_VETTING item 13 (no reentry); that is the point, and section 6e
;; records why it is safe to publish. Callback modes, chosen by the owner's arm:
;;   u0  honest: repay amount + fee by plain transfer (proves the lock released)
;;   u1  F-9 vector: "repay" by calling the pool's own deposit (amount + fee)
;;   u2  reenter withdraw on the shares seed-deposit bought, then repay
;;   u3  under-repay: return the principal but not the fee
;; Mode u4 of the simnet fixture (nested flash-loan) is left out: the VM aborts
;; it with CircularReference before the lock is reached (section 6e).
;;
;; Pool calls are wrapped in as-contract so they are funded by, and credited to,
;; this contract, and use try! so a blocked reentry surfaces the pool's own
;; ERR-REENTRANT (u411) as the transaction result.
;;
;; Bounded the same way as the honest receiver: the pool is the same-deployer
;; name .flashstack-stx-pool-v3, which on testnet is the locked v3 pool and can
;; never be a live v2 pool. contract-caller gate first (B4), hardcoded repay
;; target (B5), and every state-changing function is owner-only: a stranger can
;; neither call the callback nor start a loan that runs a mode (C7, plus
;; tx-sender == OWNER in the callback, since the pool calls it without
;; as-contract). Rescue is owner-only, to the owner (E17).
;;
;; Not registered in Clarinet.toml, so it is never in the plan
;; `clarinet deployments apply --mainnet` computes. The simnet suite deploys this
;; exact file at runtime (tests/v3-pools-testnet-receivers.test.ts).
;;
;; Clarity version: 3

(impl-trait .stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-constant OWNER tx-sender)
(define-constant POOL .flashstack-stx-pool-v3)

(define-constant ERR-NOT-OWNER   (err u920))
(define-constant ERR-NOT-POOL    (err u921))
(define-constant ERR-NOT-ARMED   (err u922))
(define-constant ERR-FEE-LOOKUP  (err u923))
(define-constant ERR-REPAY       (err u924))
(define-constant ERR-ZERO-AMOUNT (err u925))
(define-constant ERR-BAD-MODE    (err u926))

(define-data-var armed (optional { mode: uint, amount: uint }) none)
(define-data-var seeded-shares uint u0)

;; Owner arms one loan: which mode the callback runs, for exactly this amount.
(define-public (arm (mode uint) (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (asserts! (<= mode u3) ERR-BAD-MODE)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (ok (var-set armed (some { mode: mode, amount: amount })))
  )
)

(define-public (disarm)
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (ok (var-set armed none))
  )
)

;; Buy pool shares outside a loan, so mode u2 has something to withdraw.
(define-public (seed-deposit (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (let ((s (try! (as-contract (contract-call? .flashstack-stx-pool-v3 deposit amount)))))
      (var-set seeded-shares s)
      (ok s)
    )
  )
)

;; Withdraw every share this contract holds, outside a loan (proves the lock
;; is not stuck after the blocked attempts).
(define-public (exit)
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (var-set seeded-shares u0)
    (as-contract (contract-call? .flashstack-stx-pool-v3 withdraw
      (contract-call? .flashstack-stx-pool-v3 get-shares tx-sender)))
  )
)

(define-public (execute-stx-flash (amount uint) (core principal))
  (begin
    (asserts! (is-eq contract-caller POOL) ERR-NOT-POOL)
    (asserts! (is-eq core POOL) ERR-NOT-POOL)
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (let (
      (a       (unwrap! (var-get armed) ERR-NOT-ARMED))
      (m       (get mode a))
      (fee-bp  (unwrap! (contract-call? .flashstack-stx-pool-v3 get-fee-basis-points) ERR-FEE-LOOKUP))
      (raw-fee (/ (* amount fee-bp) u10000))
      (fee     (if (> raw-fee u0) raw-fee u1))
    )
      ;; single-use arm, bound to the exact amount
      (asserts! (is-eq (get amount a) amount) ERR-NOT-ARMED)
      (var-set armed none)
      (if (is-eq m u1)
        (try! (as-contract (contract-call? .flashstack-stx-pool-v3 deposit (+ amount fee))))
        u0)
      (if (is-eq m u2)
        (try! (as-contract (contract-call? .flashstack-stx-pool-v3 withdraw (var-get seeded-shares))))
        u0)
      (if (or (is-eq m u0) (is-eq m u2))
        (unwrap! (as-contract (stx-transfer? (+ amount fee) tx-sender POOL)) ERR-REPAY)
        false)
      (if (is-eq m u3)
        (unwrap! (as-contract (stx-transfer? amount tx-sender POOL)) ERR-REPAY)
        false)
      (ok true)
    )
  )
)

(define-public (rescue-stx (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (as-contract (stx-transfer? amount tx-sender OWNER))
  )
)

(define-read-only (get-armed) (ok (var-get armed)))
(define-read-only (get-seeded-shares) (ok (var-get seeded-shares)))
