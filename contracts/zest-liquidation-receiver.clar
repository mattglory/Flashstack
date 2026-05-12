;; FlashStack - Zest Flash Liquidation Receiver
;; Verified mainnet addresses - 2026-05-12
;;
;; Supports 4 liquidation modes:
;;   1 - STX flash -> wSTX debt + wSTX collateral (no swap)
;;   2 - STX flash -> wSTX debt + sBTC collateral (Velar sBTC->STX swap)
;;   3 - sBTC flash -> sBTC debt + sBTC collateral (no swap)
;;   4 - sBTC flash -> sBTC debt + wSTX collateral (Velar STX->sBTC swap)
;;
;; Usage:
;;   1. Call set-liquidation-target(borrower, debt-amount, mode)
;;   2. Call flashstack-stx-core.flash-loan (modes 1-2) or
;;      flashstack-sbtc-core.flash-loan (modes 3-4)
;;   3. FlashStack calls back execute-stx-flash / execute-sbtc-flash
;;   4. This contract liquidates the Zest position and repays FlashStack
;;
;; Requires: this contract must be whitelisted in both FlashStack and Zest.
;;
;; Zest key: wSTX at SP2VCQJGH...wstx is a thin STX wrapper -
;; its transfer() calls stx-transfer? directly. No wrapping needed.

(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)
(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

;; =============================================
;; Error Codes
;; =============================================

(define-constant ERR-NOT-OWNER    (err u800))
(define-constant ERR-REPAY-FAILED (err u801))
(define-constant ERR-LIQUIDATION  (err u802))
(define-constant ERR-INSUFFICIENT (err u803))
(define-constant ERR-ZERO-AMOUNT  (err u804))
(define-constant ERR-BAD-MODE     (err u806))
(define-constant ERR-SWAP-FAILED  (err u807))

;; =============================================
;; State
;; =============================================

(define-data-var owner           principal tx-sender)
(define-data-var target-borrower principal tx-sender)
(define-data-var target-debt     uint      u0)
;; Mode: 1=wSTX/wSTX  2=wSTX-debt/sBTC-coll  3=sBTC/sBTC  4=sBTC-debt/wSTX-coll
(define-data-var target-mode     uint      u1)

;; =============================================
;; STX Flash Loan Callback (modes 1 and 2)
;; =============================================

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    (borrower (var-get target-borrower))
    (debt-amt (var-get target-debt))
    (mode    (var-get target-mode))
  )
    (asserts! (or (is-eq mode u1) (is-eq mode u2)) ERR-BAD-MODE)

    (if (is-eq mode u1)

      ;;  Mode 1: wSTX debt + wSTX collateral 
      ;; Zest wSTX is a thin STX wrapper: no swap needed, just check STX balance.
      (begin
        (unwrap!
          (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3
            liquidation-call
            (list
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
              { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
              { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
              { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
              { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
            )
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0          ;; collateral-lp
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx                 ;; collateral
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx                 ;; debt-asset
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; collateral-oracle
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; debt-oracle
            borrower debt-amt false
          ))
          ERR-LIQUIDATION)
        (let ((bal (stx-get-balance (as-contract tx-sender))))
          (asserts! (>= bal owed) ERR-INSUFFICIENT)
          (unwrap! (as-contract (stx-transfer? owed tx-sender core)) ERR-REPAY-FAILED)
          (ok true)
        )
      )

      ;;  Mode 2: wSTX debt + sBTC collateral 
      ;; After liquidation we hold sBTC. Swap sBTC->wSTX(=STX) on Velar pool 70.
      (begin
        (unwrap!
          (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3
            liquidation-call
            (list
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
              { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
              { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
              { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
              { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
            )
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0          ;; collateral-lp
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token          ;; collateral
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx                 ;; debt-asset
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; collateral-oracle
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; debt-oracle
            borrower debt-amt false
          ))
          ERR-LIQUIDATION)
        ;; Swap all sBTC received -> Velar wSTX (= STX)
        (let ((sbtc-bal (unwrap!
                (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                  get-balance tx-sender))
                ERR-SWAP-FAILED)))
          (unwrap!
            (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
              swap-exact-tokens-for-tokens
              u70
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token-in
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx         ;; token-out (= STX)
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to
              sbtc-bal u1
            ))
            ERR-SWAP-FAILED)
          (let ((bal (stx-get-balance (as-contract tx-sender))))
            (asserts! (>= bal owed) ERR-INSUFFICIENT)
            (unwrap! (as-contract (stx-transfer? owed tx-sender core)) ERR-REPAY-FAILED)
            (ok true)
          )
        )
      )
    )
  )
)

;; =============================================
;; sBTC Flash Loan Callback (modes 3 and 4)
;; =============================================

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
    (borrower (var-get target-borrower))
    (debt-amt (var-get target-debt))
    (mode    (var-get target-mode))
  )
    (asserts! (or (is-eq mode u3) (is-eq mode u4)) ERR-BAD-MODE)

    (if (is-eq mode u3)

      ;;  Mode 3: sBTC debt + sBTC collateral 
      (begin
        (unwrap!
          (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3
            liquidation-call
            (list
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
              { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
              { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
              { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
              { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
            )
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0          ;; collateral-lp
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token          ;; collateral
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token          ;; debt-asset
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; collateral-oracle
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; debt-oracle
            borrower debt-amt false
          ))
          ERR-LIQUIDATION)
        (let ((bal (unwrap!
                (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                  get-balance tx-sender))
                ERR-REPAY-FAILED)))
          (asserts! (>= bal owed) ERR-INSUFFICIENT)
          (unwrap!
            (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              transfer owed tx-sender core none))
            ERR-REPAY-FAILED)
          (ok true)
        )
      )

      ;;  Mode 4: sBTC debt + wSTX collateral 
      ;; After liquidation we hold wSTX (= STX). Swap STX->sBTC on Velar pool 70.
      (begin
        (unwrap!
          (as-contract (contract-call? 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3
            liquidation-call
            (list
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zaeusdc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.aeusdc-oracle-v1-0 }
              { asset: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zdiko-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.diko-oracle-v1-1 }
              { asset: 'SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusdh-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usdh-oracle-v1-0 }
              { asset: 'SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsusdt-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.susdt-oracle-v1-0 }
              { asset: 'SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zusda-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.usda-oracle-v1-1 }
              { asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zsbtc-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
              { asset: 'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zalex-v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.alex-oracle-v1-1 }
              { asset: 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2,
                lp-token: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zststxbtc-v2_v2-0,
                oracle: 'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 }
            )
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.zwstx-v2-0          ;; collateral-lp
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.wstx                 ;; collateral (= STX)
            'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token          ;; debt-asset
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; collateral-oracle
            'SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.stx-btc-oracle-v1-4 ;; debt-oracle
            borrower debt-amt false
          ))
          ERR-LIQUIDATION)
        ;; Swap all STX received -> sBTC via Velar pool 70
        (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
          (unwrap!
            (as-contract (contract-call? 'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-router
              swap-exact-tokens-for-tokens
              u70
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.wstx         ;; token-in (= STX)
              'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token  ;; token-out
              'SP1Y5YSTAHZ88XYK1VPDH24GY0HPX5J4JECTMY4A1.univ2-share-fee-to
              stx-bal u1
            ))
            ERR-SWAP-FAILED)
          (let ((sbtc-bal (unwrap!
                  (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                    get-balance tx-sender))
                  ERR-REPAY-FAILED)))
            (asserts! (>= sbtc-bal owed) ERR-INSUFFICIENT)
            (unwrap!
              (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
                transfer owed tx-sender core none))
              ERR-REPAY-FAILED)
            (ok true)
          )
        )
      )
    )
  )
)

;; =============================================
;; Owner Functions
;; =============================================

(define-public (set-liquidation-target (borrower principal) (debt uint) (mode uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (asserts! (> debt u0) ERR-ZERO-AMOUNT)
    (asserts! (and (>= mode u1) (<= mode u4)) ERR-BAD-MODE)
    (var-set target-borrower borrower)
    (var-set target-debt debt)
    (var-set target-mode mode)
    (ok true)
  )
)

(define-public (sweep-stx (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (unwrap! (as-contract (stx-transfer? amount tx-sender (var-get owner))) ERR-REPAY-FAILED)
    (ok true)
  )
)

(define-public (sweep-sbtc (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (unwrap!
      (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
        transfer amount tx-sender (var-get owner) none))
      ERR-REPAY-FAILED)
    (ok true)
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) ERR-NOT-OWNER)
    (ok (var-set owner new-owner))
  )
)

;; =============================================
;; Read-only
;; =============================================

;; Pre-flight check: estimates net profit before executing.
;; debt-amount : microSTX (modes 1-2) or sats (modes 3-4)
;; bonus-bp    : Zest liquidation bonus in basis points (e.g. u500 = 5%)
(define-read-only (simulate (debt-amount uint) (bonus-bp uint))
  (let (
    (raw-fee (/ (* debt-amount u5) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (bonus   (/ (* debt-amount bonus-bp) u10000))
    (profit  (if (> bonus fee) (- bonus fee) u0))
  )
    {
      debt-amount:  debt-amount,
      bonus-bp:     bonus-bp,
      bonus:        bonus,
      flash-fee:    fee,
      net-profit:   profit,
      profitable:   (> bonus fee),
      owed-to-core: (+ debt-amount fee),
    }
  )
)

(define-read-only (get-stx-balance)
  (stx-get-balance (as-contract tx-sender))
)

(define-read-only (get-sbtc-balance)
  (as-contract (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token
    get-balance tx-sender))
)

(define-read-only (get-target)
  (ok {
    borrower: (var-get target-borrower),
    debt:     (var-get target-debt),
    mode:     (var-get target-mode),
  })
)

(define-read-only (get-owner)
  (ok (var-get owner))
)
