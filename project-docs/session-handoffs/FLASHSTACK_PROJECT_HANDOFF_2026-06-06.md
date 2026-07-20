---
title: FlashStack Project Handoff
date: 2026-06-06
status: active
milestone: 1
type: handoff
entrypoint: true
---

# FLASHSTACK PROJECT HANDOFF — 2026-06-06

> **This is the primary project entry point.** A new session should read [[#19 START HERE NEXT SESSION]] first, then [[#20 RECOVERY PROMPT FOR NEXT CLAUDE SESSION]].
> Related: [[00-Index]] · [[FlashStack-Architecture]] · [[hk-stx-bitflow-receiver-v1-Design]] · [[Bitflow-Roundtrip-Analysis]] · [[Phase6-Validation]] · [[Phase7-Deliverables]] · [[Blockers]] · [[ADR]]

---

## 1. Executive Summary

**Technical.** FlashStack is an atomic flash-loan protocol on Stacks (a Bitcoin L2, Clarity 3 / Nakamoto). It runs an *admin-reserve + LP-pool* model (like Aave): `flashstack-stx-core` holds an STX reserve, lends it uncollateralised to a whitelisted *receiver* contract within a single transaction, and asserts the reserve grew by ≥ the fee (0.05%) before returning — otherwise the whole transaction reverts. A sibling sBTC stack (`flashstack-sbtc-core`) does the same for canonical sBTC.

**Non-technical.** FlashStack lets a developer borrow a large amount of STX for a few seconds with no collateral, *provided* they pay it back (plus a tiny fee) inside the same transaction. If they can't, it's as if the loan never happened. This is useful for arbitrage, liquidations, and collateral swaps.

**This engagement.** We are an **external integrator** validating that a third-party developer can build and run a real strategy on the live protocol. The larger goal is to prove FlashStack's external-developer path end-to-end and give Matt (the protocol owner) credible, on-chain evidence plus integration feedback.

**Why the receiver was built / why it matters.** Matt asked for a receiver that actually *does something* against a real DEX — not a do-nothing borrow/repay. We built `hk-stx-bitflow-receiver-v1`, which borrows STX, performs a real **STX → stSTX → STX** round-trip on the **Bitflow** stableswap, and repays atomically. It proves three things at once: (1) the whitelist + callback model works for an external wallet, (2) a receiver can interact with an unrelated live DEX inside the loan, and (3) the atomic repayment guarantee holds against real market mechanics. Objective is **successful execution + repayment, not profit.**

---

## 2. Current Project Status

**Overall completion: 100% of Milestone 1 — COMPLETE (2026-06-06).** Receiver designed, built, validated, deployed, whitelisted, seeded, executed, and proven on mainnet. Full proof: [[Milestone-1-Execution-Evidence]].

| Item | State |
|---|---|
| Active milestone | **Milestone 1 — External Strategy Receiver vs real DEX (Bitflow)** |
| Receiver designed | ✅ |
| Receiver implemented | ✅ `contracts/hk-stx-bitflow-receiver-v1.clar` |
| `clarinet check` | ✅ 0 errors / 0 warnings (stub harness) |
| Deploy dry-run | ✅ |
| Mainnet preflight | ✅ core healthy, reserve 75 STX |
| **Deployed to mainnet** | ✅ tx `7e5b3ec5…dea567`, block 8197121 |
| Branch pushed to origin | ✅ `feature/hk-stx-bitflow-receiver-v1` |
| **Whitelist by Matt** | ✅ tx `7ae15a50…370b`, block 8197338 (`is-approved-receiver → true`) |
| Seed receiver (1 STX) | ✅ tx `732374df…732b4c`, block 8197525 |
| Execute `flash-loan(u1000000)` | ✅ **`(ok true)`** tx `865df576…639737`, block 8197535 |
| Collect on-chain proof | ✅ [[Milestone-1-Execution-Evidence]] |
| Seed recovered (`rescue-stx`) | ✅ tx `f605a7bf…743d`, block 8197553 |
| Milestone 1 closed | ✅ |

**Blockers:** none — all resolved.
**Result:** flash loan executed `(ok true)`; Bitflow round-trip cleared (861,402 µstSTX mid); reserve +500 µSTX (fee); total-loans 8→9; total wallet spend 0.3215 STX; seed fully recovered. Our wallet `SP3NZYZA88…` now ~36.74 STX.

---

## 3. Original Requests From Matt

| # | Request | Purpose | Value to FlashStack | Status |
|---|---|---|---|---|
| 1 | **External strategy receiver against a real DEX** | Prove an outside dev can run a non-trivial strategy on the live protocol | Real external validation; reusable reference for future integrators | **In progress — deployed, awaiting whitelist** (Milestone 1) |
| 2 | **Test integration against `flashstack-sbtc-core`** | Exercise the canonical-sBTC flash-loan path the same way | Validates the sBTC engine externally | **Not started** (deferred until M1 done) → future `hk-sbtc-real-receiver-v1` |
| 3 | **Feedback on integration documentation** | Surface gaps an external dev actually hits | Improves onboarding/DX; reduces support load | **Not started** (deferred) — material already accumulating (see §18) |

Per the engagement rules, only **one milestone at a time**; #2 and #3 do not start until Milestone 1 is complete.

---

## 4. Milestone 1 Summary

**Goal.** Deliver an external-wallet receiver that interacts with a real DEX through FlashStack and repays atomically. Success = execution + flash loan + DEX interaction + repayment + on-chain evidence + documentation. **Not** profit.

**Scope.** One new receiver contract + deploy script + executor script + full knowledge base. **No protocol contracts modified.**

**Architecture.** `hk-stx-bitflow-receiver-v1` = **hk-stx-real-receiver-v2** (contract-caller gate + absolute mainnet principals, required for an external deploy) **⊕ bitflow-arb-receiver-v4** (the STX/stSTX Bitflow round-trip). See §7 and [[hk-stx-bitflow-receiver-v1-Design]].

**Design decisions (full set in [[ADR]]):**
- **ADR-001** Absolute mainnet principals (the `.flashstack-stx-core` sugar would resolve to *our* address).
- **ADR-002** Caller gate Form A (hard-coded core principal) over Form B (trust passed arg).
- **ADR-003** `min-out = u1` on both legs; the repay-assert + core reserve check are the real safety gates.
- **ADR-004** Knowledge base lives outside the repo (clean deliverable diff).

**Validation.** clarinet check 0/0, deploy dry-run, mainnet preflight, live 1-STX round-trip quote. One real bug found+fixed (read-only literal principal). See §9 and [[Phase6-Validation]].

**Deliverables.** Branch, 3 files (+468), architecture summary, risk assessment, test evidence — see §6 and [[Phase7-Deliverables]].

---

## 5. Repository Work Performed

- **Synchronization:** local `main` had diverged (1 local-only `bd init` commit; origin had advanced 4). Rebased the local commit onto `origin/main`, pulling 4 upstream commits (yield-vault-v5, Nova audit fixes, Zest V2 liquidation receiver + scanner, monitor repoint).
- **Branches reviewed:** `main`, `feature/hk-real-receiver` (v1), `feature/hk-real-receiver-v2` (v2 caller-gate), `fix/deploy-testnet-seed-receiver`. All feature branches in sync with origin.
- **Contract mapping:** STX suite (`flashstack-stx-core`, `flashstack-stx-pool`, `flashstack-pool-oracle`, `stx-flash-receiver-trait`) + sBTC suite + many receivers. Full map in [[FlashStack-Architecture]].
- **Receiver mapping / comparison:** `stx-test-receiver` (do-nothing), `hk-stx-real-receiver-v2` (caller-gate template), `bitflow-arb-receiver-v4` (live DEX arb). See [[Receiver-Comparison]].
- **Dependency mapping:** core ← trait (`SP3TGRVG7…`); receiver → core + Bitflow pool + stSTX + LP. Bitflow round-trip in [[Bitflow-Roundtrip-Analysis]].

**Important findings:**
1. **`Clarinet.toml` only registers the OLD 11-contract sBTC suite** — the entire STX/Bitflow suite is *not* in the Clarinet project and is deployed directly via `scripts/*.mjs` (`makeContractDeploy`), which does **not** type-check Clarity. So the STX suite has never been `clarinet check`ed in-repo.
2. **External-deploy principal rule** — the in-repo `bitflow-arb-receiver` uses `.flashstack-stx-core` sugar (works only because it's deployed under the protocol deployer). An external receiver must use the absolute `SP20XD46….flashstack-stx-core`.
3. **`./mbegu` is a plaintext 24-word mainnet seed phrase** at repo root — was not gitignored (now fixed).

---

## 6. Deliverables Produced

**Branch:** `feature/hk-stx-bitflow-receiver-v1` (pushed to origin, commit `581fade`).

**Contracts:**
- `contracts/hk-stx-bitflow-receiver-v1.clar` (176 lines) — the receiver. Caller-gated, dynamic fee lookup, two Bitflow legs, fail-closed repay, `rescue-stx`/`set-slippage-bp` admin, read-only `estimate-repayment`/`get-slippage-bp`/`get-owner`.

**Scripts:**
- `scripts/deploy-hk-bitflow-receiver.mjs` (148) — mainnet deploy, `DRY_RUN` aware, reads `MAINNET_MNEMONIC`/`./mbegu2`/`./mbegu`.
- `scripts/execute-bitflow-flash-loan.mjs` (141) — calls `flash-loan(amount, receiver)` on the core; `AMOUNT_USTX`/`DRY_RUN` env; built-in read-only preflight.

**Repo config:** `.gitignore` — added `mbegu`/`mbegu2`.

**Obsidian notes (vault `../Flashstack-Vault/`):** see §17.

**ADRs:** ADR-001…004 in [[ADR]].

**Beads:** epic `Flashstack-n9p` (Milestone 1) with phase tasks; memories (see §16).

---

## 7. Architecture Deep Dive

**FlashStack architecture.** `flashstack-stx-core` holds the reserve, a whitelist (`approved-receivers`), a fee (5 bps), guards (paused / amount>0 / ≤ max-single-loan / approved / reserve≥amount), and the post-callback reserve check. LP pool + oracle sit alongside. Full detail in [[FlashStack-Architecture]].

**Flash loan lifecycle** (from [[Flash-Loan-Lifecycle]]):
```
caller → core.flash-loan(amount, receiver)
  guards → stx-transfer amount → receiver
  → receiver.execute-stx-flash(amount, core)   [YOUR STRATEGY]
       receiver repays amount+fee → core
  → assert reserve-after ≥ reserve-before + fee  → (ok true) | revert
```

**Receiver lifecycle.** Deploy (external wallet) → **whitelist** (admin) → **seed ≥1 STX** (the receiver pays the fee from its own balance, so a 0-STX receiver can't borrow even 1 µSTX) → borrow/execute/repay.

**Dynamic fee lookup.** The receiver reads `get-fee-basis-points` from the core each call rather than hard-coding `u5`; if Matt changes the fee, a hard-coded receiver would silently under-repay and revert.

**Bitflow integration.** Pool `SPQC38PW…stableswap-stx-ststx-v-1-2`. `swap-x-for-y(y-token, lp-token, x-amount, min-y-amount)` = STX→stSTX; `swap-y-for-x(…)` = stSTX→STX. y-token = `SP4SZE49…ststx-token`, lp-token = `SPQC38PW…stx-ststx-lp-token-v-1-2`. Signatures verified against the live mainnet interface.

**STX → stSTX → STX flow** (sequence diagram in [[Bitflow-Roundtrip-Analysis]]):
```
borrow STX → swap-x-for-y → stSTX (held by receiver) → swap-y-for-x → STX → repay amount+fee → core
```
Both legs run under `as-contract` (the assets sit in the receiver's own balance). `min-out = u1` so swaps always clear.

**Atomic repayment model.** The receiver asserts `stx-balance ≥ total-owed` then transfers; the core re-checks the reserve. Any sub-failure → `(err …)` → the entire transaction reverts. The reserve is never at risk; the worst case is a revert (DoS), not a loss.

**Whitelist model.** `add-approved-receiver` / `remove-approved-receiver` are admin-only. This is the choke point that stops anyone pointing the loan at a malicious contract — and the reason we're blocked on Matt.

---

## 8. Deployment Information

| Field | Value |
|---|---|
| **Contract** | `SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW.hk-stx-bitflow-receiver-v1` |
| **Deploy TXID** | `7e5b3ec55357d119470aa79fe7d5e32c07922b7b7f2c975281cb8456f7dea567` |
| **Status** | success · `tx_result = (ok true)` |
| **Block** | 8197121 |
| **Clarity version** | 3 |
| **Deployer wallet** | `SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW` (nonce was 8; ~37.06 STX after deploy) |
| **Explorer** | https://explorer.hiro.so/txid/7e5b3ec55357d119470aa79fe7d5e32c07922b7b7f2c975281cb8456f7dea567?chain=mainnet |

**Deployment validation performed:** tx confirmed `success`/`(ok true)`; contract source published (6,900 bytes); live read-only `estimate-repayment(u1000000)` → `fee-to-pay 500, total-owed 1,000,500` (proves the deployed contract's dynamic fee lookup from the core works on-chain).

---

## 9. Validation Evidence

Full detail in [[Phase6-Validation]].

- **Clarinet:** `✔ 6 contracts checked`, **0 errors / 0 warnings** on the receiver. Validated via a local-stub harness (`/tmp/fs-stub`) because the repo project can't host hard-coded mainnet principals (simnet remap → `NoSuchContract`). Stub signatures mirror the verified live interfaces; receiver principals rewritten to local `.name` sugar (addresses-only delta).
- **Dry-run:** wallet `SP3NZYZA88…`, 37.56 STX, nonce 8, tx builds (14,096 bytes).
- **Mainnet preflight:** core not paused, fee = 5 bps, reserve 75.126 STX, max-single-loan 500,000 STX, receiver not-yet-approved.
- **Live quote:** 1.0 STX → 880,583 µstSTX → **0.999001 STX** back; owed 1.0005 STX; **shortfall 1,499 µSTX (~0.0015 STX)**, covered by a 1 STX seed ~660×.
- **Bug found + fixed:** `estimate-repayment` (read-only) called the core through the `FLASHSTACK-STX-CORE` *constant* — Clarity can't prove a constant-dispatched call is read-only → rejected (would also fail at mainnet publish). Fixed by using the statically-resolvable **literal** core principal in that function.

---

## 10. Risk Register

| Risk | Severity | Mitigation | Outstanding? |
|---|---|---|---|
| `./mbegu` plaintext mainnet **seed phrase** at repo root | **High** | Added to `.gitignore`; kept out of all commits | **Yes** — recommend moving out of repo (`~/.flashstack/mbegu`) or env-only |
| `min-out = u1` (MEV / sandwich / hostile pool) | Medium — **DoS only, no loss** | repay-assert + core reserve check; reserve never at risk | Accept for execution objective; tighten floor for a profit strategy |
| Admin changes fee mid-tx | Low | dynamic fee lookup each call | No |
| Direct call to `execute-stx-flash` | Low | caller gate → `ERR-WRONG-CALLER u403` | No |
| STX stranded after partial round-trip | Low | owner-only `rescue-stx` | No |
| Round-trip returns < owed | Low | seed covers ~0.0015 STX shortfall ~660× on 1 STX; fails closed otherwise | No |
| HTTPS git remote can't auth | Low | switched `origin` to SSH (works) | No |

**Seed-phrase handling observation:** the scripts read `MAINNET_MNEMONIC` env first, then `./mbegu2`, then `./mbegu`. The file is now gitignored but remains a live key on disk; treat with care.

---

## 11. Communication History

- **Milestone submission / deliverables:** presented the full Phase-7 package (branch, diff +468/4 files, architecture summary, risk assessment, test evidence) to the user for the pre-broadcast gate.
- **Approval request → granted:** user approved broadcasting the deploy (0.5 STX).
- **Deploy executed:** confirmed on mainnet (tx `7e5b3ec5…`).
- **Whitelist request (pending):** drafted a DM for Matt asking him to `add-approved-receiver` the contract id. **User still needs to send / confirm this.**
- **Current waiting state:** awaiting Matt's whitelist tx before seed + flash-loan.
- **Push:** branch pushed to origin (`581fade`).

---

## 12. Current Blockers

**None — Milestone 1 is complete.** The former primary blocker (whitelist approval from Matt) was resolved: Matt called `add-approved-receiver` from the admin wallet `SP20XD46…` (tx `7ae15a50…370b`, block 8197338), confirmed by read-only `is-approved-receiver(receiver) → true`, after which the receiver was seeded and the flash loan executed `(ok true)`. See [[Milestone-1-Execution-Evidence]] and §21.

---

## 13. Immediate Next Actions

Once whitelist approval is received:

1. **Verify approval (read-only):**
   ```bash
   curl -s -X POST https://api.hiro.so/v2/contracts/call-read/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5/flashstack-stx-core/is-approved-receiver \
     -H "Content-Type: application/json" \
     -d '{"sender":"SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW","arguments":["<hex(contract-principal receiver)>"]}'
   # expect (ok true) / 0x0703
   ```
2. **Seed the receiver (≥1 STX):** send `1_000_000` µSTX from `SP3NZYZA88…` to `SP3NZYZA88….hk-stx-bitflow-receiver-v1` (Leather/Xverse send, or a small script).
3. **Execute the flash loan:**
   ```bash
   cd /home/unixx/Desktop/Workspace/Matt/folk/Flashstack
   AMOUNT_USTX=1000000 node scripts/execute-bitflow-flash-loan.mjs   # add DRY_RUN=1 first to preview
   ```
4. **Collect transaction IDs** (deploy ✅, whitelist, seed, flash-loan).
5. **Collect event logs** — the `bitflow-roundtrip` print `{amount, fee, ststx-mid, stx-after}` from the flash-loan tx.
6. **Verify reserve repayment** — core `get-stats` `total-loans`+1, `reserve` grew by ≥ fee.
7. **Produce on-chain proof package** — fill the "after successful execution" block in [[Phase7-Deliverables]].
8. **Close Milestone 1** — `bd close Flashstack-n9p.6`, `bd close Flashstack-n9p.5`, `bd close Flashstack-n9p`.

---

## 14. Future Work

**Priority 1 — Documentation feedback report (Matt request #3).** Lowest effort, immediately useful, and material is already accumulating (the Clarinet.toml gap, the external-principal rule, the `mbegu2` vs `mbegu` filename gotcha, the seed-before-loan requirement). Deliver as a structured report.

**Priority 2 — sBTC architecture research (precursor to #2).** Read `flashstack-sbtc-core` / `flashstack-sbtc-pool` / `sbtc-flash-receiver-trait`, map the canonical-sBTC flash-loan path and the sBTC token model.

**Priority 3 — `hk-sbtc-real-receiver-v1` implementation (Matt request #2).** Mirror the STX receiver pattern for sBTC (likely a Velar or Bitflow sBTC pair). Depends on P2.

**Recommended order:** P1 first (cheap, closes a Matt request, no on-chain risk), then P2→P3 as a unit. Rationale: finish the doc-feedback loop while the integration is fresh, then take on the sBTC track as its own milestone.

---

## 15. Repository State

- **Active branch:** `feature/hk-stx-bitflow-receiver-v1` (tracks `origin/feature/hk-stx-bitflow-receiver-v1`, **0 ahead / 0 behind** — fully pushed).
- **Latest commit:** `581fade` Add hk-stx-bitflow-receiver-v1: external receiver vs Bitflow DEX.
- **Pending commits / pushes:** none (in sync with origin).
- **Uncommitted changes (pre-existing, NOT ours, intentionally left):** `.beads/config.yaml` (M — backup git-push disabled), `ONBOARDING.md` (?? — untracked).
- **Ignored (never commit):** `mbegu`, `mbegu2` (mainnet seed phrases).
- **Important files:** `contracts/hk-stx-bitflow-receiver-v1.clar`, `scripts/deploy-hk-bitflow-receiver.mjs`, `scripts/execute-bitflow-flash-loan.mjs`, `contracts/flashstack-stx-core.clar`, `ONBOARDING.md`, `AGENTS.md`, `.beads/`.

```
branch feature/hk-stx-bitflow-receiver-v1 → origin (0/0)
 M .beads/config.yaml      (pre-existing, not ours)
 ?? ONBOARDING.md          (pre-existing, untracked)
 mbegu / mbegu2            (gitignored secrets)
```

---

## 16. Beads Memory Export

Tracker: epic **`Flashstack-n9p`** (Milestone 1) — phases 1–6 closed; `Flashstack-n9p.5` (deliverables) and `Flashstack-n9p.6` (whitelist+seed+execute) open. Prior epic `Flashstack-64o` (v2 receiver) is 8/9.

Stored memories (via `bd remember`, surfaced at `bd prime`):
- **`bitflow-stx-ststx-live-mainnet-interface-verified-2026`** — Bitflow pool + swap-x-for-y/swap-y-for-x signatures, token/LP principals.
- **`flashstack-external-deploy-rule-a-receiver-deployed-under`** — absolute-principal rule; core sends STX then calls `execute-stx-flash`; whitelist + seed required; `mbegu`/`mbegu2` are secrets.
- **`clarinet-toml-gotcha-it-only-registers-the-old`** — Clarinet.toml only has the old sBTC suite; STX suite is script-deployed; use a scratch project / local stubs to type-check.
- **`hk-stx-bitflow-receiver-v1-validation-2026-06`** — clarinet 0/0, wallet/nonce, core health, round-trip quote, the read-only bug fix.
- **`hk-stx-bitflow-receiver-v1-deployed-2026-06`** — deploy txid, block, live read-only check, next steps.
- **`flashstack-session-resume-state`** (this handoff) — current milestone, deployment, blocker, next actions, roadmap.

---

## 17. Obsidian Vault Index

Vault root: `/home/unixx/Desktop/Workspace/Matt/folk/Flashstack-Vault/`

| Note | Purpose | Contents | Relevance |
|---|---|---|---|
| [[00-Index]] | Map of the vault | Address map, note links, status log | Entry point (now points here) |
| [[FlashStack-Architecture]] | Protocol overview | Contracts, trait, constraints, error codes | High |
| [[Flash-Loan-Lifecycle]] | Loan mechanics | Step-by-step, fee handling, repayment | High |
| [[Receiver-Comparison]] | Receiver survey | test vs v2 vs bitflow-v4, what v1 takes from each | High |
| [[Bitflow-Roundtrip-Analysis]] | DEX strategy | Asset flow, params, slippage, **sequence diagram** | High |
| [[hk-stx-bitflow-receiver-v1-Design]] | The new receiver | Decisions D1–D8, contract shape, validation plan | High |
| [[ADR]] | Decision records | ADR-001…004 | Medium |
| [[Phase6-Validation]] | Validation evidence | clarinet, dry-run, preflight, quote, bug | High |
| [[Phase7-Deliverables]] | Deliverables + on-chain proof | Branch/diff/risk/evidence; deploy txid filled | High |
| [[Blockers]] | Open items | Whitelist blocker, resolved items, risks | High |
| [[FLASHSTACK_PROJECT_HANDOFF_2026-06-06]] | **This handoff** | Full project state | **Primary entry point** |

Relationships: handoff ↔ architecture ↔ design ↔ bitflow-analysis ↔ deployment(Phase7) ↔ roadmap(§14). All notes backlink to [[00-Index]].

---

## 18. Session Learnings

1. **Clarinet ≠ deploy path here.** The STX/Bitflow suite is deployed by scripts that don't type-check Clarity; `clarinet check` only covers the old sBTC set. Always validate new STX receivers in a scratch/stub Clarinet project — don't assume the repo project covers them.
2. **Read-only cross-contract calls need a *literal* target.** A `define-constant` principal works in public functions but is rejected in `define-read-only` (Clarity can't prove read-only-ness). Real bug, caught pre-broadcast.
3. **External deploy ⇒ absolute principals.** The `.contract` sugar resolves to the *deployer's* address; an external receiver must hard-code `SP20XD46….flashstack-stx-core`.
4. **Seed-before-loan is non-obvious but mandatory.** The receiver pays the fee from its own balance inside the callback, so it must hold STX before the first loan.
5. **stSTX trades off-peg (~1.135×).** A percentage slippage floor on the STX amount makes legs revert; `min-out=u1` + repay-assert is the pragmatic pattern for execution.
6. **Secret hygiene gap.** A live mainnet seed phrase sat un-ignored at repo root. Future sessions: verify `git check-ignore mbegu` before any `git add`.
7. **Git auth:** HTTPS origin can't auth in this env; SSH works (`unixwhisperer`). origin was switched to SSH.

---

## 22. POST-M1 CONTINUATION — Matt requests #3 + #2 research/design (2026-06-06)

After M1 closed, executed Matt's remaining requests in the recommended order (one milestone at a time). Beads epic `Flashstack-0w4` (children `.1`/`.2`/`.3` all closed, 3/3).

- **Phase A — Documentation review (#3): DONE.** [[docs-feedback-report]] (repo `docs-feedback-report.md` + vault `Reviews/`). External-dev review, every claim source-verified. 9 confirmed factual errors (E1–E9), incl. max-single-loan documented as 5,000 STX but live = **500,000 STX** (100× off); `README.md:174` STX `impl-trait` points at the wrong contract (won't deploy); ONBOARDING error codes `u3/u4/u6` should be `u306/u304/u303`; `TESTING_GUIDE_STX` calls the **live** sBTC core "legacy/do-not-test". Plus missing-info (seed-before-loan absent from primary docs, external-principal rule, sBTC reserve size) and the STX-vs-sBTC "same interface" myth.
- **Phase B — sBTC architecture research (#2 precursor): DONE.** [[sBTC-Architecture-Review]] (repo `sbtc-architecture-review.md` + `docs/` + vault `Architecture/`). `flashstack-sbtc-core` is **live** (reserve ~15,010 sats, 2 loans, fee 5 bps, max 0.1 BTC). Structurally == STX but SIP-010 sBTC token; differs in get-stats shape, `is-approved` return, withdraw-reserve args, admin model, error base. Found a latent core bug (`set-fee-basis-points` wrong error + no lower bound; the pool gets it right).
- **Phase C — `hk-sbtc-real-receiver-v1` DESIGN (no implementation): DONE.** [[hk-sbtc-real-receiver-v1-Design]] (vault `Design/` + repo project-docs). Design = M1 skeleton ⊕ Velar sBTC→wSTX→sBTC legs ⊕ a **new caller gate** (the `velar-sbtc-arb-receiver` reference lacks one). ADR-S1…S7 (in [[ADR]]). **Key dependency:** needs a **real sBTC seed** + possibly a reserve top-up from Matt; loan capped at ~15k sats by current reserve.

**Hard gate honored:** P3 implementation NOT started. Before implementing: approve the design, confirm target loan size / reserve top-up with Matt, acquire the sBTC seed.

---

## 21. MILESTONE 1 — COMPLETE (2026-06-06)

**Milestone 1 is formally complete.** All success criteria met and proven on mainnet. Authoritative evidence: [[Milestone-1-Execution-Evidence]].

- Whitelist: `7ae15a501a011710eeff0a4a330bab57e77d931296a4cf7a3659811ce108370b` (block 8197338) — `is-approved-receiver → true`.
- Seed (1 STX): `732374dfb1f6123d41d8d872bcbc27e09a47ceb26da0dd95b3a43b1cdf732b4c` (block 8197525).
- **Flash loan: `865df57633fd111c76df3db5caa73577093e91e967af901a89db8de9cf639737` — `(ok true)`, block 8197535.** Bitflow STX→stSTX→STX round-trip cleared; `bitflow-roundtrip` event emitted; core reserve +500 µSTX; total-loans 8→9.
- Seed recovered (`rescue-stx`): `f605a7bf6c51b760e65cf87ea383c29a39f2726bd9f29f71e0be25b9d2de743d` (block 8197553).
- Wallet spend: 0.3215 STX total; seed fully recovered; wallet now ~36.74 STX.

**Next session — start the deferred Matt requests (M1 is closed, so these may now begin):**
1. **P1 — Documentation feedback report (Matt request #3).** Lowest effort; material already accumulated (see §14, §18). No on-chain risk.
2. **P2 → P3 — sBTC track (Matt request #2).** Research `flashstack-sbtc-core` path, then build `hk-sbtc-real-receiver-v1`. Treat as its own milestone.
- Housekeeping carried forward: relocate `./mbegu` out of the repo root (or env-only); consider opening a PR for `feature/hk-stx-bitflow-receiver-v1`.

---

## 19. START HERE NEXT SESSION

**Current state.** Milestone 1 is **COMPLETE** (see §21). `hk-stx-bitflow-receiver-v1` deployed, whitelisted, seeded, and the flash loan executed `(ok true)` on mainnet (`865df576…639737`, block 8197535). Branch pushed.

**Highest-priority task.** Begin the deferred Matt requests — start with the documentation-feedback report (#3, cheapest), then the sBTC track (#2) as a new milestone. Do NOT re-run M1.

**Current blocker.** None.

**Required verification steps (do first).**
1. `is-approved-receiver(receiver)` → must be `(ok true)`.
2. Confirm our wallet `SP3NZYZA88…` still funded (~37 STX) and the receiver's seed balance.

**Files to review first.** This handoff → [[hk-stx-bitflow-receiver-v1-Design]] → `contracts/hk-stx-bitflow-receiver-v1.clar` → `scripts/execute-bitflow-flash-loan.mjs` → [[Phase6-Validation]].

**Commands to run first.**
```bash
cd /home/unixx/Desktop/Workspace/Matt/folk/Flashstack
bd prime                                   # load beads memories
git status && git log --oneline -3
# whitelist check (see §13 step 1)
DRY_RUN=1 AMOUNT_USTX=1000000 node scripts/execute-bitflow-flash-loan.mjs
```

**Questions awaiting answers.**
- Has Matt whitelisted the receiver yet? (If not, hold.)
- Should `./mbegu` be relocated out of the repo? (Recommended yes.)
- Open a PR for the branch? (Not yet done.)

**Definition of success for next session.** Whitelist verified → receiver seeded → `flash-loan(u1000000)` confirmed `(ok true)` → txids + `bitflow-roundtrip` event + reserve delta captured into [[Phase7-Deliverables]] → Milestone 1 closed in Beads → handoff updated.

---

## 20. RECOVERY PROMPT FOR NEXT CLAUDE SESSION

> Paste the block below into a brand-new session.

```
You are continuing an external-integrator engagement with the FlashStack flash-loan
protocol on Stacks mainnet. Resume with zero context loss.

PROJECT: External integration of FlashStack (atomic flash loans on Stacks, Clarity 3).
We are an external developer validating the protocol for the owner, "Matt".

CURRENT MILESTONE: Milestone 1 — external strategy receiver against a real DEX (Bitflow).
~90% complete. Do NOT start sBTC work or docs feedback until M1 is closed.

WHAT EXISTS:
- Receiver DEPLOYED to mainnet:
    SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW.hk-stx-bitflow-receiver-v1
  Deploy TXID: 7e5b3ec55357d119470aa79fe7d5e32c07922b7b7f2c975281cb8456f7dea567
  Status: success / (ok true) / block 8197121.
- It borrows STX from SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core,
  does a real STX->stSTX->STX round-trip on Bitflow (SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2),
  and repays principal+fee atomically. Objective is execution, not profit.
- Branch feature/hk-stx-bitflow-receiver-v1 is pushed to origin (commit 581fade).

CURRENT BLOCKER: Matt must whitelist the receiver via add-approved-receiver on
flashstack-stx-core (admin-only). Until is-approved-receiver returns (ok true),
the flash loan will fail with ERR-NOT-APPROVED (u306).

OUR WALLET: SP3NZYZA88ENNF0FCR57KBGPFY5RAXWHXXVSB6FBW (~37 STX). Mnemonic in
./mbegu (gitignored mainnet secret — never commit; scripts also read MAINNET_MNEMONIC).

OBSIDIAN VAULT: /home/unixx/Desktop/Workspace/Matt/folk/Flashstack-Vault/
  Read FLASHSTACK_PROJECT_HANDOFF_2026-06-06.md first, then 00-Index.md.
REPO: /home/unixx/Desktop/Workspace/Matt/folk/Flashstack
  Also project-docs/session-handoffs/FLASHSTACK_PROJECT_HANDOFF_2026-06-06.md
BEADS: run `bd prime`. Epic Flashstack-n9p (Milestone 1); open tasks .5 and .6.
  Memory key: flashstack-session-resume-state.

NEXT ACTIONS (once Matt whitelists):
  1. Verify: is-approved-receiver(receiver) == (ok true).
  2. Seed >=1 STX to the receiver.
  3. Run: AMOUNT_USTX=1000000 node scripts/execute-bitflow-flash-loan.mjs (DRY_RUN=1 first).
  4. Capture txids + the bitflow-roundtrip event + reserve delta.
  5. Fill the "after successful execution" block in Phase7-Deliverables, close Milestone 1 in Beads.

SUCCESS CRITERIA: receiver whitelisted, flash loan executed (ok true), on-chain proof
collected, Milestone 1 documented and closed.

FIRST STEP: ask the user whether Matt has whitelisted the receiver yet. If not, hold
and offer to poll is-approved-receiver. If yes, proceed with NEXT ACTIONS.
```
