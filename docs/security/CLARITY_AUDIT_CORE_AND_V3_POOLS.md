# Clarity audit — flashstack-core, flashstack-pool-v3, flashstack-stx-pool-v3, flashstack-sbtc-pool-v3

**Date:** 2026-10-02 · **Method:** manual audit using the `clarity-audit` skill framework
(aibtcdev/skills, static-analysis checklist + risk-color framework) · **Contracts:**
[`contracts/flashstack-core.clar`](../../contracts/flashstack-core.clar) (live, superseded),
[`contracts/flashstack-pool-v3.clar`](../../contracts/flashstack-pool-v3.clar),
[`contracts/flashstack-stx-pool-v3.clar`](../../contracts/flashstack-stx-pool-v3.clar),
[`contracts/flashstack-sbtc-pool-v3.clar`](../../contracts/flashstack-sbtc-pool-v3.clar) —
the latter three **not yet deployed**. Follow-on to
[`CLARITY_AUDIT_V2_POOLS.md`](CLARITY_AUDIT_V2_POOLS.md).

## Summary

**Headline finding, Critical, new:** `flashstack-stx-pool-v3` and `flashstack-sbtc-pool-v3`
— the documented successor contracts to the two F-9-vulnerable live v2 pools
(`docs/security/CONTRACT_INVENTORY.md` names them exactly that) — **do not fix F-9**.
Both already carry the BC1 two-step-admin fix and the F-8 deposit-pause-gate fix, but
neither has a reentrancy lock on `deposit`. Their `deposit()` is structurally identical
to the vulnerable v2 pools': shares are minted from a live balance read with nothing
stopping that read from happening mid-flash-loan-callback. **If F-9's real fix is scoped
against these two files as a starting point without this being flagged, the result ships
the same bug under a new, "fixed-looking" name.**

The good news sits one file over: `flashstack-pool-v3.clar` (the generic multi-asset
pool — a separate contract, not a sibling of the two above) already has the right fix,
built and tested — a per-asset `asset-locked` map, checked first and released last in
`deposit`/`withdraw`/`flash-loan` (its own finding F1, fixed 2026-08-25, `docs/02-technical/MULTI_ASSET_CORE_DESIGN.md` §13). That is the exact mechanism to port into the two
single-asset successors — this audit found no reason it wouldn't transplant directly.

Beyond that: `flashstack-pool-v3` itself is in strong shape — it's already been through
two internal review passes (self-review 2026-08-19, independent review by Hillary Kibet
2026-08-25) and this pass found nothing new in it. `flashstack-core` (the gen-1 flash-
*mint* design, superseded, deployed under the precautionarily-dead gen-1 wallet) has its
own already-fixed hardening history and one unremarkable single-step-admin note.

**Verdict: CONDITIONAL_PASS** (conditional on the F-9-in-successors finding below).
**Risk level: CRITICAL** on the two single-asset v3 pools specifically; `flashstack-pool-v3`
and `flashstack-core` are LOW on their own.

| | flashstack-core | flashstack-pool-v3 | flashstack-stx-pool-v3 | flashstack-sbtc-pool-v3 |
|---|---|---|---|---|
| Status | Live, superseded | Not deployed | Not deployed | Not deployed |
| Public functions | 11 | 10 | 9 | 9 |
| Read-only functions | 9 | 11 | 8 | 10 |
| Maps | 2 | 4 | 2 | 2 |
| Reentrancy lock on deposit | N/A (no deposit fn) | **Yes (F1 fix)** | **No** | **No** |

## Findings

| ID | Severity | Contract(s) | Description | Recommendation |
|----|----------|-------------|--------------|-----------------|
| **V3-A** | **Critical** | `flashstack-stx-pool-v3`, `flashstack-sbtc-pool-v3` | F-9 (deposit-as-repayment reentrancy, already tracked for the live v2 pools) is present, unfixed, in both documented successor contracts. Confirmed by direct read: `deposit()` in both computes `new-shares` from a live balance read with no guard, identical in shape to the vulnerable v2 pools' `deposit()`. Both files' own header comments still claim "Reentrancy-safe: reserve checked after callback returns" — the same overclaim F-9 already disproves on the v2 pools. | Port `flashstack-pool-v3`'s `asset-locked`-style per-asset (here, single-asset — so effectively a single boolean data-var) reentrancy guard into both files: check-and-set as the first operation of `deposit`/`withdraw`/`flash-loan`, release as the last. This is a known-good, already-tested pattern — reuse it rather than re-derive it. **Flag this to whoever scopes F-9's real fix before they start, not after** — these two files are the obvious starting point for "the real fix," and starting from them silently inherits the bug. |
| V3-B | Low | `flashstack-stx-pool-v3`, `flashstack-sbtc-pool-v3` | Same stale "Not yet deployed... deploy this in place of the v1 pool" header issue as V2-A in the companion audit — accurate for these two (they really aren't deployed), but worth confirming intentionally once V3-A is fixed and deployment is actually being planned. | No action now; revisit when these are scheduled for deployment. |
| V3-C | Informational | `flashstack-core` | `set-admin` is single-step and self-gated — the same BC1 class of footgun already fixed in `flashstack-pool-v3`/`-stx-pool-v3`/`-sbtc-pool-v3`/`-sbtc-core-v2`. Not flagged as urgent: this contract is gen-1, deployed under the precautionarily-dead `SP3TGRVG…` wallet, and explicitly marked "Superseded" in `CONTRACT_INVENTORY.md` — operationally, nobody is actively administering it. | No action unless this contract is ever brought back into active use; if it is, port the two-step pattern first. |
| V3-D | Informational | `flashstack-core` | Admin checks use `contract-caller` rather than `tx-sender` (the pools all use `tx-sender`). The file's own header notes this was a deliberate prior fix ("Fixed admin authentication (contract-caller)"), not an oversight — noting the inconsistency across the codebase only so it's not mistaken for drift if anyone ports code between these contracts. | None — just a documented, intentional difference worth knowing about if cross-porting code. |

## What works correctly (not re-litigating what the design doc already covers in detail)

- `flashstack-pool-v3`'s F1 (reentrancy), F2 (per-asset share-scale calibration), and F3
  (deposit pause-gating) fixes, and its asset allow-list as the real solvency boundary for
  a generic multi-asset core — all already documented at length in
  `docs/02-technical/MULTI_ASSET_CORE_DESIGN.md` §11–§13 with their own proofs; re-read
  and reconfirmed here, not re-derived.
- `flashstack-core`'s C-01/C-02/H-01/L-01/L-02/M-02 fix history (its own header comments)
  — spot-checked against the actual code (supply-invariant repayment check, per-block
  volume circuit breaker, minimum-fee floor) and all present as described.
- Both v3 single-asset pools correctly layer BC1 (two-step admin) and F-8 (deposit pause
  gate) on top of the v2 pools' logic — confirmed by direct comparison against
  `flashstack-stx-pool-v2`/`flashstack-sbtc-pool-v2`, byte-for-byte identical outside
  those two additions and the (missing) F-9 fix.

## Notes

- This covers the contracts named in the request (`flashstack-core`, the v3 pools). Not
  covered: the oracle contracts (`flashstack-pool-oracle`, `-v2`), `flashstack-stx-core`/
  `-core-v2`, `flashstack-sbtc-core`/`-core-v2`, or the ~30 per-integration receiver
  contracts — happy to scope any of those next if useful.
- Static analysis only; doesn't replace Clarinet tests or an executable PoC. Given V3-A's
  severity, worth a quick simnet proof (mirroring `tests/f9-independent-verification.test.ts`,
  just pointed at `flashstack-stx-pool-v3` instead) before treating it as fully closed —
  not done here since it would just re-run the same PoC against a byte-identical
  `deposit()`, and the code-level identity is already a direct, non-inferential match.
