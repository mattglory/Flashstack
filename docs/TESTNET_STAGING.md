# Testnet Staging Procedure

**Owner:** Security & Contract Lead
**Status:** Procedure defined; **not yet executed for any contract.**
**Evidence date:** 2026-09-17 (repo facts re-read, and testnet chain state
verified read-only via the public Hiro API, on this date)
**Bead:** `Flashstack-ajv.6.1`

---

## 1. Why this exists

FlashStack has never staged a deployment on testnet. The live contracts went
**simnet → mainnet**, with the Clarinet simnet suite as the only pre-deployment
gate.

The simnet suite is good and catches logic bugs, but it cannot catch what actually
goes wrong at publish time: real trait resolution across principals, a real token
contract rather than a local mock, post-conditions, fee and nonce handling, epoch
and clarity-version acceptance, and address-substitution mistakes.

The mainnet history is a record of exactly that class of failure. From
`docs/security/CONTRACT_INVENTORY.md` §3 — `flashstack-stx-core` aborted 3 times,
`flashstack-sbtc-core` twice, `usda-vault-rescue-receiver` five times, plus assorted
`dbg*` and `stx-core-test*` probes. Aborted publishes never take effect, but they
**consume the contract name permanently at that principal**, which is why the live
system carries `-v2`/`-v3`/`-v4`/`-v5` suffixes. That is the cost of debugging on
mainnet.

**Scope: forward-looking only.** The live contracts are immutable and nothing here
changes them. This applies to the undeployed successors — `flashstack-stx-core-v2`,
`flashstack-sbtc-core-v2`, `flashstack-stx-pool-v3`, `flashstack-sbtc-pool-v3` — and
to `flashstack-pool-v3`, the audit target.

---

## 2. The gate

No contract reaches mainnet except through every step, in order:

| # | Step | Gate | Who |
|---|---|---|---|
| 1 | `clarinet check` clean | 0 errors | CI |
| 2 | Full suite green | all tests pass | CI |
| 3 | Security & Contract Lead review | CODEOWNERS approval | Lead |
| 4 | **Testnet deploy from a plan checked into `deployments/`** | all publishes confirmed, no aborts | Operator |
| 5 | **Testnet verification** — exercise the real paths | every assertion in §5 passes | Operator |
| 6 | Post-testnet security review of the recorded evidence | Lead sign-off | Lead |
| 7 | Mainnet deploy from a reviewed plan | txids recorded | Operator |
| 8 | Repo's localized copy updated in the **same** change | `canonical-copy-drift` + `mainnet-fidelity` green | Lead |

Step 8 is not bureaucracy. Skipping it is precisely what produced finding **F-7**:
`contracts/test/flashstack-stx-core.clar` drifted from the deployed contract and the
"deployed core" suite spent weeks asserting the behavior of a contract that does not
exist on mainnet.

---

## 3. Operator setup (one-time)

The operator holds the testnet key. **The Security & Contract Lead does not need it,
must not be given it, and must never be sent a mnemonic, seed phrase or private
key.** Testnet STX is valueless faucet currency, but the habit matters: the same
procedure with `TESTNET_` swapped for `MAINNET_` moves real funds.

1. **Create a fresh wallet.** Use a wallet that can produce a 24-word Stacks
   mnemonic — the Leather browser extension, or Xverse. Create a **new** wallet used
   only for testnet staging. Never reuse a wallet that has ever held mainnet funds.
2. **Switch the wallet to testnet.** Leather: Settings → Change network → Testnet.
   The address changes prefix from `SP…` to `ST…`.
3. **Fund it.** <https://explorer.hiro.so/sandbox/faucet?chain=testnet> — 1000 STX
   per request. Run it **3–4 times**: publishing this many contracts plus funding a
   reserve costs more than a single grant covers.
4. **Confirm the balance** before deploying:
   ```bash
   curl -s https://api.testnet.hiro.so/extended/v1/address/<ST-ADDRESS>/balances \
     | python3 -m json.tool
   ```
5. **Never commit the mnemonic.** Pass it per-invocation, from the shell, and let it
   leave no trace in history:
   ```bash
   read -rs TESTNET_MNEMONIC && export TESTNET_MNEMONIC   # leading space, not echoed
   ```
   `settings/Testnet.toml` is gitignored; `settings/Testnet.toml.example` is the
   committed template. Keep it that way.

---

## 4. What exists today, and what does not

### Exists

`scripts/deploy-testnet.mjs` (393 lines) is real and works. It derives the key from
`TESTNET_MNEMONIC`, rewrites mainnet principals to the testnet deployer, publishes in
dependency order waiting for each confirmation, then whitelists a receiver, funds the
reserve, seeds the receiver and executes a live flash loan — producing testnet txids
as evidence. It is a sound template.

### Does not exist

**It targets the previous generation.** Its deploy list is
`stx-flash-receiver-trait`, `flashstack-stx-core`, `flashstack-stx-pool`,
`flashstack-pool-oracle`, `stx-test-receiver` — none of the contracts this gate is
meant to protect.

Nothing in `scripts/` or `deployments/` targets `flashstack-pool-v3` or any v3/v2
successor. Both committed testnet plans are gen-1: `deployments/testnet-plan.yaml`
names `ST2X1GBHA2WJXREWP231EEQXZ1GDYZEEXYRAD1PA8`, which has **zero transactions** on
testnet, and `deployments/default.testnet-plan.yaml` names the well-known Clarinet
default deployer, whose two testnet contracts belong to unrelated third parties. Both
reference `snp-flashstack-receiver`, whose source is not in this repo (**D7**).

---

## 5. Three things that must be solved before the current generation can be staged

These are **open technical questions**, recorded rather than guessed. Each is a real
blocker found by reading the contracts, not a hypothetical.

### 5.1 The address patcher is incomplete

`deploy-testnet.mjs` rewrites exactly two principals:

```js
const MAINNET_ADDRS = [
  "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ",
  "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5",
];
```

The current generation references **three more** that it would silently leave
unpatched — so the publish would abort on testnet with an unresolved contract:

| Principal | Referenced by | Nature |
|---|---|---|
| `SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard` | `flashstack-pool-v3`, `flashstack-v3-receiver-trait` | The SIP-010 standard trait. Exists on testnet at a **different** principal — must be remapped, not rewritten to the deployer. |
| `SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG.flashstack-v3-receiver-trait` | `flashstack-pool-v3` | Our own trait. Rewrites to the deployer correctly, but only if the address is added to the list. |
| `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | `flashstack-sbtc-core-v2`, `flashstack-sbtc-pool-v3` | Canonical sBTC — see 5.2. |

**Decision needed:** the patcher must distinguish *rewrite-to-deployer* (our own
contracts) from *remap-to-testnet-equivalent* (a third-party dependency).

**Narrowed 2026-09-17.** Testnet has been regenesised — burn height is only 17,656 —
so **no third-party mainnet infrastructure can be assumed present**. Probing the
usual addresses for a canonical `sip-010-trait-ft-standard` on testnet returned 404 /
invalid-address. That is not a problem: the repo already carries its own copy at
`contracts/test/sip-010-trait-ft-standard.clar`, so the trait should simply be
**published by us as the first contract in the plan** and rewritten to the deployer
like everything else we own.

Net effect: §5.1 collapses to adding `SP3FBR2AGK5H9…` and `SPR9PQAN…` to the patch
list and publishing our trait copy first. The only dependency with **no** testnet
substitute is canonical sBTC — which is §5.2, and is a genuinely different problem.

### 5.2 The sBTC contracts cannot be staged faithfully

Canonical sBTC (`SM3VDXK3…sbtc-token`) is mainnet-only. Staging
`flashstack-sbtc-core-v2` or `flashstack-sbtc-pool-v3` on testnet therefore requires
pointing them at a mock SIP-010 — which means **the bytes staged on testnet are not
the bytes going to mainnet**, and the test loses most of its value for exactly the
integration risk it was meant to cover.

`scripts/deploy-testnet.mjs` already acknowledges this and deploys the STX system
only.

**Decision needed:** either accept a mock-backed testnet run for the sBTC line as
partial evidence (explicitly labelled as such), or confirm whether a canonical sBTC
testnet deployment exists to point at. Do not let a mock-backed run be recorded as if
it were a faithful stage.

### 5.3 ~~`flashstack-pool-v3` needs epoch 4.0 on testnet~~ — RESOLVED 2026-09-17

**Testnet accepts Clarity 6. `flashstack-pool-v3` can be staged.** Verified by
public read-only API, no deployment:

- **Testnet is past Epoch 4.0.** `GET /v2/pox` lists `Epoch40` at `start_height
  2702`; current burn height is **17,656**. Node reports `stacks-node 4.0.1`.
- **Clarity 6 publishes actually succeed.** Across 400 recent testnet
  contract-deploy transactions: **64 at `clarity_version = 6`, all `success`, and
  zero `abort_by_response` at that version.** (Every other version has failures —
  cv3 70, cv4 41 — so this is not a quiet-period artifact.) Example:
  `ST1M193TGQK6DZ958F9YT51AD756E6GN26PHS798Q.counter`, block 395,236.
- **The specific primitives pool-v3 depends on are live**, not merely the version
  number: `as-contract?`, `current-contract` **and** `with-ft` all appear in
  successfully-deployed testnet contracts (e.g.
  `ST23DXFQJVPA735K0HWRYFS6EF8BHJ2ENSZ3NNNMC.stackspot-sponsor`). This is the part
  that mattered — §11 records that `as-contract` is a hard error from Clarity 4, so
  version acceptance alone would not have proven the replacement forms work.

No action needed. This blocker is closed.

---

## 6. Verification checklist (step 5 of the gate)

A testnet deploy that only proves "the publish confirmed" has not tested anything the
simnet suite did not already cover. Record a txid for each:

**Per contract published**
- [ ] Publish transaction is `success`, not `abort_by_response`
- [ ] Source fetched back from `/v2/contracts/source/<addr>/<name>` matches the
      submitted source modulo address localization — the same rule
      `tests/canonical-copy-drift.test.ts` enforces in-repo
- [ ] `/v2/contracts/interface/…` exposes the expected public functions, and **does
      not** expose any it shouldn't (this is what would have caught F-7)

**Per pool / core**
- [ ] `deposit` succeeds and credits the expected shares
- [ ] `withdraw` returns the expected amount and **still works while paused** (LP exit
      is never gated)
- [ ] `deposit` is **rejected** while paused (pv3-F3)
- [ ] Flash loan happy path: reserve grows by exactly the fee
- [ ] Flash loan with a non-repaying receiver: whole transaction reverts, reserve
      untouched — the solvency invariant, against a real token, on a real chain
- [ ] Unapproved receiver is rejected
- [ ] Two-step admin: `transfer-admin` does **not** change admin; `accept-admin` from
      a non-pending principal fails; the original admin retains control throughout
      (BC1)

**`flashstack-pool-v3` only**
- [ ] `add-asset` derives `share-scale` from a live `get-decimals()` (pv3-F2) — assert
      the actual value, not just success
- [ ] Same-asset reentrancy during a flash-loan callback reverts with `ERR-REENTRANT`
      u815 (pv3-F1)
- [ ] A **different**-asset flash loan inside a callback still succeeds — the lock is
      per-asset by design and must not have become global
- [ ] Oracle reads for a never-listed token return `ERR-NOT-LISTED`, not a
      plausible-looking default

**Recorded output**
- [ ] Every txid written into `deployments/` alongside the plan that produced it
- [ ] Contract addresses, block heights, and the commit SHA staged

---

## 7. What is deliberately not in this document

Fees, nonce handling and batch ordering are **not** specified here. They should be
derived from `scripts/deploy-testnet.mjs`, which already handles them correctly
against a real chain, rather than invented in prose. Writing plausible-looking
operational numbers that have never been executed would be worse than leaving the gap
visible.

Likewise, no deployment plan file for the current generation is committed by this
document. Writing one requires resolving §5.1–5.3 first.

---

## 8. Next actions

| # | Action | Blocked on |
|---|---|---|
| 1 | ~~Confirm testnet epoch/clarity-version support for pool-v3 (§5.3)~~ | **DONE 2026-09-17 — testnet accepts Clarity 6** |
| 2 | Decide the sBTC mock question (§5.2) | Project owner — **the only remaining blocker of substance** |
| 3 | Extend the patcher: add the two missing own-principals, publish our SIP-010 trait copy first (§5.1) | Nothing — decision 2 only affects the sBTC line |
| 4 | Write `deployments/testnet-current-gen-plan.yaml` for the STX + pool-v3 line | 3 |
| 5 | Execute the stage and record evidence | A funded testnet deployer — **operator only** |

**The STX line and `flashstack-pool-v3` are now unblocked end-to-end.** Only the sBTC
line (`flashstack-sbtc-core-v2`, `flashstack-sbtc-pool-v3`) waits on decision 2.
