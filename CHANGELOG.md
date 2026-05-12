# FlashStack Changelog

All notable changes to this project are documented here.

---

## [2.0.0] - 2026-05

### Canonical sBTC Flash Loan System

- Deployed `flashstack-sbtc-core` — reserve-based sBTC flash loan engine
- Deployed `flashstack-sbtc-pool` — sBTC LP pool with built-in share price oracle
- Deployed `sbtc-flash-receiver-trait` — interface for sBTC receiver contracts
- Deployed `sbtc-test-receiver` — minimal sBTC borrow-and-repay receiver
- Deployed `velar-sbtc-arb-receiver` — live Velar wSTX↔sBTC arb receiver (pool 70, whitelisted)
- Confirmed first canonical sBTC flash loan on mainnet

### LP Collateral Oracle

- Deployed `flashstack-pool-oracle` — manipulation-resistant share price oracle
- Oracle exposes `get-share-price`, `get-lp-value`, `get-collateral-snapshot`
- LP shares are yield-bearing: share value increases monotonically as fees accumulate
- Designed for Zest Protocol LP-as-collateral integration

---

## [1.1.0] - 2025-12

### STX Flash Loan System

- Deployed `flashstack-stx-core` — reserve-based STX flash loan engine (0.05% fee, whitelist, circuit breaker)
- Deployed `flashstack-stx-pool` — LP pool allowing external depositors to earn yield from flash loan fees
- Deployed `bitflow-arb-receiver` — live STX/stSTX arbitrage receiver on Bitflow stableswap
- Deployed `stx-test-receiver` — minimal STX borrow-and-repay receiver
- Confirmed first STX flash loan on mainnet (Bitflow arb round-trip)

### Architecture: Reserve Model

- Flash loans operate on a reserve invariant model — no minting or burning
- STX core: lender deposits reserve, borrower repays `amount + fee` in same transaction
- sBTC core: reserve verified before and after every loan — if balance didn't grow by fee, tx reverts
- All security findings from independent review resolved before mainnet deployment

---

## [1.0.0] - 2025-11

### Initial Protocol Design

- Defined flash loan receiver trait interface (Clarity 3, Epoch 3.0)
- Implemented and tested core flash loan mechanics on Clarinet simnet
- 86-test suite passing (Vitest + Clarinet simnet)
- Security review: 2 Critical, 2 High, 1 Medium, 1 Low findings — all fixed
