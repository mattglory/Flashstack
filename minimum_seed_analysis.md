# minimum_seed_analysis.md — sBTC Receiver Seed Sizing

**Author:** External integrator (HK)
**Date:** 2026-06-06
**Milestone:** 2 (`hk-sbtc-real-receiver-v1`)
**Method:** Live mainnet reads (`flashstack-sbtc-core`, Velar pool 70) + integer univ2 math mirroring on-chain execution. **No guessing** — every constant below is read from chain.
**Question answered:** *Exactly how much real sBTC must the receiver hold before its first flash loan?*

---

## 1. TL;DR

| Demo loan | Min seed (aggressive) | Recommended | Safe |
|---|---|---|---|
| **1,000 sats** (Matt's target) | **7 sats** | **~50 sats** | **~500 sats** |
| 5,000 sats | 32 sats | ~100 sats | ~500 sats |
| 15,000 sats (reserve max) | 97 sats | ~300 sats | ~1,000 sats |

**Plan of record:** acquire ~1,000–2,000 sats of canonical sBTC, **seed the receiver with ~500 sats**, execute a **1,000-sat** demo loan. The seed is recoverable via owner `rescue-sbtc`; only ~7 sats is actually consumed.

---

## 2. The repayment requirement (what the seed must cover)

Inside `execute-sbtc-flash`, the receiver must return `owed = amount + fee` to the core, or the whole tx reverts (`ERR-REPAY-FAILED`, and the core's own before/after reserve check). It swaps the borrowed sBTC through Velar and gets back **less** than it borrowed (DEX fees). The seed makes up the difference.

```
receiver pre-loan balance         = S            (the seed, sBTC)
core transfers borrowed amount    + L            -> holds S + L
swap L: sBTC -> wSTX -> sBTC      -> returns R    (R < L)  -> holds S + R
must repay                         owed = L + fee

solvency: S + R >= L + fee
=>  S >= (L - R) + fee  =  roundtrip_loss + fee
```

So **minimum seed = round-trip loss + protocol fee.** Nothing else touches the seed (the borrowed `L` is what gets swapped; the seed sits as sBTC and only tops up repayment).

---

## 3. Inputs (read from chain, 2026-06-06)

### 3.1 FlashStack fee — `flashstack-sbtc-core`
- `fee-basis-points = 5` (0.05%).
- On-chain math: `raw = amount*5/10000` (integer); `fee = max(raw, 1)` (1-sat floor).
- Consequence: for any loan **< 2,000 sats**, `raw = 0` → **fee = 1 sat** (the floor dominates).

| Loan | raw = L*5/10000 | fee |
|---|---|---|
| 1,000 | 0 | **1** |
| 2,000 | 1 | 1 |
| 5,000 | 2 | 2 |
| 10,000 | 5 | 5 |
| 15,000 | 7 | 7 |

### 3.2 Velar route loss — pool 70 (`univ2-pool-v1_0_0-0070`)
- Reserves: `reserve0 (wSTX) = 223,275,450,774 µSTX`, `reserve1 (sBTC) = 65,845,796 sats`.
- Swap fee: **0.3%/leg** (`get-fees` → `swap-fee = 9970/10000` keep ratio). Protocol takes 25% *of* that fee — irrelevant to the swapper's cost.
- univ2 out (integer, as on-chain): `out = (in*9970*reserveOut) / (reserveIn*10000 + in*9970)`.
- Round-trip = sBTC→wSTX (leg 1) then wSTX→sBTC (leg 2), with reserves shifted by leg 1.

Because a ≤15k-sat loan is **<0.025%** of the 65.8M-sat reserve, **price impact is negligible** and the loss is essentially the two 0.3% fees → **~0.6% (60 bps) round-trip**, confirmed by exact integer simulation:

| Loan (sats) | wSTX mid (µSTX) | sBTC back | round-trip loss | loss (bps) |
|---|---|---|---|---|
| 1,000 | 3,380,660 | 994 | **6** | 60.0 |
| 2,000 | 6,761,217 | 1,988 | 12 | 60.0 |
| 5,000 | 16,902,276 | 4,970 | 30 | 60.0 |
| 10,000 | 33,801,994 | 9,940 | 60 | 60.0 |
| 15,000 | 50,699,154 | 14,910 | 90 | 60.0 |

### 3.3 Slippage assumption
`min-out = u1` on both legs (ADR-S4) — the swap **always clears**; the repayment assert + the core's reserve check are the real safety gates. There is no percentage-floor revert risk. The only "slippage" that matters economically is the deterministic 0.6% fee loss above, plus any pool move between quote and execution (covered by the recommended/safe margin).

---

## 4. Minimum seed by loan size

`min_seed = roundtrip_loss + fee`:

| Demo loan | round-trip loss | core fee | **aggressive min** | recommended (≈3–7×) | safe (margin for pool drift) |
|---|---|---|---|---|---|
| **1,000** | 6 | 1 | **7** | ~50 | ~500 |
| 2,000 | 12 | 1 | 13 | ~50 | ~500 |
| 5,000 | 30 | 2 | 32 | ~100 | ~500 |
| 10,000 | 60 | 5 | 65 | ~200 | ~1,000 |
| 15,000 | 90 | 7 | 97 | ~300 | ~1,000 |

**Why three tiers**
- **Aggressive** = exact solvency at current reserves. Leaves ~0 margin; a single block of pool movement against us could flip `S + R < owed` and revert (no loss of funds, just a failed tx — wasted gas).
- **Recommended** = a few × the loss, absorbing realistic pool drift between the pre-flight quote and the execution block. This is what to actually seed.
- **Safe** = a clean round number (~500 sats) that survives even a large adverse pool move and lets us re-run / bump the loan without re-seeding. Cost is trivial and recoverable.

---

## 5. Acquisition & total cost

- 1 sat ≈ `223,275,450,774 / 65,845,796` ≈ **3,390 µSTX (~0.00339 STX)** at pool-70 mid.
- Seeding **500 sats** costs ≈ **1.7 STX** of sBTC bought on Velar (+0.3% buy fee). Seeding 1,000 sats ≈ 3.4 STX.
- We hold **36.7 STX** → ample.
- **Net economic cost of the whole demo** ≈ round-trip loss (~6 sats) + 1-sat fee + buy/sell swap fees ≈ **a few thousand µSTX (< $0.10-equivalent)**. The seed principal is recovered via `rescue-sbtc` and can be sold back to STX.
- Deploy ~0.5 STX + tx fees ~0.3 STX (STX-denominated), as M1.

---

## 6. Recommendation

1. **Buy ~1,000–2,000 sats** of canonical sBTC on Velar pool 70 with STX (helper: `buy-sbtc.mjs`, `DRY_RUN` first). Slight over-buy gives headroom to bump the demo loan if desired.
2. **Seed the receiver with 500 sats** (safe tier for a 1,000-sat loan — survives pool drift, recoverable).
3. **Execute a 1,000-sat flash loan** (Matt's stated sufficient size; well under the 15,010-sat reserve ceiling).
4. **Recover** the residual seed (~493 sats) via `rescue-sbtc` after success.

This is the minimum-risk path that still proves the full external sBTC execution + repayment, mirroring Milestone 1.

---

*All figures derived from live mainnet reads on 2026-06-06 and integer univ2 simulation matching on-chain arithmetic. Re-run the pre-flight quote immediately before execution — pool reserves drift, and the aggressive tier has no margin.*
