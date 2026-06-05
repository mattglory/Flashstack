---
title: hk-sbtc-real-receiver-v1 — Design Proposal (Phase C)
date: 2026-06-06
type: design
status: proposal
implementation: NOT STARTED
milestone: 2 (proposed)
---

# hk-sbtc-real-receiver-v1 — Design Proposal

> **Status: DESIGN ONLY — no implementation.** This is the Phase C planning deliverable for Matt request #2 (external sBTC strategy receiver). It assumes [[docs-feedback-report|Phase A]] and [[sBTC-Architecture-Review|Phase B]] are complete (they are). Implementation must not begin until this proposal is reviewed.

Related: [[sBTC-Architecture-Review]] · [[hk-stx-bitflow-receiver-v1-Design]] · [[ADR]] · [[Milestone-1-Completion-Report]] · [[Future-Roadmap]]

---

## 1. Objective

Mirror the Milestone 1 achievement on the **canonical sBTC** engine: an external-wallet receiver that borrows sBTC from the live `flashstack-sbtc-core`, performs a **real DEX round-trip** (sBTC → wSTX → sBTC on Velar), and repays principal + fee **atomically**. Objective is **successful external strategy execution + repayment, not profit** — identical bar to M1.

---

## 2. Architecture proposal

`hk-sbtc-real-receiver-v1` = **`hk-stx-bitflow-receiver-v1` skeleton** (caller gate + absolute principals + dynamic fee + fail-closed repay + rescue + read-only estimate) **⊕ `velar-sbtc-arb-receiver` swap legs** (the proven sBTC→wSTX→sBTC round-trip on Velar pool 70).

```
flashstack-sbtc-core.flash-loan(amount, hk-sbtc-real-receiver-v1)
  → transfers sBTC (sats) to receiver
  → receiver.execute-sbtc-flash(amount, core)
       assert contract-caller == flashstack-sbtc-core   ;; CALLER GATE (new vs velar ref)
       fee-bp = (sbtc-core get-fee-basis-points)          ;; dynamic
       owed   = amount + max(amount*fee-bp/10000, 1)
       Leg 1: as-contract Velar swap sBTC → wSTX (pool 70, min-out u1)
       Leg 2: as-contract Velar swap wSTX → sBTC (all wSTX, min-out u1)
       assert sbtc-balance(self) >= owed   else ERR-REPAY
       as-contract sbtc-token.transfer owed → core (memo none)
       print { event: "sbtc-velar-roundtrip", amount, fee, wstx-mid, sbtc-after }
       (ok true)
```

**Key structural points:**
- `(impl-trait 'SP20XD46….sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)` (protocol-deployer trait).
- Import a minimal **SIP-010 trait** to call `sbtc-token` and `wstx` (`get-balance`, `transfer`).
- Repay via `(as-contract (contract-call? SBTC transfer owed tx-sender core none))` — not `stx-transfer?`.
- Every cross-contract principal is **absolute** (external deploy).
- Owner-only `rescue-sbtc(amount, to)` and `set-slippage-bp`; read-only `estimate-repayment(amount)`.

---

## 3. Architectural Decision Records (sBTC)

| ADR | Decision | Rationale |
|---|---|---|
| **ADR-S1** | Reuse the M1 receiver skeleton, swap STX primitives → SIP-010 sBTC calls | M1 is proven; minimizes new surface |
| **ADR-S2** | Add a **caller gate** (`contract-caller == flashstack-sbtc-core` → `ERR-WRONG-CALLER`) | The reference `velar-sbtc-arb-receiver` exposes a **public** `execute-sbtc-flash` with no gate — a direct-drain vector our `hk-stx-real-receiver-v2` specifically closed. Non-negotiable. |
| **ADR-S3** | Venue = **Velar univ2 pool 70** (sBTC/wSTX) for v1 | Only proven, whitelisted on-chain sBTC round-trip in-repo; router/pool/wstx all verified live. Accept the ~0.6% round-trip cost; objective is execution, not profit. |
| **ADR-S4** | `min-out = u1` on both legs; repay-assert + core reserve check are the gates | Same pattern as M1; avoids percentage-floor reverts on a thin pool |
| **ADR-S5** | **Absolute** mainnet principals everywhere | External deploy; `.sugar` would resolve to our wallet (M1 ADR-001) |
| **ADR-S6** | Seed the receiver with **real canonical sBTC**, sized to round-trip cost + margin; recover via `rescue-sbtc` | Receiver pays fee + slippage from its own balance; Velar ~0.6% cost dominates the 5 bps fee |
| **ADR-S7** | Size the loan to the **live reserve** (~15,010 sats) unless Matt tops up `deposit-reserve` | Guard `reserve ≥ amount`; advertised 0.1 BTC max is irrelevant at current reserve |

*(To be appended to [[ADR]] on approval.)*

---

## 4. Deployment plan (mirrors M1)

1. **Pre-flight:** confirm `flashstack-sbtc-core` not paused, fee, **live reserve** (`get-reserve-balance`), max-loan; confirm Velar pool 70 liquidity via a read-only quote.
2. **Acquire sBTC seed** (external dependency, see §6): bridge BTC or buy a few thousand sats on a Stacks DEX with STX we hold.
3. **Validate** in a stub Clarinet project (sBTC-core + sbtc-token + Velar router stubs mirroring live interfaces) — `clarinet check` 0/0.
4. **Deploy** `hk-sbtc-real-receiver-v1` to mainnet (~0.5 STX; `DRY_RUN` first).
5. **Whitelist:** Matt calls `add-approved-receiver` on `flashstack-sbtc-core`; verify `is-approved-receiver → (ok true)` (note: **`(ok bool)`**, unwrap it).
6. **Seed** the receiver with sBTC; verify its `sbtc-token` balance.
7. **Dry-run** the executor, then **execute** `flash-loan(amount, receiver)` → expect `(ok true)`.
8. **Collect evidence** (txid, `sbtc-velar-roundtrip` event, Velar swap events, reserve delta, `total-loans` +1) into an execution-evidence note.
9. **Recover** the residual sBTC seed via `rescue-sbtc`.

New scripts (to write at implementation time): `deploy-hk-sbtc-receiver.mjs`, `seed-hk-sbtc-receiver.mjs` (a SIP-010 transfer, not `stx-transfer?`), `execute-sbtc-flash-loan.mjs`.

---

## 5. Testing plan

- **Static:** `clarinet check` in a stub project (the live sBTC suite is not in the Clarinet project — same gap as STX, see [[docs-feedback-report]] M5). Stubs: `sbtc-token` (SIP-010), `flashstack-sbtc-core` (get-fee-basis-points + execute path), Velar `univ2-router` (swap-exact-tokens-for-tokens).
- **Read-only pre-flight:** `estimate-repayment(amount)` (fee math) + a live Velar round-trip quote (sBTC→wSTX→sBTC) to confirm `seed + return ≥ owed` before broadcasting — the M1 lesson.
- **Dry-run:** build the flash-loan tx with `DRY_RUN=1`, confirm preflight reads (`is-approved-receiver`, reserve).
- **Live:** smallest viable loan (e.g. a few thousand sats, ≤ reserve). Success = `(ok true)` + round-trip event + reserve `+fee`.
- **Negative:** direct call to `execute-sbtc-flash` from a non-core sender must return `ERR-WRONG-CALLER` (proves the caller gate).

---

## 6. Funding, dependencies, and requirements

| Question | Answer |
|---|---|
| **Is real sBTC required?** | **Yes.** The receiver must hold canonical sBTC to cover fee + Velar round-trip slippage before the first loan. (Unlike M1, we do **not** already hold sBTC.) |
| **Estimated funding** | Deploy ~0.5 STX + tx fees ~0.3 STX (STX-denominated) **plus** an sBTC seed of ~1,000–5,000 sats (covers ~0.6% Velar cost on a small loan + margin). Total < ~$10 equivalent beyond STX already held. |
| **How to source sBTC** | Bridge BTC via the sBTC bridge, **or** buy sBTC on Velar/Bitflow using STX. Has a confirmation delay — do it before the execution window. |
| **Whitelist** | Admin-only `add-approved-receiver` on `flashstack-sbtc-core` — same dependency on Matt as M1. |
| **Reserve top-up** | Live reserve ~15,010 sats caps the loan. For a non-trivial demo, ask Matt to `deposit-reserve` more sBTC. Confirm desired loan size with him. |
| **External deps** | (1) acquire sBTC, (2) Matt whitelist, (3) Velar pool 70 liquidity, (4) optional reserve top-up. |

---

## 7. Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Reusing `velar` legs **without** the caller gate | High | ADR-S2 — add `contract-caller == core` gate; negative test it |
| Velar univ2 ~0.6% round-trip cost > 5 bps fee → larger seed | Medium (DoS/seed-size only, no loss) | `min-out=u1` + repay-assert; size seed; keep loan small |
| Tiny sBTC reserve (~15k sats) caps loan | Medium (demo scope) | ADR-S7; request reserve top-up from Matt |
| Acquiring real sBTC (bridge/buy delay) | Medium | Sequence sBTC acquisition before deploy/execute |
| sBTC core `set-fee-basis-points` bug (wrong err / no floor) | Low (protocol, not ours) | Flag to Matt; dynamic fee lookup tolerates fee changes |
| SIP-010 transfer post-conditions | Low | `PostConditionMode.Allow` on the execute tx (as M1) |
| Stranded sBTC after partial round-trip | Low | owner-only `rescue-sbtc` |
| Reserve at risk | **None** | Atomic; under-repay reverts the whole tx |

---

## 8. Definition of done (proposed Milestone 2)

Receiver deployed → whitelisted (`is-approved-receiver → (ok true)`) → seeded with sBTC → `flash-loan(amount)` confirmed `(ok true)` → `sbtc-velar-roundtrip` event + Velar swap events + reserve `+fee` captured → seed recovered → evidence package + docs + Beads closed.

**Gate before implementation:** approval of this proposal, confirmation of the target loan size / reserve top-up with Matt, and acquisition of the sBTC seed.

---

*Phase C deliverable. Design only — implementation deferred pending review. Verified against `contracts/` source and live mainnet reads, 2026-06-06.*
