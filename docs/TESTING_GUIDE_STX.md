# FlashStack STX Testing Guide

**Last Updated:** April 2026  
**For:** External testers and developers  
**Status:** STX is the active path — sBTC is legacy

---

## Overview

FlashStack has two generations of implementation in this repo:

| Path | Status | Use for testing? |
|------|--------|-----------------|
| sBTC flash loans (`flashstack-core`, `sbtc-token`) | Legacy — SP3TGRVG7... wallet | No — reference only |
| STX flash loans (`flashstack-stx-core`, `flashstack-stx-pool`) | Active — SP20XD46... wallet | Yes — this is the focus |

The Clarinet local tests and `docs/archive/` cover the sBTC path. Ignore them for active testing — they are kept for historical reference only.

---

## Deployed Contracts (Stacks Mainnet)

All active contracts are under deployer wallet `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5`.

| Contract | Role | Explorer |
|----------|------|----------|
| `flashstack-stx-core` | Flash loan engine — holds reserve, executes loans | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core?chain=mainnet) |
| `flashstack-stx-pool` | LP pool — anyone deposits STX, earns fees | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-pool?chain=mainnet) |
| `stx-test-receiver` | Basic receiver — borrows and repays, no strategy | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver?chain=mainnet) |
| `bitflow-arb-receiver` | DEX receiver — STX→stSTX→STX arb on Bitflow | [View](https://explorer.hiro.so/address/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver?chain=mainnet) |

---

## Important Notes Before Testing

- **There is no testnet deployment.** All STX contract testing hits Stacks mainnet.
- The frontend at [flashstack.vercel.app](https://flashstack.vercel.app) is connected to mainnet. Flash loans are atomic — if the receiver fails to repay, the entire tx reverts and you lose only the Stacks tx fee (~0.001 STX, ~$0.001). No other funds are at risk.
- Do **not** run arbitrage scenarios via the UI without checking with Matt first — if the Bitflow spread is zero, the tx will revert cleanly but wastes gas.
- The `bitflow-arb-receiver` is whitelisted in `flashstack-stx-core`. Any new receiver contract you deploy must be approved via `add-approved-receiver` (admin-only) before it can borrow.

---

## Test Environment Setup

You need:
- A Leather or Xverse wallet with a small amount of STX (~5 STX is plenty for all smoke tests)
- Hiro Explorer write interface, or the FlashStack frontend

No local environment setup is needed for mainnet testing.

### To call contracts directly via Hiro Explorer:
1. Go to the contract's Explorer page (links above)
2. Click **"Call contract"** → connect your wallet
3. Select a function from the dropdown, fill in parameters, submit

---

## Test Suite

### Test 1 — Basic Flash Loan (Smoke Test)

**What it tests:** Core flash loan mechanic — borrow STX, repay in same tx.  
**Contract:** `flashstack-stx-core`  
**Function:** `flash-loan`  
**Receiver:** `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver`

**Parameters:**
```
amount:   u10000000   (10 STX — well within the 5000 STX limit)
receiver: SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver
```

**What success looks like:**
- Transaction confirmed (green checkmark in Explorer)
- No error code in the result
- `get-stats` on `flashstack-stx-core` shows `total-flash-mints` incremented by 1
- `get-stats` shows `total-volume` increased by 10000000
- `get-stats` shows `total-fees-collected` increased by 5000 (0.05% of 10 STX)

**What failure looks like:**
- `(err u302)` — `ERR-REPAY-FAILED` — receiver didn't repay (shouldn't happen with stx-test-receiver)
- `(err u303)` — `ERR-INSUFFICIENT-RESERVE` — pool doesn't have enough STX (check reserve balance first)
- `(err u305)` — `ERR-PAUSED` — contract is paused (contact Matt)
- `(err u306)` — `ERR-NOT-APPROVED` — receiver not whitelisted

**Before running — verify reserve balance:**
Call `get-reserve-balance` on `flashstack-stx-core`. The result must be ≥ your loan amount.

---

### Test 2 — Read Stats

**What it tests:** Contract state is readable and correct.  
**Contract:** `flashstack-stx-core`  
**Functions:** All read-only (no tx fee, no wallet needed)

| Function | Expected result |
|----------|----------------|
| `get-reserve-balance` | > 0 (currently ~80 STX) |
| `get-fee-basis-points` | `(ok u5)` — 0.05% fee |
| `get-max-single-loan` | `(ok u5000000000)` — 5000 STX limit |
| `get-admin` | `(ok SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5)` |
| `is-approved-receiver` with `SP20XD46...stx-test-receiver` | `(ok true)` |
| `is-approved-receiver` with `SP20XD46...bitflow-arb-receiver` | `(ok true)` |
| `calculate-fee u10000000` | `(ok u5000)` — fee on 10 STX |

---

### Test 3 — LP Pool Deposit

**What it tests:** Anyone can deposit STX into the pool and earn fees.  
**Contract:** `flashstack-stx-pool`  
**Function:** `deposit`

**Parameters:**
```
amount: u1000000   (1 STX)
```

**What success looks like:**
- Transaction confirmed
- LP tokens minted to your wallet
- `get-pool-balance` increases by 1000000

**To withdraw:** Call `withdraw` with the same amount of LP tokens.

---

### Test 4 — Bitflow DEX Receiver (Live DEX Integration)

**What it tests:** Flash loan → Bitflow STX/stSTX swap → repayment in one tx.  
**Contract:** `flashstack-stx-core`  
**Function:** `flash-loan`  
**Receiver:** `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver`

**How the flow works:**
1. `flashstack-stx-core` sends STX to `bitflow-arb-receiver`
2. Receiver swaps STX → stSTX on Bitflow (`stableswap-stx-ststx-v-1-2`)
3. Receiver swaps stSTX → STX on Bitflow
4. Receiver repays `flashstack-stx-core` principal + 0.05% fee
5. If profit > 0, it stays in the receiver contract (swept to owner)

**Parameters:**
```
amount:   u10000000   (10 STX)
receiver: SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver
```

**Before running — check profitability:**
Call `estimate-profit u10000000` on `bitflow-arb-receiver`. If it returns a positive number, the arb is live. If it returns 0 or errors, the spread is zero and the tx will revert — wait for a better moment.

**What success looks like:**
- Transaction confirmed
- Two internal Bitflow swap events visible in the tx trace
- STX returned to `flashstack-stx-core` reserve + fee

**What failure looks like:**
- `(err u402)` — `ERR-NO-PROFIT` — spread is zero, no arb available right now. This is expected when the market is balanced. Try again later or reduce the loan amount.
- `(err u401)` — `ERR-SWAP-FAILED` — Bitflow pool call failed

---

### Test 5 — Failure Cases (Expected Reverts)

These should all fail cleanly with no fund loss:

| Test | How to trigger | Expected error |
|------|---------------|----------------|
| Loan exceeds reserve | `flash-loan` with amount > `get-reserve-balance` | `(err u303)` |
| Loan exceeds max | `flash-loan` with amount > 5000000000 | `(err u304)` |
| Unapproved receiver | `flash-loan` with your own unwhitelisted contract | `(err u306)` |
| Zero amount | `flash-loan` with `u0` | `(err u301)` |

---

## Receivers In Scope for Testing

| Receiver | In scope | Notes |
|----------|----------|-------|
| `stx-test-receiver` | Yes — start here | Safe, always repays |
| `bitflow-arb-receiver` | Yes — main DEX test | Check `estimate-profit` first |
| `arkadiko-liquidation-receiver` | Optional | Requires an undercollateralised Arkadiko vault |
| All sBTC receivers (`SP3TGRVG7...`) | No | Legacy — do not test |

---

## Clarinet / Local Tests

The 86 Clarinet tests in `tests/` cover the **sBTC path** on simnet. They are not relevant to STX testing.

There is no Clarinet setup for the STX contracts because the core dependency (`SP3TGRVG7...stx-flash-receiver-trait`) is a mainnet-deployed contract that Clarinet cannot resolve locally. STX contract testing is mainnet-only until a testnet deployment is set up.

---

## Questions / Issues

- Slack or email Matt directly
- For on-chain tx issues, link the failed txid from [Hiro Explorer](https://explorer.hiro.so)
- Do not attempt to call admin functions (`deposit-reserve`, `add-approved-receiver`, `set-paused`) — these require the deployer wallet
