;; FlashStack sBTC Pool v3 -- Testnet Honest Receiver
;;
;; TESTNET ONLY (docs/TESTNET_STAGING.md section 6e, Flashstack-ajv.6.9). Proves
;; flashstack-sbtc-pool-v3's honest flash-loan round trip on chain: borrow, repay
;; principal + fee by a plain sBTC transfer, nothing else.
;;
;; Not registered in Clarinet.toml, so it is never in the plan
;; `clarinet deployments apply --mainnet` computes. The simnet suite deploys this
;; exact file at runtime (tests/v3-pools-testnet-receivers.test.ts), with the
;; sBTC principal pointed at the simnet mock.
;;
;; Built to docs/security/RECEIVER_VETTING.md:
;;   B4  contract-caller must be the pool, checked first, before any state read.
;;   B5  repay goes to the constant POOL; the `core` argument must equal it.
;;   C7  the owner arms one loan amount; the callback requires an exact match and
;;       clears the arm before repaying. The pool calls the receiver without
;;       as-contract, so tx-sender in the callback is whoever called flash-loan:
;;       it must be the owner too, which also closes the window between arm and
;;       flash-loan (a stranger can't front-run an armed amount).
;;   D11 plain SIP-010 transfer to the pool, never deposit.
;;   D12 fee from the pool's own get-fee-basis-points, max(1, floor(...)).
;;   E17 rescue is owner-only, to the owner, nonzero.
;;   E18 N/A: OWNER is a constant (the deployer) with no transfer function.
;;
;; The pool and trait are same-deployer names. The sBTC principal is the
;; mainnet one, which scripts/lib/testnet-localize.mjs rewrites to the testnet
;; equivalent (SN3VMH...) at publish, the same as flashstack-sbtc-pool-v3.
;;
;; Clarity version: 3

(impl-trait .sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

(define-constant OWNER tx-sender)
(define-constant POOL .flashstack-sbtc-pool-v3)

(define-constant ERR-NOT-OWNER   (err u920))
(define-constant ERR-NOT-POOL    (err u921))
(define-constant ERR-NOT-ARMED   (err u922))
(define-constant ERR-FEE-LOOKUP  (err u923))
(define-constant ERR-REPAY       (err u924))
(define-constant ERR-ZERO-AMOUNT (err u925))

(define-data-var armed (optional uint) none)

;; Owner arms exactly one loan amount, then calls flash-loan.
(define-public (arm (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (ok (var-set armed (some amount)))
  )
)

(define-public (disarm)
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (ok (var-set armed none))
  )
)

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (begin
    (asserts! (is-eq contract-caller POOL) ERR-NOT-POOL)
    (asserts! (is-eq core POOL) ERR-NOT-POOL)
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    ;; single-use arm, bound to the exact amount
    (asserts! (is-eq (var-get armed) (some amount)) ERR-NOT-ARMED)
    (var-set armed none)
    (let (
      (fee-bp  (unwrap! (contract-call? .flashstack-sbtc-pool-v3 get-fee-basis-points) ERR-FEE-LOOKUP))
      (raw-fee (/ (* amount fee-bp) u10000))
      (fee     (if (> raw-fee u0) raw-fee u1))
    )
      (unwrap! (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer (+ amount fee) tx-sender POOL none)) ERR-REPAY)
      (ok true)
    )
  )
)

(define-public (rescue-sbtc (amount uint))
  (begin
    (asserts! (is-eq tx-sender OWNER) ERR-NOT-OWNER)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
      transfer amount tx-sender OWNER none))
  )
)

(define-read-only (get-armed) (ok (var-get armed)))
