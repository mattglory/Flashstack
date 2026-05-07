# FlashStack LP Shares as Collateral — Integration Spec

**For:** Zest Protocol, ALEX Lab, and other Stacks lending markets
**Version:** 1.0 — May 2026
**Contact:** @flashstackbtc on X | github.com/mattglory/Flashstack

---

## Overview

FlashStack LP shares are yield-bearing, single-asset tokens backed by STX or canonical sBTC.

Their value is:
- **Monotonically increasing** — pool balance only grows as flash loan fees accumulate
- **Directly readable on-chain** — no external oracle, no manipulation surface
- **Denominated in a known asset** — STX shares in STX, sBTC shares in sBTC

This makes them ideal collateral for a lending market. This document explains exactly how to integrate them.

---

## Available LP Tokens

### 1. FlashStack STX Pool Shares

| Property | Value |
|----------|-------|
| Pool contract | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool` |
| Oracle contract | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle` |
| Underlying asset | STX (microstacks) |
| Share precision | 1,000,000 |
| Fee yield | 0.05% per flash loan |
| Mainnet since | May 2026 |

### 2. FlashStack sBTC Pool Shares (upcoming)

| Property | Value |
|----------|-------|
| Pool contract | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-pool` |
| Underlying asset | Canonical sBTC (sats) — `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` |
| Share precision | 100,000,000 (1e8, matches sat precision) |
| Fee yield | 0.05% per flash loan, paid in sBTC |
| Mainnet deployment | Pending — contact us |

---

## How Share Pricing Works

### Formula

```
share_price = pool_balance * SHARE_PRECISION / total_shares
```

Where:
- `pool_balance` = total underlying asset held by the pool contract
- `total_shares` = total shares in circulation
- `SHARE_PRECISION` = 1,000,000 (STX pool) or 100,000,000 (sBTC pool)

At launch: `share_price = SHARE_PRECISION` (1:1 with underlying)
Over time: `share_price > SHARE_PRECISION` (yield accrued)

### Example

```
pool_balance  = 110,000,000 microstacks (110 STX)
total_shares  = 100,000,000 (100 STX deposited initially)
share_price   = 110,000,000 * 1,000,000 / 100,000,000 = 1,100,000
              = 1.1 microSTX per share
              = +10% yield since launch
```

---

## Oracle API

### STX Pool — via flashstack-pool-oracle

**Get current share price:**
```clarity
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle
  get-share-price)
;; Returns: (ok uint) — share price scaled by 1,000,000
;; Divide by 1,000,000 to get microstacks per share
```

**Get collateral value for a specific LP:**
```clarity
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle
  get-lp-value
  lp-principal)
;; Returns: (ok uint) — LP's position value in microstacks
```

**Full snapshot (recommended for lending protocol state checks):**
```clarity
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle
  get-collateral-snapshot)
;; Returns: (ok { share-price, total-shares, pool-balance, yield-accrued, total-loans, is-healthy })
```

**Check LP shares:**
```clarity
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-pool-oracle
  get-lp-shares
  lp-principal)
;; Returns: (ok uint) — raw shares held by this LP
```

### sBTC Pool — direct (oracle built-in)

```clarity
;; Share price
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-pool
  get-share-price)
;; Returns: (ok uint) — sats per share scaled by 1e8

;; LP collateral value
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-pool
  get-lp-value lp-principal)
;; Returns: (ok uint) — LP value in sats

;; Full snapshot
(contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-pool
  get-collateral-snapshot)
```

---

## Why This Is Manipulation-Resistant

Flash loan oracle attacks work by temporarily inflating the balance of a pool within a single transaction, manipulating a price read, then restoring the balance — all in one block.

FlashStack LP share prices **cannot be manipulated this way** because:

1. **The reserve invariant** — every flash loan in `flashstack-stx-pool` and `flashstack-sbtc-pool` verifies that `reserve_after >= reserve_before + fee`. The pool balance can only increase. It can never be temporarily inflated and deflated within one tx — the core contract enforces this.

2. **No external asset pricing** — the share price is purely `pool_balance / total_shares`. There is no external price feed to manipulate. Both values live in the pool contract itself.

3. **Single-asset backing** — STX pool shares are backed by STX only. sBTC pool shares are backed by sBTC only. No complex multi-asset weighting that can be gamed.

4. **Monotonic growth** — pool balance only ever grows (fees in) or shrinks by explicit LP withdrawals (which reduce total_shares proportionally). The share price is non-decreasing in the absence of slashing (which does not exist in this protocol).

---

## Suggested Integration Parameters

These are starting point recommendations. Your risk team should validate.

### STX Pool Shares

| Parameter | Suggested Value | Rationale |
|-----------|----------------|-----------|
| LTV (loan-to-value) | 70% | Conservative for new asset class |
| Liquidation threshold | 80% | Standard buffer above LTV |
| Liquidation bonus | 5% | Standard incentive |
| Price oracle | `flashstack-pool-oracle.get-share-price` | On-chain, no external feed |
| Price freshness | Always current (no staleness) | On-chain read-only |

### sBTC Pool Shares

| Parameter | Suggested Value | Rationale |
|-----------|----------------|-----------|
| LTV | 65% | Additional buffer for sBTC price exposure |
| Liquidation threshold | 75% | |
| Liquidation bonus | 5% | |
| Price oracle | `flashstack-sbtc-pool.get-share-price` | Built-in |
| Denominated in | sats | Convert to USD via sBTC/BTC price feed |

---

## Liquidation Integration

If you need to liquidate an undercollateralised FlashStack LP position, a liquidator can:

1. Use a FlashStack flash loan to borrow the underlying asset (STX or sBTC)
2. Call the lending protocol's liquidation function with the borrowed funds
3. Receive the LP shares (collateral)
4. Redeem LP shares via `withdraw` on the pool contract
5. Repay the flash loan + fee from the redeemed underlying

This creates a **zero-capital liquidation loop** — liquidators need no upfront funds. This makes liquidations faster, more competitive, and keeps the lending market healthier.

FlashStack already has a mainnet-proven flash loan engine ready to power this. We can build the liquidation receiver contract jointly.

---

## Mainnet Track Record

| Date | Event |
|------|-------|
| May 2026 | `flashstack-stx-pool` deployed on Stacks Mainnet |
| May 2026 | `flashstack-stx-core` — 6+ confirmed flash loans |
| May 2026 | `flashstack-sbtc-core` — canonical sBTC flash loans confirmed |
| May 2026 | Bitflow DEX integration — live arb receiver confirmed on-chain |

Explorer (STX pool): https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool?chain=mainnet

---

## Contact

Ready to integrate? We'll build whatever is needed on our side:
- Custom oracle contract to match your interface
- Liquidation receiver that uses FlashStack flash loans
- Joint announcement

**X:** @flashstackbtc
**GitHub:** https://github.com/mattglory/Flashstack
**Frontend:** https://flashstack.vercel.app
