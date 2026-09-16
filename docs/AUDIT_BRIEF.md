# Audit Brief — Security & Contract Lead Handoff

Working notes for whoever is the internal technical counterpart to the
professional audit (Coinfabrik / CoinSentinel, per ROADMAP.md). Not a
replacement for the README/ROADMAP — a pointer into them plus the open items
an auditor will ask about first.

## Where the real docs live

- Protocol overview, mainnet contract addresses, security posture: `README.md`
  (see the **Security** section — solvency invariant, 176-test suite, access
  control model).
- Multi-asset core redesign: `docs/02-technical/MULTI_ASSET_CORE_DESIGN.md`
- LP/collateral integration surface for third parties: `docs/LP_COLLATERAL_INTEGRATION_SPEC.md`
- Roadmap / audit timing: `ROADMAP.md` ("In Progress (Q2 2026)")

## Open items before the audit kicks off

1. **Findings register.** README says two internal findings (F-1 LP share
   inflation, F-2 oracle scale consistency) were fixed and are "kept local
   until remediation." That register isn't in this checkout — locate it (or
   the person who has it) and fold it into this repo (e.g.
   `docs/SECURITY_FINDINGS.md`) so the auditor has one place to start instead
   of tribal knowledge.
2. **CI gating.** `npm run check` (clarinet check) was dropped from CI at some
   point after being present earlier — see `.github/workflows/test.yml`
   history. Restored in this branch: `clarinet check` now runs before the test
   suite on every push/PR to `main`.
3. **Second-reviewer requirement.** `CODEOWNERS` now names the Security &
   Contract Lead on `contracts/`, `deployments/`, `Clarinet.toml`, and
   `.github/workflows/`. For this to actually block merges, branch protection
   on `main` needs **"Require review from Code Owners"** enabled in GitHub
   repo settings — that's a settings-UI/admin-token change this checkout
   can't make; confirm it's on before treating it as enforced.
4. **v1 vs v2 pools.** v1 STX/sBTC pools are deprecated in favor of virtual-shares
   v2 pools (ERC-4626-style). *Corrected 2026-09-16:* this item previously said both
   generations were listed as live in the README's mainnet contract table. That is no
   longer true — the README lists only the v2 pools. The v1 pools are still live on
   chain (paused, drained) and are in scope for the auditor as immutable legacy; see
   `docs/security/CONTRACT_INVENTORY.md` §3 and finding **F-6**.

## Contract inventory at a glance

Full addresses and explorer links are in `README.md`; `Clarinet.toml` lists
what's actually registered for `clarinet check` (the 38 contracts checked
above — some deployed-via-script receivers are intentionally excluded, see
`docs/BUILD_A_RECEIVER.md`).
