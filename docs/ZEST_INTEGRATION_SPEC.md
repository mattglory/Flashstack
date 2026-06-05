# Zest Authorised-Integrator Pattern — Spec v0.1

**Author:** Matt Glory (Flashstack)
**Status:** Draft for discussion with Zest team
**Scope:** Enabling Flashstack flash-loan receivers to interact with Zest v0-4-market on behalf of users, with the user's per-tx consent.

---

## 1. Problem

Zest v0-4-market gates user-state functions with `contract-caller == tx-sender`:

- `liquidation-call`
- `supply-collateral-add`
- `collateral-add`
- `repay`
- (and likely `borrow` for the leverage-loop case)

This is the correct conservative default. It also means a third-party contract — including a flash-loan receiver — cannot deposit collateral, borrow, repay, or liquidate on behalf of a user, **even when the user originated the tx and explicitly consented.**

Two concrete use cases sit behind this wall:

### Use case A — Flash liquidations
Atomic seize undercollateralised collateral, swap it on a DEX, repay the flash loan, keep the bonus — in a single tx. Today, anyone wanting to liquidate must pre-fund the debt asset.

Flashstack already has:
- A liquidation receiver: `contracts/liquidation-receiver.clar`
- A live position scanner: `scripts/scan-zest-positions.mjs` (output attached separately)
- Detected at-risk positions on Zest v0-4-market with non-trivial estimated profit.

### Use case B — One-tx leveraged stacking loop
Open a leveraged stSTX position in one tx:

```
flash STX
  → StackingDAO mint stSTX
  → Zest supply-collateral-add (stSTX)
  → Zest borrow STX
  → repay flash loan + fee
```

Because stSTX:STX is high-correlation, this loop has low liquidation risk and durable demand. Surfaced as the highest-signal wedge by Niel Deckx (Arkadiko).

Flashstack already has the receiver skeleton: `contracts/leverage-loop-receiver.clar`. The mock-* functions in there get replaced with real Zest calls if the `*-on-behalf` variants exist.

---

## 2. Proposal

Add an authorised-integrator allowlist on Zest, governed by Zest DAO / multisig. Whitelisted contracts may call gated functions on behalf of a user **only if** the user has explicitly opted in for the current tx.

This mirrors Aave V3's `flashLoan` + `onBehalfOf` + per-user delegation pattern, gated by an integrator allowlist instead of open-ended delegation. The combination of allowlist + per-tx approval gives Zest stricter control than Aave's pattern provides — no standing delegations, no infinite approvals.

---

## 3. Proposed surface area

### 3.1 Allowlist storage
```clarity
(define-map authorised-integrators principal bool)

(define-public (set-integrator (integrator principal) (enabled bool))
  (begin
    (asserts! (is-eq contract-caller .governance) ERR-NOT-GOVERNANCE)
    (ok (map-set authorised-integrators integrator enabled))))
```

### 3.2 Per-tx approval (one-shot, consumed in-tx)
```clarity
(define-map per-tx-approval { user: principal, integrator: principal } uint)
;; value is the burn-block-height of the approval; valid only for current block.

(define-public (approve-integrator-once (integrator principal))
  (begin
    (asserts! (default-to false (map-get? authorised-integrators integrator))
              ERR-NOT-AUTHORISED)
    (ok (map-set per-tx-approval
                 { user: tx-sender, integrator: integrator }
                 burn-block-height))))
```

### 3.3 `*-on-behalf` variants of gated functions
Additive — existing functions unchanged.

```clarity
(define-public (supply-collateral-add-on-behalf
    (user principal) (ft <ft-trait>) (amount uint) ...)
  (begin
    (asserts! (default-to false (map-get? authorised-integrators contract-caller))
              ERR-INTEGRATOR-NOT-AUTHORISED)
    (asserts! (is-eq tx-sender user) ERR-USER-NOT-INITIATOR)
    (asserts! (valid-tx-approval user contract-caller) ERR-NO-APPROVAL)
    ;; consume approval (one-shot)
    (map-delete per-tx-approval { user: user, integrator: contract-caller })
    ;; ... existing supply-collateral-add logic with `user` instead of tx-sender ...
  ))
```

Same shape for `collateral-add-on-behalf`, `borrow-on-behalf`, `repay-on-behalf`, `liquidation-call-on-behalf`.

`liquidation-call-on-behalf` is slightly different because the on-behalf target is the borrower, not tx-sender — the spec for that one would gate on `contract-caller` being whitelisted only. The user-consent layer doesn't apply (liquidation is permissionless on Aave for that reason).

---

## 4. Security model

| Layer | What it protects against |
|---|---|
| **Governance allowlist** | Random contracts getting access. Bar is high — Zest decides. |
| **`tx-sender == user` assertion** | A whitelisted contract calling on behalf of a user who did not originate this tx. The user always signs the top-level tx in their wallet. |
| **Single-use approval** | Replay across txs. No standing delegations. |
| **Stacks post-conditions** | The user attaches PCs to their top-level tx; any unexpected asset movement aborts. |
| **Liquidation path is allowlist-only** | Flash-liquidation receivers can be hot-swapped or revoked by Zest governance if a bug is found. |

---

## 5. Compatibility / migration

- Existing functions unchanged → zero risk to current users.
- New `*-on-behalf` variants are additive.
- Empty allowlist = exact current behaviour.
- Can be shipped in a v0-4 minor or rolled into v0-5.

---

## 6. Reference integration

Flashstack leverage-loop receiver (`contracts/leverage-loop-receiver.clar`) currently uses mock collateral/borrow functions. With this pattern in place, it becomes:

1. User wallet calls `flashstack-stx-core::flash-loan(amount, .leverage-loop-receiver)`.
2. Receiver receives N STX in callback.
3. Receiver calls `stackingdao::deposit(N)` → receives stSTX.
4. Receiver calls `zest-v0-4-market::supply-collateral-add-on-behalf(user, stSTX, N)`.
   - Allowed because: (a) receiver is whitelisted, (b) user approved in step 0, (c) tx-sender is user.
5. Receiver calls `zest-v0-4-market::borrow-on-behalf(user, wSTX, M)`.
6. Receiver repays flash loan + fee with borrowed STX.
7. User ends tx holding a leveraged stacking position; receiver holds nothing.

Reverts cleanly on any sub-step. Atomic. One signature.

Flash-liquidation receiver (`contracts/liquidation-receiver.clar`) becomes:

1. Liquidator wallet calls `flashstack-stx-core::flash-loan(debt-amount, .liquidation-receiver, {target, ...})`.
2. Receiver receives debt asset in callback.
3. Receiver calls `zest-v0-4-market::liquidation-call-on-behalf(target, ...)` — seizes collateral.
4. Receiver swaps seized collateral on DEX for debt asset.
5. Receiver repays flash loan + fee. Keeps the liquidation bonus.

---

## 7. Open questions for Zest team

1. Governance plumbing: does the DAO / multisig already have a clean path for allowlist mutations, or would this need additional infrastructure first?
2. Approval model preference: single-use per-tx (proposed) vs revocable standing delegation?
3. Are there functions beyond the five named above that should also be gated this way?
4. Audit / review process Zest expects integrators to go through.
5. Naming — `*-on-behalf` follows Aave conventions; happy to match Zest's existing style.
6. Would Zest prefer the allowlist live on a separate contract (e.g. `zest-integrator-registry`) so v0-4 doesn't need a redeploy, or in-line?

---

## 8. What Flashstack commits to

- Reference receivers (leverage loop + liquidation) shipped open-source for Zest team review before any user touches them.
- Submit for whatever audit / review path Zest uses for integrators.
- No public announcement / marketing of the integration without Zest sign-off.
- Coordinated disclosure on any issues found during integration.

---

## 9. What this unlocks for Zest

- Flash liquidations remove the capital barrier to keeping the protocol healthy. More liquidators → tighter liquidation execution → lower bad debt.
- Leveraged stacking attracts STX holders who today don't open Zest positions because the manual loop is too tedious. Adds real TVL.
- Sets the integrator pattern for future Stacks DeFi composability (DEX aggregators, vault strategies, etc.) without Zest having to design that surface area separately each time.

---

*End of spec. Open to revision on any point — this is the starting position, not the position.*
