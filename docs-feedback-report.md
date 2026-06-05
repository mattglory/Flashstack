# FlashStack — Integration Documentation Review

**Author:** External integrator (HK), having completed a full end-to-end FlashStack integration on mainnet
**Date:** 2026-06-06
**Basis:** Milestone 1 — designed, deployed, whitelisted, seeded, and executed `hk-stx-bitflow-receiver-v1` (a real STX→stSTX→STX Bitflow round-trip) on Stacks mainnet. Flash-loan tx `865df576…639737` → `(ok true)`.
**Method:** Every claim below was verified against the contract source in `contracts/` and/or live mainnet reads. File and line citations are given so each can be checked independently.

> **Bottom line.** The documentation set is genuinely good — among the better protocol docs on Stacks — and it got us to a successful mainnet integration. `ONBOARDING.md` in particular is excellent. But a developer who follows only the two "start here" docs (`INTEGRATION_GUIDE.md`, `BUILD_A_RECEIVER.md`) will hit three avoidable walls (receiver funding, external-principal rule, whitelist channel) and will copy at least one snippet that does not compile or does not return what the doc claims. There is also a cluster of stale/contradictory numeric facts (a 100× wrong max-loan, an impl-trait that points at the wrong contract, troubleshooting error codes that don't match the source). None of these are hard to fix and most are one-line edits.

---

## What Worked Well

These are the things that materially helped and were **correct** when checked against source:

1. **The core mental model is communicated clearly and repeatedly.** The "borrow → strategy → repay principal+fee → reserve-grew-by-fee-or-revert" loop appears as an ASCII diagram in `INTEGRATION_GUIDE.md:49`, `BUILD_A_RECEIVER.md:13`, and `ONBOARDING.md:42`. This is the single most important thing to understand and the docs nail it. Verified against `flashstack-stx-core.clar:140-179`.

2. **`ONBOARDING.md` is the standout document.** It is realistic and battle-tested:
   - It correctly explains **seed-before-loan** and *why* (`ONBOARDING.md:63`) — the one fact that unblocked us.
   - It gives honest mainnet cost floors (`ONBOARDING.md:108`).
   - The troubleshooting section anticipates real failures (the `mbegu2` filename gotcha `:133/:425`, `ConflictingNonceInMempool` `:410`, the `bd init` git-push failure `:413`) — we hit several of these verbatim.
   - It distinguishes Scenario A (deploy your receiver on the live protocol) from Scenario B (stand up the whole stack on testnet) — exactly the right framing.

3. **The three hard Clarity rules are stated and they are the right rules.** Dynamic fee lookup (never hard-code `u5`), `as-contract` on repayment, and literal principals for trait arguments appear in `BUILD_A_RECEIVER.md:85-90` and `INTEGRATION_GUIDE.md:111-114`. All three are real and all three bit us during development — the docs were correct to emphasize them. Verified against `flashstack-stx-core.clar:201-203` (dynamic fee) and our own deploy experience.

4. **Minimum-fee handling is documented and matches source.** `(if (> raw-fee u0) raw-fee u1)` for tiny loans (`BUILD_A_RECEIVER.md:90`) matches `flashstack-stx-core.clar:147`.

5. **`API_REFERENCE.md` correctly captures the STX-vs-sBTC error-code divergence** (`:294-303`) — it is the only doc that does. It also correctly documents `is-approved-receiver` as returning bare `bool` for the STX core (`:219`).

6. **Confirmed mainnet transactions are cited and they verify.** The arb tx and the sBTC tx (`API_REFERENCE.md:389-391`, `README.md:84-86`) are real — we independently confirmed the sBTC evidence tx `0x67f0c77d…` is `success / (ok true)`, block 7875468. Citing live, checkable evidence is exactly right for grant reviewers.

7. **Worked use cases are concrete** (arb, flash liquidation, collateral swap, yield vault — `INTEGRATION_GUIDE.md:223-308`), each with a code pattern and a link to a real contract.

---

## Missing Information

Things that were **required during our integration but are absent from the primary docs** (`INTEGRATION_GUIDE.md` / `BUILD_A_RECEIVER.md`):

### M1 — Receiver funding ("seed-before-loan") is missing from the two start-here docs
This was our single biggest non-obvious blocker. The receiver pays the fee — and absorbs any DEX slippage — **from its own balance** inside `execute-stx-flash`, *before* returning (`flashstack-stx-core.clar:166-167` checks `reserve-after ≥ reserve-before + fee`). A freshly deployed 0-balance receiver therefore cannot borrow even 1 µSTX.

- It is correctly explained in `ONBOARDING.md:63` and, for sBTC, `TESTING_GUIDE_SBTC.md:176`.
- It is **absent** from `INTEGRATION_GUIDE.md` and `BUILD_A_RECEIVER.md`, both of which instead lead with "**Zero capital required**" / "**You do not need capital**" (`INTEGRATION_GUIDE.md:13`, `BUILD_A_RECEIVER.md:25`).
- That headline is true only for a **strictly net-profitable** strategy. For an execution/validation or break-even receiver (like ours), the round-trip returns slightly less than principal, so the seed is mandatory. We seeded 1 STX; the round-trip cost ~0.0015 STX + the 0.0005 STX fee.

**Fix:** add a "Funding your receiver" box to both primary docs; reframe "zero capital" as "**zero collateral**" (accurate) and add "your receiver must hold enough of the borrowed asset to cover the fee plus any slippage your strategy incurs."

### M2 — The external-deploy absolute-principal rule is not explained
The templates use absolute principals, but never say *why*, and all three docs point developers to **read `bitflow-arb-receiver.clar` as the model** (`INTEGRATION_GUIDE.md:233`, `BUILD_A_RECEIVER.md:135`, `ONBOARDING.md:438`). That in-repo contract uses `.flashstack-stx-core` **sugar**, which resolves to *the deployer's own address*. It works only because it is deployed under the protocol owner. An external developer who copies it verbatim gets a receiver that calls a non-existent contract under their own address. We had to rewrite every reference to the absolute `SP20XD46….flashstack-stx-core` (our ADR-001).

**Fix:** a short "External (non-deployer) receivers" section stating the rule, plus an external-ready copy of the example that uses absolute principals.

### M3 — sBTC reserve size is not stated, and it is the real cap
Docs advertise an sBTC max-single-loan of 0.1 BTC (`TESTING_GUIDE_SBTC.md:87`). But the borrow guard requires `reserve ≥ amount` (`flashstack-sbtc-core.clar:68`), and the **live sBTC reserve is only 15,010 sats** (~0.00015 BTC; verified via `get-reserve-balance`). So an sBTC borrower today can draw at most ~15k sats regardless of the 0.1 BTC cap. (The STX reserve is healthier at ~75 STX.) Borrowers need to know to check `get-reserve-balance` first — and that it can be far below the advertised max.

### M4 — No documented read-only pre-flight / estimator pattern
`BUILD_A_RECEIVER.md:211` and `TESTING_GUIDE_STX.md:151` reference a `simulate` / `estimate-profit` read-only, but no doc shows how to write one, and the **literal-principal-in-`define-read-only`** gotcha is undocumented. We hit it as a real pre-broadcast bug: a `define-constant` core principal is rejected inside a read-only function because Clarity can't prove the cross-contract call is read-only; the fix is to inline the literal principal. A "pre-flight" recipe (estimate repayment + quote the DEX round-trip via Bitflow `get-dy`/`get-dx`) would save every integrator this round.

### M5 — The Clarinet coverage gap is not stated
`README.md:130` advertises `npm run check` ("Clarinet contract verification"), but the STX/Bitflow suite is **not in the Clarinet project** — it is script-deployed via `makeContractDeploy`, which does not type-check Clarity. So `clarinet check` silently does **not** validate a new STX receiver, and a simnet remap of hard-coded mainnet principals fails with `NoSuchContract`. We had to validate in a separate stub Clarinet project. The docs should state what `clarinet check` does and does not cover.

---

## Confusing Areas

Places where wording is ambiguous, contradictory, or requires reading source to resolve:

1. **"Zero capital required" vs. "pre-fund your receiver."** Until you understand the fee-source model (M1), `INTEGRATION_GUIDE.md:13` ("you do not need capital") reads as a direct contradiction of `TESTING_GUIDE_SBTC.md:176` ("Pre-fund your receiver"). Both are "true," but only with the nuance spelled out.

2. **"Same interface" for the sBTC core is misleading** (`API_REFERENCE.md:307`). The sBTC core is **not** the same interface:
   - `get-stats` returns **4 fields** (`total-loans, total-volume, total-fees-collected, paused` — `flashstack-sbtc-core.clar:182-189`) vs the STX core's **7** (adds `reserve, fee-basis-points, max-single-loan` — `flashstack-stx-core.clar:189-199`). Different field name too (`total-fees-collected` vs `total-fees`).
   - `is-approved-receiver` returns `(ok bool)` (`:191-193`) vs the STX core's bare `bool` (`flashstack-stx-core.clar:209-211`).
   - `withdraw-reserve` takes `(amount, to)` (`:108`) vs the STX core's `(amount)` (`flashstack-stx-core.clar:66`).
   - Admin transfer is single-step `set-admin` (`:155`) vs the STX core's two-step `transfer-admin` + `accept-admin` (`flashstack-stx-core.clar:114-130`). (`API_REFERENCE.md` documents neither `accept-admin` nor `get-pending-admin`.)

3. **Error-code numbers are reused across contracts.** `u300` is `ERR-NOT-ADMIN` on the STX core (`flashstack-stx-core.clar:25`) but `ERR-PAUSED` on the sBTC core (`flashstack-sbtc-core.clar:24`); the pools use `u700+` (`flashstack-sbtc-pool.clar:30`). The same number means different things on different contracts — easy to misread when debugging.

4. **Two deployer wallets.** The STX trait lives under the **legacy** `SP3TGRVG7…` deployer while everything else is under `SP20XD46…`. `ONBOARDING.md:81` calls this out; the other docs just print the address without explanation, so it looks like a typo until you check.

---

## Confirmed Factual Errors (verifiable)

Each of these was checked against source or chain. These should be corrected directly.

| # | Where | Claim | Reality (source/chain) |
|---|---|---|---|
| E1 | `INTEGRATION_GUIDE.md:71,383`; `API_REFERENCE.md:137`; `TESTING_GUIDE_STX.md:102,171` | max-single-loan = **5,000 STX** (variously `u5000000000` or "500,000,000,000 microSTX = 5,000 STX") | Live `get-stats` → `max-single-loan u500000000000` = **500,000 STX**. The literal in `flashstack-stx-core.clar:44` is `u500000000000` and even its inline comment ("5,000 STX") is wrong. Docs are **100× off**, and `TESTING_GUIDE_STX`'s `u5000000000` is a different (also wrong) value. |
| E2 | `README.md:174` | STX receiver `impl-trait 'SP20XD46….flashstack-stx-core.stx-flash-receiver-trait` | Trait is at `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait` (`flashstack-stx-core.clar:17`, `API_REFERENCE.md:315`, our deployed receiver). The README snippet **will not deploy**. |
| E3 | `ONBOARDING.md:401,404,407` | `(err u3)` NOT-APPROVED, `(err u4)` EXCEEDS-LIMIT, `(err u6)` INSUFFICIENT-RESERVE | Source: `u306`, `u304`, `u303` (`flashstack-stx-core.clar:31,29,28`). Off by the `u300` base. |
| E4 | `TESTING_GUIDE_STX.md:77-79` | `get-stats` has `total-flash-mints`, `total-fees-collected` | STX `get-stats` returns `total-loans, total-volume, total-fees` (`flashstack-stx-core.clar:189-199`). `total-flash-mints` exists nowhere; `total-fees-collected` is the **sBTC** field. |
| E5 | `TESTING_GUIDE_STX.md:16-18,184` | The sBTC path is "legacy — SP3TGRVG7… wallet… do not test" | `flashstack-sbtc-core` (under `SP20XD46…`) is **live**: reserve 15,010 sats, `total-loans u2`, fee 5 bps, not paused; evidence tx `0x67f0c77d…` `(ok true)` block 7875468. Contradicts `README.md:46`, `INTEGRATION_GUIDE.md:39`, `ONBOARDING.md:74`, `TESTING_GUIDE_SBTC.md:16`. |
| E6 | `TESTING_GUIDE_STX.md:104-105` | STX `is-approved-receiver` → `(ok true)` | STX core returns bare `bool` `true` (`flashstack-stx-core.clar:209-211`). The `(ok …)` form is the **sBTC** core's. |
| E7 | `INTEGRATION_GUIDE.md:269` | `(max (/ (* amount fee-bp) u10000) u1)` | Clarity has no `max` builtin; this snippet does not compile. Use the `(if (> raw-fee u0) raw-fee u1)` form used everywhere else. |
| E8 | `INTEGRATION_GUIDE.md:145` | Whitelist check: `"0x$(printf 'YOUR-ADDRESS.my-receiver' | xxd -p)"` | This hex-encodes the **ASCII string**, not a Clarity-serialized principal. The read-only `is-approved-receiver` needs a serialized `contract-principal` clarity value (`0x06…`), so this curl cannot return `true`. (Generate it with `Cl.serialize(Cl.contractPrincipal(addr,name))`.) |
| E9 | `README.md:6,257` vs `:129,282,305`; `TESTING_GUIDE_STX.md:190` vs `ONBOARDING.md:176` | Test count is **82** in some places, **86** in others | Pick one; it appears inconsistently within `README.md` alone. |

---

## Recommended Improvements

**Priority 1 — correct the confirmed errors (E1–E9).** Mostly one-line edits. E1, E2, E3, E8 are the highest-impact because they actively mislead or break copy-paste.

**Priority 2 — close the three integration walls (M1–M2 + whitelist):**
- Add a **"Funding your receiver"** callout to `INTEGRATION_GUIDE.md` and `BUILD_A_RECEIVER.md`: the fee-source model, when a seed is required (any non-strictly-profitable strategy), how to size it (fee + worst-case slippage), and how to recover it (`rescue-stx`). Reframe "zero capital" → "zero collateral."
- Add an **"External (non-deployer) receivers"** section: the absolute-principal rule, why `.sugar` resolves to the deployer, and an external-ready copy of the arb example.
- Establish **one canonical whitelist channel** with the read-only verification snippet (using a correctly serialized principal — see E8) and one realistic SLA. Today the channel is given four different ways (GitHub issue / DM @flashstackbtc / "DM the txid" / "Slack or email Matt") across `INTEGRATION_GUIDE.md:137`, `BUILD_A_RECEIVER.md:205`, `ONBOARDING.md:250`, `TESTING_GUIDE_STX.md:198`.

**Priority 3 — add two reference aids:**
- A **per-contract reference card** (one table: contract → error-code base → `get-stats` shape → `is-approved-receiver` return type → admin model) to kill the "same interface" confusion (Confusing #2/#3).
- A **read-only pre-flight recipe** (M4): an `estimate-repayment`-style function, the literal-principal-in-read-only rule, and a Bitflow `get-dy`/`get-dx` round-trip quote.

**Priority 4 — set expectations on tooling and reserves (M5, M3):**
- State exactly what `npm run check` / Clarinet covers (the legacy sBTC simnet set) and that new STX receivers must be validated via a stub project or testnet (Scenario B).
- Surface the **live reserve** (or a dashboard link) so borrowers size loans to `get-reserve-balance`, not the advertised max.

**Suggested diagrams:**
- A **fee-source / seed lifecycle** diagram (where the fee comes from, why a 0-balance receiver reverts).
- A **principal-resolution** diagram contrasting `.sugar` (resolves to *your* address) vs absolute principal for external vs protocol-owned receivers.

---

## Appendix — verification

All checks run 2026-06-06 against `https://api.hiro.so` (mainnet) and the `contracts/` source in this repo.

- max-single-loan: `get-stats` on `flashstack-stx-core` → `max-single-loan u500000000000` (= 500,000 STX). Source literal `flashstack-stx-core.clar:44`.
- STX trait location: `flashstack-stx-core.clar:17` `(use-trait … 'SP3TGRVG7…stx-flash-receiver-trait …)`.
- Error codes: `flashstack-stx-core.clar:25-34`; `flashstack-sbtc-core.clar:24-31`.
- `get-stats` shapes: `flashstack-stx-core.clar:189-199` (7 fields) vs `flashstack-sbtc-core.clar:182-189` (4 fields).
- sBTC live state: `flashstack-sbtc-core.get-reserve-balance` → `(ok u15010)`; `get-stats` → `total-loans u2`; evidence tx `0x67f0c77d9d7ab9762c08a3638ba0990d5bbc3d19db8adc1a0d616cd7170f9baa` → `success / (ok true)` / block 7875468.
- Our Milestone 1 flash loan (reference integration): `865df57633fd111c76df3db5caa73577093e91e967af901a89db8de9cf639737` → `(ok true)`, block 8197535.

*This review is written from the perspective of an external developer who completed the integration successfully — the protocol works and the docs are good; these notes are about making the next integrator's path as clean as ours eventually became.*
