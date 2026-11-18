import { describe, it } from "vitest";
import fc from "fast-check";
import { Cl } from "@stacks/transactions";
import {
  Coverage, accounts, amountArb, call, dataVar, deploy, expectRes, feeOf, ftBalance, ftBalanceChecked, inv, json, mapEntry, pctArb, pctOf, ro,
  stateful, whoArb,
} from "./invariants-harness";

/**
 * Stateful invariant suite for flashstack-pool-v3 (Tier 1 audit target), two
 * listed assets with different decimals: sbtc-token (8, share-scale 1e8) and
 * mock-usdcx (6, share-scale 1e6). The unlisted malicious-token is thrown at
 * every entry point too.
 *
 * Per asset, after EVERY step, against an exact model:
 *   I1  total-shares == sum of every holder's shares
 *   I2  solvency: sum_i floor(shares_i*(B+1)/(S+scale)) <= B, B = live balance
 *   I3  share price (B+1)/(S+scale) never decreases
 *   I4  flash-loan ok => B grows by exactly what was paid (>= fee), shares untouched;
 *                  err => nothing changed (both assets)
 *   I5  deposit/withdraw outputs == the floor formulas; a deposit never mints 0
 *   I6  global or per-asset pause, or delisting => deposit and flash-loan refused;
 *       withdraw behaves exactly the same as when active
 *   I7  asset-locked is unset for both assets after every transaction
 *   I8  non-admin calls to every admin function fail with ERR-NOT-ADMIN
 *   I9  fee == max(1, floor(amount*fee-bp/10000)) (calculate-fee and realised)
 *   I10 isolation: an action on asset A leaves asset B's balance, config,
 *       cached reserve, total-shares and every LP's B-shares bit-for-bit equal
 *   I11 the cached reserve equals the live balance after every successful
 *       deposit / withdraw / flash-loan / add-asset on that asset
 *   I12 an unlisted (malicious) token is rejected with ERR-NOT-LISTED everywhere
 *   I13 final drain: every wallet can withdraw all of its shares, per asset
 */

const POOL = "flashstack-pool-v3";
const ASSETS = [
  { name: "sbtc-token", scale: 100_000_000n },
  { name: "mock-usdcx", scale: 1_000_000n },
] as const;
const MAX_LOAN = 10_000_000_000n;
const E = {
  NOT_ADMIN: 800n, ZERO: 802n, PAUSED: 803n, ASSET_PAUSED: 804n, NOT_LISTED: 805n, ALREADY_LISTED: 806n,
  LIMIT: 807n, RESERVE: 809n, REPAY: 810n, XFER: 811n, INVALID_FEE: 812n, INS_SHARES: 813n, REENTRANT: 815n,
};

type Kind = "good" | "under" | "over" | "bad" | "reDeposit";
type Size = { pct: number } | "overReserve" | "overLimit";
type Act =
  | { t: "deposit"; a: number; who: number; amt: bigint }
  | { t: "withdraw"; a: number; who: number; pct: number }
  | { t: "flash"; a: number; kind: Kind; size: Size; who: number }
  | { t: "donate"; a: number; who: number; amt: bigint }
  | { t: "gpause"; on: boolean }
  | { t: "apause"; a: number; on: boolean }
  | { t: "fee"; a: number; bps: number }
  | { t: "delist"; a: number }
  | { t: "relist"; a: number; bps: number }
  | { t: "evil"; fn: number; who: number }
  | { t: "probe"; who: number; fn: number };

const assetArb = fc.integer({ min: 0, max: 1 });
const sizeArb: fc.Arbitrary<Size> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ pct: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 1, arbitrary: fc.constant("overReserve" as const) },
  { weight: 1, arbitrary: fc.constant("overLimit" as const) },
);
const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant("deposit" as const), a: assetArb, who: whoArb, amt: amountArb }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("withdraw" as const), a: assetArb, who: whoArb, pct: pctArb }) },
  { weight: 6, arbitrary: fc.record({ t: fc.constant("flash" as const), a: assetArb, kind: fc.constantFrom<Kind>("good", "under", "over", "bad", "reDeposit"), size: sizeArb, who: whoArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("donate" as const), a: assetArb, who: whoArb, amt: amountArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("gpause" as const), on: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("apause" as const), a: assetArb, on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("fee" as const), a: assetArb, bps: fc.integer({ min: 0, max: 105 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("delist" as const), a: assetArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("relist" as const), a: assetArb, bps: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("evil" as const), fn: fc.integer({ min: 0, max: 2 }), who: whoArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("probe" as const), who: whoArb, fn: fc.integer({ min: 0, max: 7 }) }) },
);

/** Inline receiver: mode 0 repays amount+fee, 1 one unit short, 2 over-pays by 7. */
const MODAL_RX = `(impl-trait .flashstack-v3-receiver-trait.flashstack-v3-receiver-trait)
(use-trait sip-010-trait .sip-010-trait-ft-standard.sip-010-trait)
(define-data-var mode uint u0)
(define-public (set-mode (m uint)) (ok (var-set mode m)))
(define-public (execute-flash (token <sip-010-trait>) (amount uint) (core principal))
  (let ((fee (unwrap-panic (contract-call? .${POOL} calculate-fee (contract-of token) amount)))
        (m (var-get mode))
        (pay (if (is-eq m u1) (- (+ amount fee) u1) (if (is-eq m u2) (+ amount fee u7) (+ amount fee)))))
    (try! (as-contract (contract-call? token transfer pay tx-sender core none)))
    (ok true)))`;

describe("invariants: flashstack-pool-v3 (stateful, two assets + malicious token)", () => {
  it("I1-I13 hold after every step of random multi-asset sequences", async () => {
    const cov = new Coverage();
    await stateful(POOL, fc.array(actArb, { minLength: 14, maxLength: 30 }), (acts, log) => {
      const { deployer, wallets } = accounts();
      const pool = `${deployer}.${POOL}`;
      const tok = (i: number) => Cl.contractPrincipal(deployer, ASSETS[i].name);
      const aid = (i: number) => `${deployer}.${ASSETS[i].name}`;
      deploy("inv-rx-pool-v3", MODAL_RX);
      const RX = {
        good: "test-pool-v3-receiver-good", bad: "test-pool-v3-receiver-bad",
        re: "test-pool-v3-receiver-reentrant", modal: "inv-rx-pool-v3",
      };
      const holders = [...wallets];

      // Setup: both assets listed at 5 bp; wallets and receivers funded; receivers approved.
      const model = ASSETS.map(() => ({ enabled: true, paused: false, bps: 5n }));
      let gpaused = false;
      ASSETS.forEach((A, i) => {
        expectRes(call(POOL, "add-asset", [tok(i), Cl.uint(5), Cl.uint(MAX_LOAN)], deployer), true, "setup add-asset");
        for (const p of [...wallets, ...Object.values(RX).map((r) => `${deployer}.${r}`)])
          expectRes(call(A.name, "mint", [Cl.uint(10n ** 13n), Cl.principal(p)], deployer), true, "setup mint");
        expectRes(call(POOL, "deposit", [tok(i), Cl.uint(MAX_LOAN)], wallets[2]), true, "setup bootstrap deposit");
      });
      for (const r of Object.values(RX)) expectRes(call(POOL, "add-approved-receiver", [Cl.principal(`${deployer}.${r}`)], deployer), true, "approve");

      // State is read straight from the contract's maps (cheap); the read-only
      // getters are cross-checked against those reads once per run.
      const snapAsset = (i: number) => ({
        B: ftBalance(ASSETS[i].name, pool),
        S: (mapEntry(POOL, "total-shares", Cl.principal(aid(i))) ?? 0n) as bigint,
        sh: holders.map((h) => (mapEntry(POOL, "lp-shares", Cl.tuple({ asset: Cl.principal(aid(i)), lp: Cl.principal(h) })) ?? 0n) as bigint),
        cfg: mapEntry(POOL, "assets", Cl.principal(aid(i))),
      });
      for (const i of [0, 1]) {
        ftBalanceChecked(ASSETS[i].name, pool);
        const s0 = snapAsset(i);
        inv(json(s0.cfg) === json(ro(POOL, "get-asset", [Cl.principal(aid(i))]))
          && s0.S === ro(POOL, "get-total-shares", [Cl.principal(aid(i))])
          && s0.sh[2] === ro(POOL, "get-shares", [Cl.principal(aid(i)), Cl.principal(wallets[2])]), "harness: map reads == getters");
      }
      const snap = () => [snapAsset(0), snapAsset(1)];
      const scale = (i: number) => ASSETS[i].scale;

      const checkAll = (pre: ReturnType<typeof snap>, post: ReturnType<typeof snap>, step: string) => {
        inv(dataVar(POOL, "paused") === gpaused, "model global pause");
        for (const i of [0, 1]) {
          const [p0, p1] = [pre[i], post[i]];
          inv(mapEntry(POOL, "asset-locked", Cl.principal(aid(i))) !== true, "I7 asset-locked released", { i, step });
          inv(p1.S === p1.sh.reduce((x, y) => x + y, 0n), "I1 total-shares == sum(shares)", { i, p1 });
          const red = p1.sh.reduce((x, s) => x + (s * (p1.B + 1n)) / (p1.S + scale(i)), 0n);
          inv(red <= p1.B, "I2 solvency", { i, red, B: p1.B });
          inv((p1.B + 1n) * (p0.S + scale(i)) >= (p0.B + 1n) * (p1.S + scale(i)), "I3 share price non-decreasing", { i, p0, p1 });
          inv(p1.cfg.enabled === model[i].enabled && p1.cfg.paused === model[i].paused && p1.cfg["fee-bp"] === model[i].bps,
            "model asset cfg", { i, cfg: p1.cfg, model: model[i] });
          inv(p1.cfg["share-scale"] === scale(i), "share-scale calibrated to decimals", { i });
        }
      };
      const other = (i: number) => 1 - i;
      const isolated = (i: number, pre: ReturnType<typeof snap>, post: ReturnType<typeof snap>, step: string) =>
        inv(json(pre[other(i)]) === json(post[other(i)]), "I10 asset isolation", { touched: i, step, pre: pre[other(i)], post: post[other(i)] });
      const cacheFresh = (i: number, post: ReturnType<typeof snap>, step: string) =>
        inv(post[i].cfg.reserve === post[i].B, "I11 cached reserve == live balance", { i, step, reserve: post[i].cfg.reserve, B: post[i].B });

      acts.forEach((a, n) => {
        const pre = snap();
        const step = `#${n} ${json(a)}`;
        log.push(`${step} | B=[${pre[0].B},${pre[1].B}] S=[${pre[0].S},${pre[1].S}] g=${gpaused} m=${json(model)}`);
        let touched: number | null = null;
        let post: ReturnType<typeof snap>;

        switch (a.t) {
          case "deposit": {
            const i = (touched = a.a), w = wallets[a.who], P = pre[i], m = model[i];
            const minted = (a.amt * (P.S + scale(i))) / (P.B + 1n);
            const wb = ftBalance(ASSETS[i].name, w);
            const r = call(POOL, "deposit", [tok(i), Cl.uint(a.amt)], w);
            const want = gpaused ? E.PAUSED : m.paused ? E.ASSET_PAUSED : !m.enabled ? E.NOT_LISTED
              : minted === 0n ? E.ZERO : wb < a.amt ? E.XFER : true;
            expectRes(r, want, "deposit outcome (I5/I6)", step);
            cov.hit(`deposit:${r.ok ? "ok" : r.code}`);
            post = snap();
            if (r.ok) {
              inv(r.val === minted && minted > 0n, "I5 deposit shares == floor(amt*(S+scale)/(B+1)) > 0", { got: r.val, minted });
              inv(post[i].sh[a.who] === P.sh[a.who] + minted && post[i].B === P.B + a.amt, "deposit bookkeeping", step);
              cacheFresh(i, post, step);
            }
            break;
          }
          case "withdraw": {
            const i = (touched = a.a), P = pre[i];
            // Prefer a wallet that actually holds shares, so exits get exercised.
            const holding = [0, 1, 2].filter((k) => P.sh[k] > 0n);
            const k = holding.length ? holding[a.who % holding.length] : a.who, w = wallets[k];
            const mine = P.sh[k], sh = pctOf(mine, a.pct);
            const out = (sh * (P.B + 1n)) / (P.S + scale(i));
            const wb = ftBalance(ASSETS[i].name, w);
            const r = call(POOL, "withdraw", [tok(i), Cl.uint(sh)], w);
            // I6: no pause/enabled term at all.
            const want = sh === 0n ? E.ZERO : sh > mine ? E.INS_SHARES : out === 0n ? E.ZERO : true;
            expectRes(r, want, "withdraw outcome (I6: never gated)", step);
            const gated = gpaused || model[i].paused || !model[i].enabled;
            cov.hit(`withdraw:${r.ok ? "ok" : r.code}${gated ? ":gated" : ""}`);
            post = snap();
            if (r.ok) {
              inv(r.val === out, "I5 withdraw out == floor(sh*(B+1)/(S+scale))", { got: r.val, out });
              inv(ftBalance(ASSETS[i].name, w) === wb + out && post[i].B === P.B - out, "withdraw bookkeeping", step);
              cacheFresh(i, post, step);
            }
            break;
          }
          case "flash": {
            const i = (touched = a.a), P = pre[i], m = model[i];
            const cap = P.B < MAX_LOAN ? P.B : MAX_LOAN;
            const amt = a.size === "overReserve" ? P.B + 1n : a.size === "overLimit" ? MAX_LOAN + 1n
              : pctOf(cap, a.size.pct) > 0n ? pctOf(cap, a.size.pct) : 1n;
            const fee = feeOf(amt, m.bps);
            inv(ro(POOL, "calculate-fee", [Cl.principal(aid(i)), Cl.uint(amt)]) === fee, "I9 calculate-fee", { amt, bps: m.bps });
            let rx = RX.good;
            if (a.kind === "bad") rx = RX.bad;
            if (a.kind === "under" || a.kind === "over") {
              rx = RX.modal;
              call(RX.modal, "set-mode", [Cl.uint(a.kind === "under" ? 1 : 2)], deployer);
            }
            // The reentrant fixture re-enters deposit() for the same asset with the
            // caller's own funds (tx-sender is the wallet, not the receiver).
            if (a.kind === "reDeposit") { rx = RX.re; call(RX.re, "arm", [Cl.uint(1_000_000)], deployer); }
            const pre2 = snap();
            const r = call(POOL, "flash-loan", [tok(i), Cl.uint(amt), Cl.contractPrincipal(deployer, rx)], wallets[a.who]);
            if (a.kind === "reDeposit") call(RX.re, "arm", [Cl.uint(0)], deployer);
            const want = gpaused ? E.PAUSED : !m.enabled ? E.NOT_LISTED : m.paused ? E.ASSET_PAUSED
              : amt > MAX_LOAN ? E.LIMIT : amt > P.B ? E.RESERVE
              : a.kind === "good" || a.kind === "over" ? true
              : a.kind === "reDeposit" ? E.REENTRANT : E.REPAY;
            expectRes(r, want, "flash-loan outcome (I4/I6)", { step, amt, fee });
            cov.hit(`flash:${a.kind}:${r.ok ? "ok" : r.code}`);
            cov.hit(`flash:any:${r.ok ? "ok" : r.code}`);
            post = snap();
            if (r.ok) {
              const paid = a.kind === "over" ? fee + 7n : fee;
              inv(post[i].B - pre2[i].B === paid, "I4 reserve grows by exactly the fee paid (>= fee)", { delta: post[i].B - pre2[i].B, fee });
              inv(post[i].S === pre2[i].S && json(post[i].sh) === json(pre2[i].sh), "I4 flash-loan never mints/burns shares", { pre2, post });
              inv(post[i].cfg["total-loans"] === pre2[i].cfg["total-loans"] + 1n
                && post[i].cfg["total-fees"] === pre2[i].cfg["total-fees"] + paid, "I4 loan stats", { pre: pre2[i].cfg, post: post[i].cfg });
              cacheFresh(i, post, step);
            } else {
              inv(json(post) === json(pre2), "I4 reverted flash-loan changes nothing", { pre2, post });
            }
            break;
          }
          case "donate": {
            const i = (touched = a.a), w = wallets[a.who];
            expectRes(call(ASSETS[i].name, "transfer", [Cl.uint(a.amt), Cl.principal(w), Cl.principal(pool), Cl.none()], w), true, "donate");
            post = snap();
            inv(post[i].B === pre[i].B + a.amt && post[i].cfg.reserve === pre[i].cfg.reserve, "donation: live balance up, cache untouched", step);
            break;
          }
          case "gpause":
            expectRes(call(POOL, "set-paused", [Cl.bool(a.on)], deployer), true, "set-paused");
            gpaused = a.on;
            post = snap();
            break;
          case "apause": {
            const i = (touched = a.a);
            expectRes(call(POOL, "set-asset", [Cl.principal(aid(i)), Cl.uint(model[i].bps), Cl.uint(MAX_LOAN), Cl.bool(a.on)], deployer), true, "set-asset pause");
            model[i].paused = a.on;
            post = snap();
            break;
          }
          case "fee": {
            const i = (touched = a.a), ok = a.bps >= 1 && a.bps <= 100;
            const r = call(POOL, "set-asset", [Cl.principal(aid(i)), Cl.uint(a.bps), Cl.uint(MAX_LOAN), Cl.bool(model[i].paused)], deployer);
            expectRes(r, ok ? true : E.INVALID_FEE, "set-asset fee bounds (MAX-FEE-BP 100)", step);
            if (ok) model[i].bps = BigInt(a.bps);
            post = snap();
            break;
          }
          case "delist": {
            const i = (touched = a.a);
            expectRes(call(POOL, "remove-asset", [Cl.principal(aid(i))], deployer), model[i].enabled ? true : E.NOT_LISTED, "remove-asset", step);
            model[i].enabled = false;
            post = snap();
            inv(post[i].cfg.reserve === pre[i].cfg.reserve && post[i].S === pre[i].S, "delist keeps the entry (soft delete)", step);
            break;
          }
          case "relist": {
            const i = (touched = a.a), was = model[i].enabled;
            const r = call(POOL, "add-asset", [tok(i), Cl.uint(a.bps), Cl.uint(MAX_LOAN)], deployer);
            expectRes(r, was ? E.ALREADY_LISTED : true, "add-asset (re-enable)", step);
            if (!was) model[i] = { enabled: true, paused: false, bps: BigInt(a.bps) };
            post = snap();
            if (!was) cacheFresh(i, post, step);
            break;
          }
          case "evil": {
            const w = wallets[a.who], evil = Cl.contractPrincipal(deployer, "malicious-token");
            const calls: [string, any[]][] = [
              ["deposit", [evil, Cl.uint(1000)]],
              ["withdraw", [evil, Cl.uint(1)]],
              ["flash-loan", [evil, Cl.uint(1000), Cl.contractPrincipal(deployer, RX.good)]],
            ];
            const [fn, args] = calls[a.fn];
            expectRes(call(POOL, fn, args, w), E.NOT_LISTED, `I12 unlisted malicious token: ${fn}`, step);
            post = snap();
            inv(json(post) === json(pre), "I12 malicious token touches nothing", step);
            break;
          }
          case "probe": {
            const w = wallets[a.who];
            const fns: [string, any[]][] = [
              ["set-paused", [Cl.bool(true)]],
              ["add-asset", [Cl.contractPrincipal(deployer, "malicious-token"), Cl.uint(5), Cl.uint(1)]],
              ["set-asset", [Cl.principal(aid(0)), Cl.uint(100), Cl.uint(1), Cl.bool(true)]],
              ["remove-asset", [Cl.principal(aid(1))]],
              ["add-approved-receiver", [Cl.principal(w)]],
              ["remove-approved-receiver", [Cl.principal(`${deployer}.${RX.good}`)]],
              ["transfer-admin", [Cl.principal(w)]],
              ["accept-admin", []],
            ];
            const [fn, args] = fns[a.fn];
            // accept-admin with no pending admin fails with ERR-NOT-PENDING-ADMIN (801).
            expectRes(call(POOL, fn, args, w), fn === "accept-admin" ? 801n : E.NOT_ADMIN, `I8 non-admin ${fn}`, step);
            post = snap();
            inv(json(post) === json(pre), "I8 rejected admin call changes nothing", step);
            break;
          }
        }
        post = post!;
        if (touched !== null) isolated(touched, pre, post, step);
        checkAll(pre, post, step);
      });

      // I13: drain every wallet, both assets, from whatever state the run ended in.
      for (const i of [0, 1]) {
        wallets.forEach((w, k) => {
          const pre = snap();
          const mine = pre[i].sh[k];
          if (mine === 0n) return;
          const out = (mine * (pre[i].B + 1n)) / (pre[i].S + scale(i));
          expectRes(call(POOL, "withdraw", [tok(i), Cl.uint(mine)], w), out === 0n ? E.ZERO : true, "I13 drain", { i, k, pre: pre[i] });
          const post = snap();
          isolated(i, pre, post, `drain ${i}/${k}`);
          checkAll(pre, post, `drain ${i}/${k}`);
        });
      }
    }, 20);
    cov.require(POOL, [
      "deposit:ok", `deposit:${E.PAUSED}`, `deposit:${E.ASSET_PAUSED}`, `deposit:${E.NOT_LISTED}`,
      "withdraw:ok", "withdraw:ok:gated", `withdraw:${E.INS_SHARES}`,
      "flash:good:ok", "flash:over:ok", `flash:under:${E.REPAY}`, `flash:bad:${E.REPAY}`, `flash:reDeposit:${E.REENTRANT}`,
      `flash:any:${E.PAUSED}`, `flash:any:${E.ASSET_PAUSED}`, `flash:any:${E.LIMIT}`, `flash:any:${E.RESERVE}`,
    ]);
  });
});
