;; Arkadiko Liquidation Receiver
;; Uses FlashStack STX flash loans to liquidate undercollateralized Arkadiko vaults.
;;
;; How it works:
;;   1. Someone calls execute-stx-flash with: amount=debt, owner=vault-owner, token=collateral
;;   2. We receive STX from FlashStack
;;   3. We call arkadiko-vaults-manager.liquidate-vault - this burns USDA debt and sends
;;      us the STX collateral at a discount (liquidation bonus)
;;   4. We repay FlashStack principal + 0.05% fee from the collateral received
;;   5. We keep the difference as profit
;;
;; Profit formula:
;;   collateral_received = debt_stx * (1 + liquidation_bonus%)
;;   profit = collateral_received - (debt_stx + flashstack_fee)
;;
;; Arkadiko contracts (mainnet):
;;   Deployer:      SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR
;;   vaults-manager: ...arkadiko-vaults-manager-v1-2
;;   vaults-tokens:  ...arkadiko-vaults-tokens-v1-1
;;   vaults-data:    ...arkadiko-vaults-data-v1-1
;;   vaults-sorted:  ...arkadiko-vaults-sorted-v1-1
;;   pool-active:    ...arkadiko-vaults-pool-active-v1-1
;;   pool-liq:       ...arkadiko-vaults-pool-liq-v1-2
;;   helpers:        ...arkadiko-vaults-helpers-v1-1
;;   oracle:         ...arkadiko-oracle-v2-3
;;   USDA token:     ...arkadiko-token (governance/USDA)

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

;; =============================================
;; Traits
;; =============================================

(define-trait vaults-manager-trait
  (
    (liquidate-vault
      (<vaults-tokens-trait>
       <vaults-data-trait>
       <vaults-sorted-trait>
       <vaults-pool-active-trait>
       <vaults-pool-liq-trait>
       <vaults-helpers-trait>
       <oracle-trait>
       principal
       <ft-trait>)
      (response bool uint))
  )
)

(define-trait vaults-tokens-trait
  (
    (get-minimum-valid-signers () (response uint uint))
  )
)

(define-trait vaults-data-trait
  (
    (get-vault (principal principal) (response {collateral: uint, debt: uint, status: (string-ascii 10)} uint))
  )
)

(define-trait vaults-sorted-trait
  (
    (get-redemption-block-last () (response uint uint))
  )
)

(define-trait vaults-pool-active-trait
  (
    (get-shutdown-activated () (response bool uint))
  )
)

(define-trait vaults-pool-liq-trait
  (
    (get-shutdown-activated () (response bool uint))
  )
)

(define-trait vaults-helpers-trait
  (
    (get-collateral-for-liquidation (<vaults-tokens-trait> <oracle-trait> principal uint uint) (response {collateral: uint, fee: uint} uint))
  )
)

(define-trait oracle-trait
  (
    (get-price ((string-ascii 12)) (response {last-price: uint, last-block: uint} uint))
  )
)

(define-trait ft-trait
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

(define-constant ERR-NOT-OWNER       (err u600))
(define-constant ERR-NOT-CORE        (err u601))
(define-constant ERR-LIQUIDATION     (err u602))
(define-constant ERR-REPAY-FAILED    (err u603))
(define-constant ERR-NO-PROFIT       (err u604))
(define-constant ERR-WRONG-CALLER    (err u605))

;; Arkadiko mainnet contracts
(define-constant ARKADIKO            'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR)
(define-constant VAULTS-MANAGER      'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-manager-v1-2)
(define-constant VAULTS-TOKENS       'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-tokens-v1-1)
(define-constant VAULTS-DATA         'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-data-v1-1)
(define-constant VAULTS-SORTED       'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-sorted-v1-1)
(define-constant POOL-ACTIVE         'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-pool-active-v1-1)
(define-constant POOL-LIQ            'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-pool-liq-v1-2)
(define-constant VAULTS-HELPERS      'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-helpers-v1-1)
(define-constant ORACLE              'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-oracle-v2-3)
(define-constant STX-TOKEN           'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-vaults-tokens-v1-1)

;; FlashStack STX core
(define-constant FLASHSTACK-CORE     'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core)

;; =============================================
;; Data
;; =============================================

;; Pending liquidation params set before flash loan callback
(define-data-var pending-vault-owner  principal CONTRACT-OWNER)
(define-data-var pending-token        principal CONTRACT-OWNER)
(define-data-var total-liquidations   uint u0)
(define-data-var total-profit-stx     uint u0)

;; =============================================
;; Flash Loan Callback
;; =============================================

;; Called by flashstack-stx-core after sending STX.
;; amount = STX debt to repay at Arkadiko
;; core   = flashstack-stx-core address (repay target)
(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    ;; Calculate what we owe back to FlashStack
    (fee-bp    (unwrap! (contract-call? .flashstack-stx-core get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))

    ;; Who are we liquidating?
    (vault-owner (var-get pending-vault-owner))

    ;; STX balance before liquidation
    (stx-before (stx-get-balance (as-contract tx-sender)))
  )
    ;; Call Arkadiko: liquidate the undercollateralized vault.
    ;; This repays their debt and sends us discounted STX collateral.
    (unwrap! (contract-call? VAULTS-MANAGER liquidate-vault
      VAULTS-TOKENS
      VAULTS-DATA
      VAULTS-SORTED
      POOL-ACTIVE
      POOL-LIQ
      VAULTS-HELPERS
      ORACLE
      vault-owner
      STX-TOKEN
    ) ERR-LIQUIDATION)

    ;; Check we received enough to repay
    (let (
      (stx-after  (stx-get-balance (as-contract tx-sender)))
      (received   (- stx-after stx-before))
    )
      ;; Must have received at least enough to repay
      (asserts! (>= stx-after total-owed) ERR-NO-PROFIT)

      ;; Repay FlashStack
      (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)

      ;; Track stats
      (var-set total-liquidations (+ (var-get total-liquidations) u1))
      (let ((profit (- stx-after total-owed)))
        (var-set total-profit-stx (+ (var-get total-profit-stx) profit))
      )

      (ok true)
    )
  )
)

;; =============================================
;; Entry Point
;; =============================================

;; Call this to initiate a flash-loan-powered liquidation.
;; vault-owner = the Arkadiko user whose vault is undercollateralized
;; amount      = STX amount to borrow (should cover their debt)
(define-public (liquidate
    (vault-owner principal)
    (amount uint)
  )
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)

    ;; Store who to liquidate before the flash loan callback fires
    (var-set pending-vault-owner vault-owner)

    ;; Request flash loan - this triggers execute-stx-flash
    (contract-call? .flashstack-stx-core flash-loan
      amount
      (as-contract tx-sender)
    )
  )
)

;; =============================================
;; Admin
;; =============================================

(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) ERR-REPAY-FAILED)
    (ok true)
  )
)

;; =============================================
;; Read-only
;; =============================================

(define-read-only (get-stats)
  (ok {
    total-liquidations: (var-get total-liquidations),
    total-profit-stx:   (var-get total-profit-stx),
  })
)

;; Check if a vault is liquidatable before spending gas
;; Returns vault data so caller can decide whether to proceed
(define-read-only (check-vault (owner principal))
  (contract-call? VAULTS-DATA get-vault owner VAULTS-TOKENS)
)
