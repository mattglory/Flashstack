# FlashStack Contract Inventory & Deployment Map

**Owner:** Security & Contract Lead
**Evidence date:** 2026-09-15 (all on-chain facts re-read on this date)
**Repo state:** branch `security-lead/ci-gating-and-onboarding` @ `436ea9c`

Every "deployed" claim below was established by querying the public Hiro API
(`GET /extended/v1/contract/<principal>.<name>` for existence,
`GET /v2/contracts/interface|source/...` for shape, `POST /v2/contracts/call-read/...`
for live state). Nothing here is taken from README prose. Where the repo's
documentation disagrees with the chain, **both are recorded** and the discrepancy
is filed as a bead rather than silently resolved.

No key material was used or requested. All reads are public and unauthenticated.

---

## 1. Deployer / custody principals

| Principal | Role | Status |
|---|---|---|
| `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ` | **Generation-1 deployer.** Published the original `flashstack-core` flash-*mint* system, `sbtc-token`, the `flash-receiver-trait` and `stx-flash-receiver-trait`, and the gen-1 receiver library. | Legacy. Treated as precautionarily dead. Its contracts are immutable and still resolve on chain. |
| `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5` | **Generation-2 deployer.** Published the live reserve-model cores, the v1 LP pools + oracle, and the live receiver library. | Legacy as a *key*; its **contracts are the live system**. Admin rights on them have been rotated away (see §4). |
| `SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG` | **Current secure admin wallet.** Published the hardened v2 pools + oracle-v2, and is the `admin` of record on every live FlashStack contract checked. | Current. |

> **VERIFIED.** `get-admin` on all six live cores/pools returns the same principal,
> `SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG`. Admin authority is therefore **not**
> held by either deployer key. This is consistent with ROADMAP's "deployer key
> rotated (2026-06-12)".

---

## 2. V2 / LIVE — the current production surface

All confirmed live on Stacks mainnet 2026-09-15. Live state read on the same date.

| Contract | Principal | Holds funds | Live state | Admin model | Notes |
|---|---|---|---|---|---|
| `flashstack-stx-core` | `SP20XD46…` | **Yes** — STX reserve **75.190500 STX** | `paused=false`, 17 loans, 190,500 µSTX fees (0x2e824) | one-step `transfer-admin` | The STX flash-loan engine. Reserve model. See §5 discrepancy. |
| `flashstack-sbtc-core` | `SP20XD46…` | **Yes** — sBTC reserve | `paused=false`, 3 loans, 21,000 sats volume | one-step `set-admin` | Canonical-sBTC engine. Different admin fn name from stx-core. |
| `flashstack-stx-pool-v2` | `SPR9PQAN…` | **Yes** — 1.000000 STX | `paused=false`, shares 1e12 (virtual) | one-step `transfer-admin` | Virtual-shares hardened LP pool. |
| `flashstack-sbtc-pool-v2` | `SPR9PQAN…` | **Yes** — 44,990 sats | `paused=false` | one-step `transfer-admin` | Virtual-shares hardened, built-in oracle. |
| `flashstack-pool-oracle-v2` | `SPR9PQAN…` | No | read-only, no public fns | none (immutable `POOL` constant) | Reads `flashstack-stx-pool-v2`. |
| `flashstack-yield-vault-v5` | `SP20XD46…` | Yes (vault) | not yet reviewed | not yet reviewed | Out of scope for this pass — filed for later review. |

**Live receiver library** (`SP20XD46…`), all confirmed on chain, none hold protocol funds — they hold only transient loan proceeds inside a single transaction:
`bitflow-arb-receiver-v4`, `velar-sbtc-arb-receiver`, `zest-liquidation-receiver`,
`alex-arb-receiver-v2` / `-v3` / `-v4` / `-v5`, `stx-test-receiver`, `sbtc-test-receiver`.

**Traits (immutable, load-bearing):**
`SP3TGRVG….stx-flash-receiver-trait` (used by the live STX core and both STX pools) and
`SP20XD46….sbtc-flash-receiver-trait` (used by the sBTC core and pools).
> **INFERENCE (low risk):** the STX trait living on the *generation-1* key is not a
> security exposure — traits are immutable and carry no authority — but it does mean
> the live system permanently references a contract published by a key that is
> otherwise treated as dead. Worth stating to the auditor rather than discovering.

---

## 3. V1 / LEGACY

| Contract | Principal | Live? | State | Disposition |
|---|---|---|---|---|
| `flashstack-stx-pool` | `SP20XD46…` | Yes | **`paused=true`, balance 0, shares 0** | Deprecated. Drained and paused **for loans only** — `deposit` is still reachable (`Flashstack-ajv.4.5`). |
| `flashstack-sbtc-pool` | `SP20XD46…` | Yes | **`paused=true`, balance 0, shares 0** | Deprecated. Drained and paused **for loans only** — `deposit` is still reachable (`Flashstack-ajv.4.5`). |
| `flashstack-pool-oracle` | `SP20XD46…` | Yes | read-only | **Deprecated but still answering.** Reads the paused, empty v1 STX pool. |
| `flashstack-core` | `SP3TGRVG…` | Yes | not reviewed | Gen-1 flash-**mint** design (supply-equality invariant, not reserve-balance). Superseded. |
| `sbtc-token` | `SP3TGRVG…` | Yes | not reviewed | **A FlashStack-published token named `sbtc-token` that is NOT canonical sBTC.** Canonical sBTC is `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`. Naming-confusion risk. |
| `snp-flashstack-receiver`, `snp-flashstack-receiver-v3` | `SP3TGRVG…` | Yes | — | **Source not present in this checkout.** |
| gen-1 receivers (`dex-aggregator-receiver`, `liquidation-receiver`, `collateral-swap-receiver`, `multidex-arbitrage-receiver`, `leverage-loop-receiver`, `yield-optimization-receiver`, `example-arbitrage-receiver`, `test-receiver`) | `SP3TGRVG…` | Yes | — | Legacy; bound to the gen-1 core. |

**Deployment scars** (aborted publishes, useful context for an auditor reading the chain):
`flashstack-stx-core` ×3, `flashstack-sbtc-core` ×2, `usda-vault-rescue-receiver` ×5,
`arkadiko-liquidation-receiver` ×2, `flashstack-yield-vault` v1–v3, `bitflow-arb-receiver-v2`,
`alex-arb-receiver`, plus several `dbg*` / `stx-core-test*` probes. These are
`abort_by_response`, i.e. they never took effect, but they do consume the contract name
forever at that principal — which is why several contracts carry a version suffix.

---

## 4. POOL-V3 / AUDIT TARGET — undeployed

**VERIFIED NOT DEPLOYED** at either `SP20XD46…` or `SPR9PQAN…` (404 on both):

| Contract | Repo path | Purpose |
|---|---|---|
| `flashstack-pool-v3` | `contracts/flashstack-pool-v3.clar` | Generic multi-asset flash-loan + LP pool. The intended audit target. |
| `flashstack-stx-pool-v3` | `contracts/flashstack-stx-pool-v3.clar` | BC1 two-step-admin successor to the STX pool. |
| `flashstack-sbtc-pool-v3` | `contracts/flashstack-sbtc-pool-v3.clar` | BC1 two-step-admin successor to the sBTC pool. |
| `flashstack-sbtc-core-v2` | `contracts/flashstack-sbtc-core-v2.clar` | BC1 two-step-admin successor to the sBTC core. |

**Consequence to state plainly:** the BC1 one-step-admin-transfer fix exists **only in
the repository**. Every contract that is actually live today still has the one-step
behavior. See `docs/security/ADMIN_CUSTODY_MODEL.md`.

---

## 5. Recorded discrepancies (repo docs vs chain vs code)

Each is filed as a bead. None is silently resolved here.

| # | Discrepancy | Evidence | Bead |
|---|---|---|---|
| D1 | `Clarinet.toml` states `contracts/test/flashstack-stx-core.clar` is "byte-identical" to the mainnet contract. It is not: the local copy adds the BC1 two-step admin transfer (`pending-admin` + `accept-admin`), extra error constants, `print` events, and a `calculate-fee` that now rejects `u0`. The mainnet interface has `transfer-admin` and **no** `accept-admin`. | diff of Hiro `/v2/contracts/source` output vs the local file; interface listing | `Flashstack-ajv.4.1` |
| D2 | README badge + Security section claim a **128**-test suite; ROADMAP claims **125**. Actual: **165 passing across 16 files** (`npm test`, 2026-09-15). | test run output | `Flashstack-ajv.7.1` |
| D3 | `docs/AUDIT_BRIEF.md` item 4 says v1 and v2 pools are "both listed as live in the README's mainnet contract table". No longer true — README now lists only v2 and calls v1 deprecated. My own brief is stale. | README §Mainnet contracts | `Flashstack-ajv.7.1` |
| D4 | ROADMAP "Next" items 1 and 2 ask for the v2 pools and `flashstack-pool-oracle-v2` to be *deployed*. Both are already live at `SPR9PQAN…`. | Hiro contract API | `Flashstack-ajv.7.1` |
| D5 | `deployments/default.mainnet-plan.yaml` describes a gen-1 publish from `SP3TGRVG…`, references two `.clar` files that do not exist in the repo, and contains none of the live system. `/deployments/` is CODEOWNERS-protected, so it reads as authoritative. | file contents vs `find contracts` | `Flashstack-ajv.7.2` |
| D6 | `clarinet check` covers 38 contracts; 70 `.clar` files exist. The 32 uncovered include `contracts/flashstack-pool-v3.clar` and the other v3/v2 successors — i.e. the audit/deploy targets are not type-checked by the CI gate. | `clarinet check` output vs `Clarinet.toml` registry | `Flashstack-ajv.2.3` |
| D7 | Source for the live `snp-flashstack-receiver` / `-v3` is absent from the repo. | contract live at `SP3TGRVG…`; no matching file | `Flashstack-ajv.7.2` |

---

## 6. What is NOT yet established

- `flashstack-yield-vault-v5` — live, holds funds, not reviewed.
- The current approved-receiver whitelist on each live core (enumerable only per-principal via `is-approved-receiver`; needs a candidate list).
- Whether `flashstack-pool-oracle` (v1) has external consumers who would be misled by a share price derived from an empty, paused pool.
