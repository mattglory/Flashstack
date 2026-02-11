;; sBTC Token Contract (Flash-Mintable)
;; Simplified SIP-010 fungible token that allows flash minting

;; No external trait needed - implementing SIP-010 standard functions

(define-fungible-token sbtc)

;; Constants
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INSUFFICIENT-BALANCE (err u402))

;; Data Variables
(define-data-var token-uri (optional (string-utf8 256)) (some u"https://sbtc.tech"))
(define-data-var flash-minter principal CONTRACT-OWNER)

;; SIP-010 Functions

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INSUFFICIENT-BALANCE)
    (try! (ft-transfer? sbtc amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name)
  (ok "Stacks Bitcoin")
)

(define-read-only (get-symbol)
  (ok "sBTC")
)

(define-read-only (get-decimals)
  (ok u8)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance sbtc account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply sbtc))
)

(define-read-only (get-token-uri)
  (ok (var-get token-uri))
)

;; Flash Minting Functions

(define-public (mint (amount uint) (recipient principal))
  (begin
    ;; Only flash-minter contract or owner can mint
    ;; Uses contract-caller for flash-minter to support cross-contract calls
    (asserts! (or (is-eq contract-caller (var-get flash-minter))
                   (is-eq tx-sender CONTRACT-OWNER))
              ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INSUFFICIENT-BALANCE)
    (ft-mint? sbtc amount recipient)
  )
)

(define-public (burn (amount uint) (owner principal))
  (begin
    ;; Only flash-minter contract or owner can burn
    ;; Uses contract-caller for flash-minter to support as-contract calls
    (asserts! (or (is-eq contract-caller (var-get flash-minter))
                   (is-eq tx-sender CONTRACT-OWNER))
              ERR-NOT-AUTHORIZED)
    (asserts! (> amount u0) ERR-INSUFFICIENT-BALANCE)
    (ft-burn? sbtc amount owner)
  )
)

;; Admin Functions

(define-public (set-flash-minter (new-minter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ok (var-set flash-minter new-minter))
  )
)

(define-read-only (get-flash-minter)
  (ok (var-get flash-minter))
)
