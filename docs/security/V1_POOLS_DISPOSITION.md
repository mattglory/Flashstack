# v1 pools and v1 oracle: state and disposition

Tracked in `Flashstack-ajv.4.4`. Covers the three deprecated gen-2 v1 contracts, all published by `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5`:

- `flashstack-stx-pool` (STX LP pool)
- `flashstack-sbtc-pool` (sBTC LP pool, built-in `get-share-price`)
- `flashstack-pool-oracle` (read-only feed over `flashstack-stx-pool`)

**Verdict:** no funds at risk today. Both pools are paused, empty and untouched since 2026-07-30. The live risk is the oracle: it still answers, and while the pool is empty anyone can set its price to any value for the cost of gas and take their STX back (F-13). That only hurts a protocol that reads it, and none is known. Recommendation: leave the contracts as they are, deprecate them in every doc and on the site, and decide the admin question below with the Ledger move.

## Verified state (2026-10-22 08:06 UTC, mainnet, Hiro API)

Read-only calls through `POST /v2/contracts/call-read/<principal>/<name>/<fn>`, with arguments serialized by `@stacks/transactions` `cvToHex`, plus `GET /extended/v1/address/<contract>/transactions` and `/stx`. Deployed source fetched with `GET /v2/contracts/source/...` and diffed against the repo: **byte-identical** for both pools.

| | `flashstack-stx-pool` | `flashstack-sbtc-pool` |
|---|---|---|
| `paused` | `true` | `true` |
| `pool-balance` | 0 uSTX | 0 sats (sBTC `get-balance` of the pool also 0) |
| `total-shares` | **0** | **0** |
| STX held | 0 | 0 |
| `get-admin` | `SPR9PQAN…` | `SPR9PQAN…` |
| `max-single-loan` / fee | 5,000 STX / 5 bp | 0.1 BTC / 5 bp |
| `total-loans` / `total-fees` | 0 / 0 | 0 / 0 |
| Transactions ever | 9 | 5 |
| Last transaction | 2026-07-30 02:10 `withdraw` (`0x1d3d3c49ec…`) | 2026-07-30 01:36 `withdraw` (`0xf38c31bd44…`) |
| Pause set | 2026-07-25 22:51 (`0x61c91b0138…`) | 2026-07-25 22:51 (`0x4ea910c531…`) |

**No deposit since the pools were drained.** F-6 (pause doesn't gate `deposit`) has not been used on either pool.

`flashstack-pool-oracle` right now:

| Function | Returns |
|---|---|
| `get-share-price` | `(ok u1000000)`: the empty-pool constant, not a computed price |
| `get-total-shares` / `get-pool-balance` | 0 / 0 |
| `get-collateral-snapshot` | `share-price 1000000`, `is-healthy false`, everything else 0 |

Its only transaction is its own deploy (2026-05-08). **Consumers can't be enumerated from the API.** A lender would call it read-only from inside its own contract, and that doesn't show up in the oracle's history. Hiro has no reverse "who references this contract" index. So "no known consumer" means none found in FlashStack's own repo, site or integration threads, not that none exists.

## Risks

1. **Oracle price set by anyone (F-13).** Pinned in `tests/v1-oracle-manipulation.test.ts`.
   - The empty-pool constant (1e6) is on a different scale from the pool's own math. A first deposit mints `amount * 1e6` shares, so the computed price is 1. **A single 1-uSTX deposit moves the oracle 1,000,000x.**
   - While the pool is empty and paused, a caller can deposit 1 uSTX (1e6 shares) and send X uSTX straight to the pool. The oracle then reads `X + 1`, with `is-healthy true`. Then `withdraw` returns all of it: the caller is the sole LP. Cost: gas.
   - A lender pricing FlashStack v1 LP collateral off this feed could be drained. The v1 LP spec (`docs/LP_COLLATERAL_INTEGRATION_SPEC.md`) told lenders to do exactly that, and called the feed "no manipulation surface".
2. **Deposit trap (F-1 + F-6).** A deposit still goes through on a paused pool, with the pre-F-1 share math. A first depositor can donate to round the next depositor's shares down to 0 and take their deposit. It only hurts someone who deposits into a deprecated pool, which the docs and the site must stop inviting.
3. **sBTC pool's built-in price.** `flashstack-sbtc-pool.get-share-price` has the same shape as risk 1, over sBTC: empty-pool constant 1e8, first deposit mints `amount * 1e8` shares (`flashstack-sbtc-pool.clar:64-75`, `:215-225`). Confirmed by reading the source, not separately tested. Same answer: deprecate, don't consume.
4. **Admin keys still live.** `SPR9PQAN…` can still call `set-paused false`, `add-approved-receiver`, `set-fee-basis-points` and the one-step `transfer-admin` on both pools. Unpausing an empty pool does nothing on its own. The risk is a compromised admin key turning a deprecated pool back on with a receiver of its choosing.

## What the contracts allow

The v1 pools are immutable and Clarity has no self-destruct. The admin surface on both pools is `set-paused`, `set-max-single-loan`, `set-fee-basis-points`, `add-approved-receiver` / `remove-approved-receiver` and `transfer-admin`. **None of them reaches `deposit` or `withdraw`.** `set-max-single-loan` only caps loans, and it rejects 0. There is no knob that blocks deposits. The oracle has no public functions at all, so its `POOL` constant is fixed.

## Options

| | Option | Effect | Cost / downside |
|---|---|---|---|
| A | **Leave paused, deprecate everywhere** (docs, README, site, a pinned public notice) | Removes the invitation that makes risks 1 to 3 real | None on chain. Can't stop someone who reads the chain directly |
| B | A + **retire the admin**: `transfer-admin` on both pools to a principal nobody controls | Makes risk 4 impossible, and takes both pools out of the Ledger move | **Irreversible.** Gives up the option to ever reuse them, which nothing needs |
| C | A + seed a permanent dead deposit (e.g. 1 STX) so the pool is never empty | Blunts risks 1 and 2 (no empty-pool jump, inflation costs real money) | Locks Matt's STX in a deprecated contract, and makes the pool look alive. Not recommended |

**Recommendation: A now.** It's docs only and this change does it. **Decide B together with the Ledger move:** either move these two admin rights to the Ledger with everything else, or retire them instead of moving them.

## Needs Matt's decision

1. **B or not:** retire the v1 pool admin rights (irreversible), or move them to the Ledger with the rest.
2. **Public notice:** OK to post a short deprecation note (X / Discord) naming `flashstack-pool-oracle` and the v1 pools as "do not integrate", without the manipulation details?
3. **Known integrators:** did any lender (Zest, ALEX or anyone sent the v1 LP spec) wire up `flashstack-pool-oracle` or `flashstack-sbtc-pool.get-share-price`? If yes, F-13 goes to High and they need to hear first, privately.

## Changed in this pass

- `docs/INTEGRATION_GUIDE.md`, `docs/API_REFERENCE.md` and `docs/LP_COLLATERAL_INTEGRATION_SPEC.md` now mark the v1 pools and oracle deprecated and link here.
- `FINDINGS_REGISTER.md` gets F-13. F-6, `CONTRACT_INVENTORY.md` §3/§6 and `THREAT_MODEL.md` row 7 point here.
