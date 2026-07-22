;; HK sBTC Real Receiver v1
;;
;; External-developer flash-loan receiver that executes a REAL DEX round-trip on
;; canonical sBTC:
;;   borrow sBTC from flashstack-sbtc-core -> swap sBTC->wSTX on Velar (pool 70) ->
;;   swap wSTX->sBTC back -> repay principal + fee, atomically.
;;
;; This is the sBTC mirror of the Milestone-1 receiver hk-stx-bitflow-receiver-v1.
;; Composition (per Design ADR-S1..S7):
;;   - hk-stx-bitflow-receiver-v1 skeleton : contract-caller gate + absolute
;;       principals + dynamic fee lookup + fail-closed repay + owner rescue +
;;       read-only estimate.
;;   - velar-sbtc-arb-receiver legs        : the proven sBTC->wSTX->sBTC Velar
;;       round-trip (pool 70). The reference exposes a PUBLIC callback with NO
;;       caller gate (velar-sbtc-arb-receiver.clar:47) -- the gate below closes
;;       that direct-drain vector (ADR-S2, non-negotiable).
;;
;; Deployed under an EXTERNAL wallet (not the protocol deployer), so EVERY
;; cross-contract reference is an ABSOLUTE mainnet principal. `.contract` sugar
;; would resolve to THIS deployer and break for an external deploy (M1 ADR-001).
;; The Velar router's token/share-fee-to args are trait_reference params; we pass
;; ABSOLUTE-PRINCIPAL LITERALS there, mirroring the proven velar-sbtc-arb-receiver
;; exactly (literals are what the analyzer resolves for static trait conformance).
;;
;; Objective is NOT profit. It is: external strategy execution + successful flash
;; loan + real DEX interaction + successful repayment. min-out=u1 on both legs lets
;; the swaps clear; the repayment assert and the core's own before/after reserve
;; check are the safety gates. The seed covers the ~0.6% Velar round-trip loss + fee.
;;
;; Live contracts used:
;;   Core:           SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
;;   sBTC token:     SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
;;   Velar router:   SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
;;   wSTX token:     SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
;;   share-fee-to:   SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to
;;   Velar pool 70:  SP20X3DC5R091J8B6YPQT638J8NR1W83KN6TN5BJY.univ2-pool-v1_0_0-0070
;;                   (token0 = wSTX, token1 = sBTC)
;;
;; Clarity version: 3 (epoch 3.0 / Nakamoto)

(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Constants
;; =============================================

(define-constant CONTRACT-OWNER tx-sender)

;; The ONLY legitimate caller of execute-sbtc-flash. Hard-coded (Form A gate).
;; Used in the caller-gate is-eq comparison below.
(define-constant FLASHSTACK-SBTC-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core)

(define-constant ERR-NOT-OWNER    (err u400))
(define-constant ERR-SWAP-LEG1    (err u401))
(define-constant ERR-SWAP-LEG2    (err u402))
(define-constant ERR-WRONG-CALLER (err u403))
(define-constant ERR-FEE-LOOKUP   (err u404))
(define-constant ERR-REPAY-FAILED (err u500))
(define-constant ERR-INSUFFICIENT (err u501))

;; Slippage tolerance in basis points (default 300 = 3%). Retained as an ops knob;
;; the live legs use min-out=u1 and rely on the repayment assert as the safety gate.
(define-data-var slippage-bp uint u300)

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (begin
    ;; Gate: only the live flashstack-sbtc-core may invoke this callback.
    ;; Closes the direct-drain path a public execute-sbtc-flash would otherwise
    ;; expose (the velar-sbtc-arb-receiver reference lacks this).
    (asserts! (is-eq contract-caller FLASHSTACK-SBTC-CORE) ERR-WRONG-CALLER)
    (let (
      ;; Repayment math - look up the fee dynamically (never hard-code u5).
      (fee-bp     (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                    get-fee-basis-points) ERR-FEE-LOOKUP))
      (raw-fee    (/ (* amount fee-bp) u10000))
      (fee        (if (> raw-fee u0) raw-fee u1))
      (total-owed (+ amount fee))
    )
      ;; Leg 1: sBTC -> wSTX on Velar pool 70 (token0=wSTX, token1=sBTC).
      ;; as-contract: the borrowed sBTC sits in THIS contract's balance.
      (unwrap! (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
        swap-exact-tokens-for-tokens
        u70                                                    ;; pool id
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx        ;; token0 (wSTX)
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token1 (sBTC)
        'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token-in  (sBTC)
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx        ;; token-out (wSTX)
        'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to ;; share-fee-to
        amount                                                 ;; amt-in (sBTC sats)
        u1                                                     ;; amt-out-min (accept any)
      )) ERR-SWAP-LEG1)

      ;; How much wSTX did we receive? Swap the entire wSTX balance back.
      (let (
        (wstx-balance (unwrap!
          (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
            get-balance tx-sender))
          ERR-SWAP-LEG2))
      )
        (asserts! (> wstx-balance u0) ERR-SWAP-LEG2)

        ;; Leg 2: wSTX -> sBTC on Velar pool 70.
        (unwrap! (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
          swap-exact-tokens-for-tokens
          u70                                                    ;; pool id
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx        ;; token0 (wSTX)
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token1 (sBTC)
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx        ;; token-in  (wSTX)
          'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token-out (sBTC)
          'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to ;; share-fee-to
          wstx-balance                                           ;; amt-in (all wSTX)
          u1                                                     ;; amt-out-min
        )) ERR-SWAP-LEG2)

        ;; Repay sBTC + fee back to the core. Fail closed if the round-trip + seed
        ;; came up short (no funds at risk - the whole tx reverts).
        (let ((sbtc-now (unwrap!
            (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              get-balance tx-sender))
            ERR-REPAY-FAILED)))
          (asserts! (>= sbtc-now total-owed) ERR-INSUFFICIENT)
          (unwrap!
            (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              transfer total-owed tx-sender core none))
            ERR-REPAY-FAILED)
          (print { event: "sbtc-velar-roundtrip", amount: amount, fee: fee,
                   wstx-mid: wstx-balance, sbtc-after: sbtc-now })
          (ok true)
        )
      )
    )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (set-slippage-bp (new-bp uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (asserts! (<= new-bp u500) ERR-NOT-OWNER) ;; max 5%
    (ok (var-set slippage-bp new-bp))
  )
)

;; Rescue stuck sBTC (owner only) - escape hatch to recover the seed, or any
;; sBTC stranded by a partial round-trip.
(define-public (rescue-sbtc (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap!
      (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer amount tx-sender to none))
      ERR-NOT-OWNER)
    (ok true)
  )
)

;; Rescue stuck wSTX (owner only) - escape hatch if leg 2 ever fails to consume
;; all wSTX (should not happen with min-out=u1, but fail-safe recovery).
(define-public (rescue-wstx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap!
      (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
        transfer amount tx-sender to none))
      ERR-NOT-OWNER)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-slippage-bp)
  (ok (var-get slippage-bp))
)

(define-read-only (get-owner)
  (ok CONTRACT-OWNER)
)

(define-read-only (get-sbtc-balance)
  (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token get-balance (as-contract tx-sender))
)

(define-read-only (get-wstx-balance)
  (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx get-balance (as-contract tx-sender))
)

(define-read-only (estimate-repayment (amount uint))
  (let (
    (fee-bp  (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core get-fee-basis-points)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
  )
    (ok {
      loan-amount: amount,
      fee-to-pay:  fee,
      total-owed:  (+ amount fee),
      note: "sBTC round-trip must return >= total-owed or the tx reverts. Seed covers the ~0.6% Velar round-trip loss + fee."
    })
  )
)
