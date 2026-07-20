---
title: Milestone 1 — Completion Report
date: 2026-06-06
status: complete
milestone: 1
type: completion-report
audience: [Matt, FlashStack records, Stacks Endowment]
---

# FlashStack Milestone 1 — Completion Report

> **Status: ✅ COMPLETE (2026-06-06).** An external-wallet receiver borrowed STX from the live `flashstack-stx-core`, executed a real STX → stSTX → STX round-trip on the Bitflow stableswap, and repaid principal + fee **atomically** on Stacks mainnet. Objective — *successful external strategy execution + repayment, not profit* — fully met.

Related: [[Milestone-1-Execution-Evidence]] · [[FLASHSTACK_PROJECT_HANDOFF_2026-06-06]] · [[Phase7-Deliverables]] · [[Phase6-Validation]] · [[hk-stx-bitflow-receiver-v1-Design]] · [[ADR]] · [[Future-Roadmap]] · [[Dashboard]]

---

## 1. Objective vs. outcome

| Success criterion | Result |
|---|---|
| External-wallet receiver deployed | ✅ `SP3NZYZA88…hk-stx-bitflow-receiver-v1` (deploy tx `7e5b3ec5…dea567`, block 8197121) |
| Whitelisted by the protocol admin | ✅ tx `7ae15a50…370b`, block 8197338 (`is-approved-receiver → true`) |
| Flash loan executed | ✅ **`(ok true)`** — tx `865df576…639737`, block 8197535 |
| Real DEX interaction (not a no-op) | ✅ Bitflow STX→stSTX→STX round-trip, 861,402 µstSTX mid |
| Atomic repayment | ✅ 1.000500 STX repaid; core reserve +500 µSTX; `total-loans` 8→9 |
| On-chain evidence collected | ✅ [[Milestone-1-Execution-Evidence]] |
| Documentation | ✅ full vault + repo handoff |

**Result: every criterion met and independently re-confirmed canonical on-chain.**

---

## 2. What was delivered

- **Contract:** `contracts/hk-stx-bitflow-receiver-v1.clar` (176 lines) — caller-gated, dynamic fee lookup, two Bitflow legs, fail-closed repay, owner-only `rescue-stx`/`set-slippage-bp`, read-only `estimate-repayment`.
- **Scripts:** `deploy-hk-bitflow-receiver.mjs`, `execute-bitflow-flash-loan.mjs`, and new `seed-bitflow-receiver.mjs`.
- **Knowledge base:** architecture, lifecycle, receiver comparison, Bitflow analysis, design + ADRs, validation, deliverables, execution evidence.
- **Architecture:** `hk-stx-bitflow-receiver-v1` = `hk-stx-real-receiver-v2` (caller gate + absolute principals) ⊕ `bitflow-arb-receiver-v4` (the Bitflow round-trip). **No protocol contract was modified.**

---

## 3. On-chain transaction chain

| # | Step | TXID | Result | Block |
|---|---|---|---|---|
| 1 | Deploy | `7e5b3ec55357d119470aa79fe7d5e32c07922b7b7f2c975281cb8456f7dea567` | `(ok true)` | 8197121 |
| 2 | Whitelist (Matt) | `7ae15a501a011710eeff0a4a330bab57e77d931296a4cf7a3659811ce108370b` | success | 8197338 |
| 3 | Seed 1 STX | `732374dfb1f6123d41d8d872bcbc27e09a47ceb26da0dd95b3a43b1cdf732b4c` | `(ok true)` | 8197525 |
| 4 | **Flash loan** | **`865df57633fd111c76df3db5caa73577093e91e967af901a89db8de9cf639737`** | **`(ok true)`** | 8197535 |
| 5 | Rescue seed | `f605a7bf6c51b760e65cf87ea383c29a39f2726bd9f29f71e0be25b9d2de743d` | `(ok true)` | 8197553 |

Net cost: **0.3215 STX** (0.30 loan tx fee + two 0.01 tx fees + 0.0015 round-trip). Seed fully recovered. The protocol reserve was never at risk — the loan is atomic.

---

## 4. Lessons learned

These are distilled for reuse on the sBTC track and as input to the [[docs-feedback-report|documentation feedback report]].

1. **Verify on-chain state, never trust pasted hashes.** The resume handoff carried a garbled 62-char whitelist txid; the authoritative 64-char tx was recovered by scanning the admin wallet's `add-approved-receiver` calls, and approval was confirmed independently by read-only `is-approved-receiver → true`. Ground every claim in a live read.
2. **Seed-before-loan is mandatory and non-obvious.** The receiver pays the fee (and absorbs any round-trip slippage) from its *own* balance inside the callback, so a 0-balance receiver cannot borrow even 1 µSTX. The public docs' "zero capital required" framing is true only for net-profitable strategies — execution/validation receivers need a seed buffer.
3. **External deploys require absolute principals.** `.flashstack-stx-core` sugar resolves to the *deployer's* address; the in-repo `bitflow-arb-receiver` (which the docs point to as the model) only works because it's deployed under the protocol deployer. An external receiver must hard-code `SP20XD46….flashstack-stx-core`.
4. **Read-only cross-contract calls need a *literal* target.** A `define-constant` principal works in public functions but is rejected inside `define-read-only` (Clarity can't prove read-only-ness). Caught and fixed pre-broadcast.
5. **stSTX trades off-peg; percentage slippage floors backfire.** `min-out = u1` + a repay-assert is the pragmatic pattern for an execution objective; tighten the floor only for a profit strategy.
6. **Clarinet ≠ the deploy path here.** The STX/Bitflow suite is script-deployed (`makeContractDeploy`, no type-check); `clarinet check` only covers the old sBTC set. Validate new receivers in a scratch/stub Clarinet project.
7. **Secret hygiene.** A live 24-word mainnet seed phrase (`./mbegu`) sits at the repo root; now gitignored. Recommend relocating out of the repo.
8. **`rescue-stx` is worth always including.** The owner-only escape hatch cleanly recovered the residual seed and is itself a useful piece of evidence that the safety hatch works.

---

## 5. Status roll-up

- **Beads:** epic `Flashstack-n9p` closed (6/6, 100%); memory `milestone-1-complete-flash-loan-executed-2026-06`.
- **Obsidian:** [[Milestone-1]] = complete; [[Milestone-1-Execution-Evidence]] filed; [[Blockers]] cleared; [[Dashboard]] + [[Future-Roadmap]] updated.
- **Next (Matt requests, now unblocked):** P1 documentation feedback ([[docs-feedback-report]]) → P2 sBTC architecture research ([[sbtc-architecture-review]]) → P3 `hk-sbtc-real-receiver-v1` design ([[hk-sbtc-real-receiver-v1-Design]]). One milestone at a time.

---

*Generated 2026-06-06 from live mainnet reads and source verification.*
