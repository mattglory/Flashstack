# FlashStack

**Open Flash-Loan Infrastructure for Bitcoin Layer 2**

[![Status](https://img.shields.io/badge/Status-Mainnet%20Live-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-82%20Passing-success)]()
[![Clarity](https://img.shields.io/badge/Clarity-3-blue)]()
[![Live](https://img.shields.io/badge/Live-flashstack.vercel.app-blue)](https://flashstack.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-yellow)]()

> Atomic, uncollateralized flash loans on Stacks (Bitcoin L2). Borrow STX or canonical sBTC with zero collateral, execute your strategy, and repay — all in one transaction. If repayment fails, the entire transaction reverts automatically.

---

## Live App

**[flashstack.vercel.app](https://flashstack.vercel.app)**

- **Flash Loan** — borrow STX or canonical sBTC with zero collateral
- **LP Pool** — deposit STX, earn yield from every flash loan fee
- **Arb Bot** — one-click Bitflow STX/stSTX arbitrage with live price check
- **Receivers** — deployed strategy contracts and build-your-own templates

---

## Mainnet Contracts

All contracts deployed under `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5`.

### STX Flash Loan System

| Contract | Description | Explorer |
|----------|-------------|---------|
| `flashstack-stx-core` | Flash loan engine — admin reserve model | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core?chain=mainnet) |
| `flashstack-stx-pool` | LP pool — anyone deposits STX, earns fees | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool?chain=mainnet) |
| `flashstack-pool-oracle` | Collateral oracle — share price for lending protocols | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle?chain=mainnet) |
| `stx-test-receiver` | Basic receiver — borrow STX, repay principal + fee | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver?chain=mainnet) |
| `bitflow-arb-receiver-v4` | Bitflow STX/stSTX arbitrage receiver | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver-v4?chain=mainnet) |

### Canonical sBTC Flash Loan System

Canonical sBTC: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` (~4,000 BTC in circulation)

| Contract | Description | Explorer |
|----------|-------------|---------|
| `flashstack-sbtc-core` | sBTC flash loan engine — holds canonical sBTC reserve | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core?chain=mainnet) |
| `flashstack-sbtc-pool` | sBTC LP pool — depositors earn sBTC yield, built-in oracle | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-pool?chain=mainnet) |
| `sbtc-flash-receiver-trait` | Interface all sBTC receivers must implement | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait?chain=mainnet) |
| `sbtc-test-receiver` | Basic sBTC receiver — borrow canonical sBTC, repay principal + fee | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-test-receiver?chain=mainnet) |
| `velar-sbtc-arb-receiver` | Velar wSTX↔sBTC arb receiver (pool 70, whitelisted) | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.velar-sbtc-arb-receiver?chain=mainnet) |

### Zest Flash Liquidation

| Contract | Description | Explorer |
|----------|-------------|---------|
| `zest-liquidation-receiver` | Zero-capital Zest liquidator — 4 modes (STX/sBTC debt × STX/sBTC collateral), Velar swap for cross-asset modes | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.zest-liquidation-receiver?chain=mainnet) |

### ALEX Arbitrage

| Contract | Description | Explorer |
|----------|-------------|---------|
| `alex-arb-receiver-v2` | ALEX STX/ALEX arb receiver — flash-borrow STX, swap wSTX->ALEX->wSTX on ALEX AMM, keep spread | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.alex-arb-receiver-v2?chain=mainnet) |

---

## Testnet

The full STX flash loan system (core + LP pool + oracle + test receiver) can be deployed to Stacks testnet to produce independent on-chain evidence before mainnet.

```bash
# 1. Fund your testnet address at: https://explorer.hiro.so/sandbox/faucet?chain=testnet
# 2. Deploy + execute a testnet flash loan:
TESTNET_MNEMONIC="word1 ... word24" node scripts/deploy-testnet.mjs
```

The script derives your testnet address automatically, deploys all 5 contracts in order, whitelists the receiver, funds the reserve, and executes a flash loan — producing a testnet txid as evidence.

---

## Confirmed Mainnet Flash Loans

| # | Asset | Type | Tx |
|---|-------|------|-----|
| 1 | STX | `bitflow-arb-receiver-v4` — STX→stSTX→STX round-trip on Bitflow stableswap | [View](https://explorer.hiro.so/txid/0xabd33fc46ffa204ce61f25664f057e414063f28ce75c8387a6df9116453110cb?chain=mainnet) |
| 2 | sBTC | Test receiver — canonical sBTC borrowed and repaid atomically | [View](https://explorer.hiro.so/txid/0x67f0c77d9d7ab9762c08a3638ba0990d5bbc3d19db8adc1a0d616cd7170f9baa?chain=mainnet) |
| 3 | sBTC | Test receiver — executed via production frontend UI | [View](https://explorer.hiro.so/txid/0xc9d8e86f5ffcfc61537a25d6108a4b8ac0cf075568027a878cf2e9bcf6d53b4e?chain=mainnet) |

---

## How It Works

### STX Flash Loans

1. Call `flash-loan(amount, receiver)` on `flashstack-stx-core`
2. Protocol sends STX to your receiver contract
3. Your receiver executes any on-chain strategy (arb, liquidation, swap, etc.)
4. Receiver repays principal + 0.05% fee before returning
5. If repayment fails, entire transaction reverts — zero risk to protocol

### Canonical sBTC Flash Loans

Same flow, but with real Bitcoin (backed 1:1 via the sBTC bridge):

1. Call `flash-loan(amount, receiver)` on `flashstack-sbtc-core`
2. Protocol sends canonical sBTC to your receiver
3. Receiver executes strategy — DEX swap, liquidation, collateral swap, etc.
4. Receiver repays sBTC principal + 0.05% fee
5. Reserve invariant verified on-chain — if balance didn't grow by fee, tx reverts

### LP Pool

1. Anyone deposits STX into `flashstack-stx-pool`
2. Depositor receives shares proportional to deposit
3. Every flash loan fee accumulates in the pool — share value increases
4. Withdraw anytime — receive principal + all accrued yield

LP shares are yield-bearing collateral. The `flashstack-pool-oracle` exposes `get-share-price` and `get-lp-value` for lending protocol integration. See [LP Collateral Integration Spec](docs/LP_COLLATERAL_INTEGRATION_SPEC.md).

---

## Quick Start

### Contracts & Tests

```bash
git clone https://github.com/mattglory/Flashstack.git
cd flashstack
npm install
npm test          # 82 tests passing
npm run check     # Clarinet contract verification
```

**Requirements:** Node.js 18+, [Clarinet](https://github.com/hirosystems/clarinet) 2.0+

### Frontend

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

### Arb Bot

```bash
# Bitflow STX/stSTX — dry-run, scan every 30s
DEPLOYER_MNEMONIC="your 24 word mnemonic" \
  node scripts/monitor-opportunities.mjs

# Bitflow — live execution when profitable
EXECUTE=true LOAN_STX=10 \
  DEPLOYER_MNEMONIC="your 24 word mnemonic" \
  node scripts/monitor-opportunities.mjs

# ALEX STX/ALEX — dry-run, scan every 30s
DEPLOYER_MNEMONIC="your 24 word mnemonic" \
  node scripts/monitor-alex-arb.mjs

# ALEX — live execution when profitable
EXECUTE=true LOAN_STX=100 \
  DEPLOYER_MNEMONIC="your 24 word mnemonic" \
  node scripts/monitor-alex-arb.mjs
```

> Never hardcode your mnemonic in source files or commit it to git.

---

## Build a Receiver

**New to Clarity or Stacks?** Follow the [New Developer Walkthrough](docs/NEW_DEVELOPER_WALKTHROUGH.md) — from installing Node.js to executing your first mainnet flash loan in ~45 minutes, no prior experience needed.

### STX Receiver

```clarity
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp     (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core get-fee-basis-points) (err u500)))
    (raw-fee    (/ (* amount fee-bp) u10000))
    (fee        (if (> raw-fee u0) raw-fee u1))  ;; minimum 1 microSTX
    (total-owed (+ amount fee))
  )
    ;; Your strategy here — (amount) STX is already in this contract

    ;; Repay principal + fee
    (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) (err u500))
    (ok true)
  )
)
```

### sBTC Receiver

```clarity
(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core get-fee-basis-points) (err u500)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))  ;; minimum 1 sat
    (owed    (+ amount fee))
  )
    ;; Your strategy here — (amount) canonical sBTC is already in this contract

    ;; Repay principal + fee
    (unwrap! (as-contract (contract-call? SBTC transfer owed tx-sender core none)) (err u501))
    (ok true)
  )
)
```

Deploy to mainnet, then open a [GitHub issue](https://github.com/mattglory/Flashstack/issues) with your contract address to get whitelisted.

Full receiver templates: [docs/BUILD_A_RECEIVER.md](docs/BUILD_A_RECEIVER.md) | [docs/TESTING_GUIDE_STX.md](docs/TESTING_GUIDE_STX.md) | [docs/TESTING_GUIDE_SBTC.md](docs/TESTING_GUIDE_SBTC.md)

---

## Strategies

**STX / Bitflow Arbitrage** — stSTX accumulates staking yield every ~2 weeks. When yield accrues, stSTX briefly trades above peg. Flash-borrow STX, buy stSTX, sell back for profit, repay.

**sBTC DEX Arbitrage** — Flash-borrow canonical sBTC, swap on Velar STX<>sBTC pool, capture spread, repay. Velar receiver in [contracts/velar-sbtc-arb-receiver.clar](contracts/velar-sbtc-arb-receiver.clar).

**Zero-Capital Zest Liquidations** — Flash-borrow STX or sBTC, liquidate an undercollateralised Zest position (5% bonus), repay the flash loan (0.05% fee), keep the ~4.95% spread — zero capital required. Supports all 4 debt×collateral combinations. Velar pool 70 handles cross-asset swaps atomically. Contract: [`zest-liquidation-receiver`](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.zest-liquidation-receiver?chain=mainnet). Requires Zest whitelist to execute.

**ALEX STX/ALEX Arbitrage** — ALEX token accrues protocol revenue; before emissions or governance events it briefly trades above fair value. Flash-borrow STX, swap wSTX->ALEX->wSTX on the ALEX AMM (`amm-pool-v2-01`), repay FlashStack (0.05% fee), keep the spread. Contract: [`alex-arb-receiver-v2`](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.alex-arb-receiver-v2?chain=mainnet).

**Collateral Swaps** — Flash-borrow to atomically swap one collateral type for another without closing your position.

---

## Security

**Status: Mainnet, not professionally audited. Use at your own risk.**

All findings from an independent security review were addressed before mainnet deployment:

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| C-01 | Critical | Unrestricted mint on token contract | Fixed |
| C-02 | Critical | Supply invariant not enforced after callback | Fixed |
| H-01 | High | Supply inflates after each flash loan | Fixed |
| H-03 | High | Fee hardcoded in receivers | Fixed — dynamic fee lookup |
| M-01 | Medium | No circuit breaker | Fixed — max loan + pause |
| L-01 | Low | Fee rounds to zero for tiny loans | Fixed — minimum fee of 1 unit |

The canonical sBTC implementation uses a reserve invariant model (not mint/burn). The pool balance is verified before and after every loan — if it didn't grow by at least the fee, the transaction reverts.

---

## Testing

```bash
npm test           # 82 tests
npm run test:watch # Watch mode
```

External testing guides:
- [STX Testing Guide](docs/TESTING_GUIDE_STX.md)
- [sBTC Testing Guide](docs/TESTING_GUIDE_SBTC.md)

---

## Project Structure

```
flashstack/
  contracts/                        # Clarity smart contracts
    flashstack-stx-core.clar        # STX flash loan engine
    flashstack-stx-pool.clar        # STX LP pool
    flashstack-pool-oracle.clar     # LP share price oracle
    flashstack-sbtc-core.clar       # sBTC flash loan engine
    flashstack-sbtc-pool.clar       # sBTC LP pool
    sbtc-flash-receiver-trait.clar  # sBTC receiver interface
    bitflow-arb-receiver.clar       # Bitflow arb receiver (v4 is the live deployed version)
    velar-sbtc-arb-receiver.clar    # Velar sBTC arb receiver
    zest-liquidation-receiver.clar  # Zest zero-capital liquidator (4 modes)
    alex-arb-receiver.clar          # ALEX STX/ALEX arb receiver
  tests/                            # 82 Vitest + Clarinet simnet tests
  scripts/                          # Deploy + monitor scripts
  docs/                             # Guides and integration specs
    TESTING_GUIDE_STX.md
    TESTING_GUIDE_SBTC.md
    LP_COLLATERAL_INTEGRATION_SPEC.md
  web/                              # Next.js 14 frontend
    src/app/
      page.tsx                      # Landing page
      (app)/
        dashboard/                  # Live protocol stats
        flash-loan/                 # Execute STX + sBTC flash loans
        pool/                       # LP pool deposit/withdraw
        arb/                        # Bitflow arb bot UI
        receivers/                  # Templates + deployed contracts
```

---

## Roadmap

- [x] Security hardening — all audit findings resolved
- [x] Mainnet deployment — STX + canonical sBTC flash loan engines
- [x] 82-test suite (Vitest + Clarinet simnet)
- [x] Production frontend — STX + sBTC flash loans, wallet connect, live stats
- [x] LP pool — external liquidity providers earn STX yield
- [x] Bitflow arb receiver — live DEX integration proven on mainnet
- [x] LP collateral oracle — `get-share-price` for lending protocol integration
- [x] sBTC LP pool — depositors earn sBTC yield, shares appreciate with BTC
- [x] Velar sBTC arb receiver — deployed and whitelisted on mainnet
- [x] `flashstack-sbtc-pool` + `flashstack-pool-oracle` deployed to mainnet
- [x] Zest flash liquidation receiver — deployed, whitelisted in FlashStack, pending Zest whitelist
- [x] ALEX STX/ALEX arb receiver — deployed and whitelisted in FlashStack, pending ALEX blocklist confirmation
- [ ] Zest Protocol — LP shares as collateral integration
- [ ] ALEX Lab — sBTC arb receiver integration
- [ ] External developer onboarding (M3)
- [ ] Professional audit + bug bounty

---

## License

[MIT](./LICENSE)

---

**Built by Glory Matthew** — [@flashstackbtc](https://x.com/flashstackbtc) | [GitHub](https://github.com/mattglory) | [mattglory14@gmail.com](mailto:mattglory14@gmail.com)
