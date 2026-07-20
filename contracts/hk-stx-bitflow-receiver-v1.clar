;; HK STX Bitflow Receiver v1
;;
;; External-developer flash-loan receiver that executes a REAL DEX round-trip:
;;   borrow STX from flashstack-stx-core -> swap STX->stSTX on Bitflow ->
;;   swap stSTX->STX back -> repay principal + fee, atomically.
;;
;; Deployed under an EXTERNAL wallet (not the protocol deployer), so every
;; cross-contract reference uses the ABSOLUTE mainnet principal. The `.flashstack-stx-core`
;; sugar used by the in-repo bitflow-arb-receiver would resolve to THIS deployer's
;; address and break for an external deploy.
;;
;; Combines:
;;   - hk-stx-real-receiver-v2 : contract-caller gate + absolute principals
;;   - bitflow-arb-receiver-v4 : the STX/stSTX Bitflow round-trip
;;
;; Objective is NOT profit. It is: external strategy execution + successful flash
;; loan + real DEX interaction + successful repayment. The repayment assert and the
;; core's own reserve check are the safety gates; min-out=u1 lets the swaps clear.
;;
;; Live contracts used:
;;   Core:          SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
;;   Bitflow pool:  SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2
;;   stSTX token:   SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token
;;   Bitflow LP:    SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2
;;
;; Clarity version: 3 (epoch 3.0 / Nakamoto)

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; Minimal SIP-010 trait for calling the stSTX token
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

(define-constant CONTRACT-OWNER tx-sender)

;; The ONLY legitimate caller of execute-stx-flash. Hard-coded (Form A gate).
(define-constant FLASHSTACK-STX-CORE 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

(define-constant ERR-NOT-OWNER    (err u400))
(define-constant ERR-SWAP-FAILED  (err u401))
(define-constant ERR-WRONG-CALLER (err u403))
(define-constant ERR-REPAY-FAILED (err u500))

;; Bitflow STX/stSTX stableswap pool
(define-constant BITFLOW-POOL 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2)

;; stSTX SIP-010 token (y-token in the pool)
(define-constant STSTX 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token)

;; Bitflow STX/stSTX LP token (lp-token parameter)
(define-constant BITFLOW-LP 'SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stx-ststx-lp-token-v-1-2)

;; Slippage tolerance in basis points (default 300 = 3%). Retained as an ops knob;
;; the live legs use min-out=u1 and rely on the repayment assert as the safety gate.
(define-data-var slippage-bp uint u300)

;; =============================================
;; Flash Loan Callback
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (begin
    ;; Gate: only the live flashstack-stx-core may invoke this callback.
    ;; Closes the direct-drain path a public execute-stx-flash would otherwise expose.
    (asserts! (is-eq contract-caller FLASHSTACK-STX-CORE) ERR-WRONG-CALLER)
    (let (
      ;; Repayment math - look up the fee dynamically (never hard-code u5).
      (fee-bp     (unwrap! (contract-call? FLASHSTACK-STX-CORE get-fee-basis-points) ERR-SWAP-FAILED))
      (raw-fee    (/ (* amount fee-bp) u10000))
      (fee        (if (> raw-fee u0) raw-fee u1))
      (total-owed (+ amount fee))

      ;; min-out=u1 on both legs - the swap always clears; the repay assert is the gate.
      (min-ststx  u1)
      (min-stx    u1)
    )
      ;; Leg 1: STX -> stSTX on Bitflow.
      ;; as-contract: the borrowed STX sits in THIS contract's balance.
      (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-x-for-y
        STSTX        ;; y-token (stSTX SIP-010)
        BITFLOW-LP   ;; lp-token
        amount       ;; STX in (microSTX)
        min-ststx    ;; min stSTX out
      )) ERR-SWAP-FAILED)

      ;; How much stSTX did we receive?
      (let (
        (ststx-balance (unwrap!
          (contract-call? STSTX get-balance (as-contract tx-sender))
          ERR-SWAP-FAILED))
      )
        (asserts! (> ststx-balance u0) ERR-SWAP-FAILED)

        ;; Leg 2: stSTX -> STX on Bitflow.
        (unwrap! (as-contract (contract-call? BITFLOW-POOL swap-y-for-x
          STSTX
          BITFLOW-LP
          ststx-balance ;; all stSTX we hold
          min-stx       ;; min STX back
        )) ERR-SWAP-FAILED)

        ;; Repay STX + fee back to the core. Fail closed if the round-trip came up short.
        (let ((stx-now (stx-get-balance (as-contract tx-sender))))
          (asserts! (>= stx-now total-owed) ERR-REPAY-FAILED)
          (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)
          (print { event: "bitflow-roundtrip", amount: amount, fee: fee,
                   ststx-mid: ststx-balance, stx-after: stx-now })
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
    (asserts! (<= new-bp u500) ERR-SWAP-FAILED) ;; max 5%
    (ok (var-set slippage-bp new-bp))
  )
)

;; Rescue stuck STX (owner only) - escape hatch if a partial round-trip strands STX.
(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-NOT-OWNER)
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

(define-read-only (estimate-repayment (amount uint))
  (let (
    ;; Literal principal (not the constant) so the analyzer can prove this
    ;; cross-contract call is read-only inside a define-read-only function.
    (fee-bp  (unwrap-panic (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core get-fee-basis-points)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
  )
    (ok {
      loan-amount: amount,
      fee-to-pay:  fee,
      total-owed:  (+ amount fee),
      note: "Round-trip must return >= total-owed or the tx reverts. Seed covers any shortfall."
    })
  )
)
