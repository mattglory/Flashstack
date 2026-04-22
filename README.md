# FlashStack

**The First Flash Loan Protocol for Bitcoin Layer 2**

[![Status](https://img.shields.io/badge/Status-Mainnet%20Live-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-86%20Passing-success)]()
[![Clarity](https://img.shields.io/badge/Clarity-2%20%26%203-blue)]()
[![Live](https://img.shields.io/badge/Live-flashstack.vercel.app-blue)](https://flashstack.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-yellow)]()

> Atomic, uncollateralized flash loans on Stacks (Bitcoin L2). Borrow any amount of STX with zero collateral, execute your strategy, and repay — all in one transaction. If repayment fails, the entire transaction reverts automatically.

---

## Live App

**[flashstack.vercel.app](https://flashstack.vercel.app)**

- Flash Loan — borrow STX with zero collateral
- LP Pool — deposit STX, earn yield from every flash loan fee
- Arb Bot — one-click Bitflow STX/stSTX arbitrage with live price check
- Receivers — deployed strategy contracts and build-your-own templates

---

## Mainnet Deployment

### Deployer Wallets

| Wallet | Address | Purpose |
|---|---|---|
| STX wallet | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5` | STX flash loan infrastructure (active) |
| sBTC wallet | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ` | sBTC flash loan infrastructure |

### STX Flash Loan Contracts — SP20XD46... (4 contracts)

| Contract | Explorer |
|---|---|
| `flashstack-stx-core` — flash loan core, 80 STX reserve | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core?chain=mainnet) |
| `flashstack-stx-pool` — LP pool, 30 STX, anyone deposits | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool?chain=mainnet) |
| `stx-test-receiver` — basic flash loan receiver | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver?chain=mainnet) |
| `bitflow-arb-receiver` — Bitflow STX/stSTX arbitrage | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver?chain=mainnet) |

### sBTC Flash Loan Contracts — SP3TGRVG7... (17 contracts)

| Contract | Explorer |
|---|---|
| `flashstack-core` — sBTC mint/burn flash loan core | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core?chain=mainnet) |
| `sbtc-token` — SIP-010 sBTC token | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.sbtc-token?chain=mainnet) |
| `flash-receiver-trait` — sBTC receiver interface | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flash-receiver-trait?chain=mainnet) |
| `stx-flash-receiver-trait` — STX receiver interface | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait?chain=mainnet) |
| `test-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.test-receiver?chain=mainnet) |
| `example-arbitrage-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.example-arbitrage-receiver?chain=mainnet) |
| `liquidation-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.liquidation-receiver?chain=mainnet) |
| `leverage-loop-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.leverage-loop-receiver?chain=mainnet) |
| `collateral-swap-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.collateral-swap-receiver?chain=mainnet) |
| `yield-optimization-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.yield-optimization-receiver?chain=mainnet) |
| `dex-aggregator-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.dex-aggregator-receiver?chain=mainnet) |
| `multidex-arbitrage-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.multidex-arbitrage-receiver?chain=mainnet) |
| `snp-flashstack-receiver-v3` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.snp-flashstack-receiver-v3?chain=mainnet) |
| `snp-flashstack-receiver` | [View](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.snp-flashstack-receiver?chain=mainnet) |
| `stx-core-test2` | test contract |
| `stx-core-test3` | test contract |
| `test-trait-use` | test contract |

**Total confirmed on-chain: 21 contracts across 2 wallets**
- 4 production STX contracts (SP20XD46...)
- 14 production sBTC contracts (SP3TGRVG7...)
- 3 development/iteration contracts (`stx-core-test2`, `stx-core-test3`, `test-trait-use`)

*M2 milestone submission referenced 16 production contracts (sBTC + STX infrastructure, excluding test iterations and the LP pool + arb receiver added post-submission).*

---

## Confirmed Mainnet Flash Loans (7 total)

| # | Asset | Amount | Contract | Tx |
|---|---|---|---|---|
| 1 | sBTC | 1 sBTC (u1000000) | `test-receiver` | [View](https://explorer.hiro.so/txid/0x0ee37861a8c1451451b4050a784bd3ad58aad60fc5c3c6c74715c5a24dc141ce?chain=mainnet) |
| 2 | sBTC | 5 sBTC (u5000000) | `test-receiver` | [View](https://explorer.hiro.so/txid/0x4a74c0b389e5cd805445d7e4cfd45c391ad9807fba9276d98c2760311251ba00?chain=mainnet) |
| 3 | sBTC | 10 sBTC (u10000000) | `dex-aggregator-receiver` | [View](https://explorer.hiro.so/txid/0xddfc9fa8b5a9586e2df6e00d39708d0692b25a49ef04d2f25ec69dc9bfeb167b?chain=mainnet) |
| 4 | STX | 10 STX | `stx-test-receiver` | [View](https://explorer.hiro.so/txid/0x3cc5020c29fb871614c01eb8ce622f6011f04bb668fb1773ca81acef4422ca8e?chain=mainnet) |
| 5 | STX | 50 STX | `stx-test-receiver` | [View](https://explorer.hiro.so/txid/0x48bbabb52c85a6d69baa27d4b7d3b03ce9fc6a1c25a41fd07648ff2d96f4ef4a?chain=mainnet) |
| 6 | STX | 50 STX | `stx-test-receiver` (frontend UI) | [View](https://explorer.hiro.so/txid/0xeb5056009cf9ad8b9d249895b921274d3eb741c925dc1ceb306eb69e97e009de?chain=mainnet) |
| 7 | STX | test | `stx-test-receiver` | [View](https://explorer.hiro.so/txid/0x2304038e0cef7010daf0eeabc8d00fd1529915506d8fe209822f61d4e39668dd?chain=mainnet) |

---

## Quick Start

### Smart Contracts

```bash
git clone https://github.com/mattglory/flashstack.git
cd flashstack
npm install
npm test          # 86 tests passing
npm run check     # Clarinet contract verification
```

**Requirements:** Node.js 16+, [Clarinet](https://github.com/hirosystems/clarinet) 2.0+

### Frontend

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

### Opportunity Monitor Bot

```bash
# Dry-run — check for arb every 30s, prints opportunities, no execution
DEPLOYER_MNEMONIC="your twelve word mnemonic" \
  node scripts/monitor-opportunities.mjs

# Live — auto-execute when profitable (requires funded wallet)
EXECUTE=true \
  LOAN_STX=50 \
  DEPLOYER_MNEMONIC="your twelve word mnemonic" \
  node scripts/monitor-opportunities.mjs
```

> **Never hardcode your mnemonic in source files or commit it to git.**

---

## How It Works

### STX Flash Loans (primary product)

1. Call `flash-loan(amount, receiver)` on `flashstack-stx-core` or `flashstack-stx-pool`
2. Protocol sends STX to your receiver contract
3. Your receiver executes any strategy (arb, liquidation, swap, etc.)
4. Receiver repays principal + 0.05% fee before returning
5. If repayment fails, entire transaction reverts — zero risk to protocol

### LP Pool

1. Anyone deposits STX into `flashstack-stx-pool`
2. Depositor receives shares proportional to deposit
3. Every flash loan fee accumulates in the pool
4. Share value increases automatically as fees grow
5. Withdraw anytime — receive principal + all accrued yield

### sBTC Flash Loans (mint/burn model)

Same atomic guarantee but using a mint/burn mechanism for sBTC.

---

## Strategies

### Bitflow STX/stSTX Arbitrage (live — use Arb Bot page)

stSTX accumulates staking yield every ~2 weeks. When yield accrues, stSTX briefly trades above 1:1 STX on Bitflow before arbitrageurs equalize it.

```
Borrow 1000 STX (zero collateral)
  -> Buy stSTX on Bitflow (stSTX above peg)
  -> Sell stSTX back to STX (at higher rate)
  -> Repay 1000.05 STX (principal + 0.05% fee)
  -> Keep spread as profit
```

Use the live bot at [flashstack.vercel.app/arb](https://flashstack.vercel.app/arb) or run:

```bash
EXECUTE=true DEPLOYER_MNEMONIC="..." node scripts/monitor-opportunities.mjs
```

### Cross-DEX Arbitrage

```
Borrow STX -> Buy TOKEN cheap on DEX A -> Sell TOKEN on DEX B -> Repay -> Keep spread
```

### Self-Liquidation

Borrowers approaching liquidation can flash-borrow to repay their own debt and avoid liquidation penalties.

---

## Build a Receiver Contract

```clarity
;; Implement this single function
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee       (/ (* amount u5) u10000))  ;; 0.05%
    (total-owed (+ amount fee))
  )
    ;; Your strategy here — you have (amount) STX right now

    ;; Repay principal + fee
    (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) (err u500))
    (ok true)
  )
)
```

Deploy to mainnet, then open a GitHub issue or email mattglory14@gmail.com to get whitelisted. Include your deployed contract address.

---

## Security

**Status: Mainnet, not professionally audited. Use at your own risk.**

All findings from an independent security review were addressed before mainnet deployment:

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-01 | Critical | Anyone could call `mint` on sbtc-token | Fixed |
| C-02 | Critical | Supply invariant not enforced after callback | Fixed |
| H-01 | High | Supply inflates after each flash loan | Fixed |
| H-03 | High | Fee hardcoded in receivers | Fixed — dynamic fee lookup |
| M-01 | Medium | No circuit breaker | Fixed — max loan + max block volume |
| L-01 | Low | Fee rounds to zero for tiny loans | Fixed — minimum fee of 1 unit |

---

## Testing

```bash
npm test           # 86 tests
npm run test:watch # Watch mode
```

86 tests covering: initialization, access control, fee calculations, collateral ratios, circuit breakers, whitelist management, flash loan execution, end-to-end mint-burn cycle, boundary values, security invariants.

---

## Project Structure

```
flashstack/
  contracts/              # 20 Clarity smart contracts
  tests/                  # 86 Vitest tests
  scripts/                # Deploy + monitor scripts
    monitor-opportunities.mjs   # Arb bot (Bitflow STX/stSTX)
    deploy-pool-and-liquidation.mjs
    seed-pool.mjs
  web/                    # Next.js 14 frontend
    src/app/
      page.tsx            # Marketing landing page
      (app)/
        dashboard/        # Protocol stats
        flash-loan/       # Execute flash loans
        pool/             # LP pool deposit/withdraw
        arb/              # Bitflow arb bot UI
        receivers/        # Deployed contracts + templates
```

---

## Roadmap

- [x] Security hardening (all audit findings addressed)
- [x] Mainnet deployment — 21 contracts across 2 wallets
- [x] 86-test suite (Vitest + Clarinet simnet)
- [x] Frontend — flash loan execution, wallet connection, live stats
- [x] STX reserve flash loans (no collateral required)
- [x] LP pool — external liquidity providers earn yield
- [x] Arb bot — Bitflow STX/stSTX, live price check + one-click execute
- [x] Mobile-responsive UI
- [ ] Professional audit
- [ ] Zest Protocol liquidation integration
- [ ] Multi-asset LP pool
- [ ] External developer onboarding (M3)
- [ ] Bug bounty

---

## License

[MIT](./LICENSE)

---

## Author

**Glory Matthew** — [@mattglory](https://github.com/mattglory)

- Twitter: [@mattglory_](https://twitter.com/mattglory_)
- Email: mattglory14@gmail.com
