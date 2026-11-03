import { describe, it } from "vitest";
import fc from "fast-check";
import { Cl } from "@stacks/transactions";
import {
  Coverage, accounts, amountArb, call, dataVar, deploy, expectRes, feeOf, ftBalance, ftBalanceChecked, inv, mapEntry, json, pctArb, pctOf, ro,
  stateful, stxBalance, whoArb,
} from "./invariants-harness";

/**
 * Stateful invariant suite for the single-asset LP pools
 * flashstack-stx-pool-v3 and flashstack-sbtc-pool-v3 (simnet resolves both to
 * their contracts/test/ copies).
 *
 * Random sequences of deposit / withdraw / flash-loan (honest, short-by-one,
 * over-paying, non-repaying, deposit-reentrant, withdraw-reentrant) /
 * donation / pause / fee changes / non-admin probes, across three wallets.
 * After EVERY step, and against an exact model of the share math:
 *
 *   I1 total-shares == sum of every holder's shares
 *   I2 solvency: sum_i floor(shares_i * (B+1) / (S+V)) <= B (all LPs can exit)
 *   I3 share price (B+1)/(S+V) never decreases (fees and donations only add)
 *   I4 flash-loan: ok => B grows by exactly the fee paid (>= fee), shares untouched;
 *                  err => nothing at all changed
 *   I5 deposit/withdraw output == the floor-rounded formula (rounding favours the pool)
 *   I6 paused => deposit and flash-loan refused, withdraw behaves exactly as unpaused
 *   I7 reentrancy-locked is false after every transaction
 *   I8 every admin function rejects every non-admin
 *   I9 fee == max(1, floor(amount*bps/10000)): calculate-fee and the realised fee
 *   I10 final drain: every wallet can withdraw all of its shares
 *
 * Deliberately NOT asserted in the random runs: "a successful deposit mints
 * > 0 shares". These pools do not have pool-v3's zero-share guard; see the
 * it.fails repro at the bottom of this file.
 */

type Kind = "good" | "under" | "over" | "bad" | "reDeposit" | "reWithdraw";
/** Loan size: a percent of min(reserve, max-loan), or deliberately just past one of them. */
type Size = { pct: number } | "overReserve" | "overLimit";
const sizeArb: fc.Arbitrary<Size> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ pct: fc.integer({ min: 1, max: 100 }) }) },
  { weight: 1, arbitrary: fc.constant("overReserve" as const) },
  { weight: 1, arbitrary: fc.constant("overLimit" as const) },
);
type Act =
  | { t: "deposit"; who: number; amt: bigint }
  | { t: "withdraw"; who: number; pct: number }
  | { t: "flash"; kind: Kind; size: Size }
  | { t: "donate"; who: number; amt: bigint }
  | { t: "pause"; on: boolean }
  | { t: "fee"; bps: number }
  | { t: "seed"; amt: bigint }
  | { t: "probe"; who: number; fn: number };

const POOLS = [
  {
    asset: "stx" as const, pool: "flashstack-stx-pool-v3", V: 1_000_000n, feeMax: 1000, maxLoan: 5_000_000_000n,
    rx: "test-stx-pool-v3-receiver-reentrant", bad: "test-receiver-bad",
    E: { NOT_ADMIN: 400n, ZERO: 401n, REPAY: 402n, RESERVE: 403n, LIMIT: 404n, PAUSED: 405n, INVALID_FEE: 407n, INS_SHARES: 409n, XFER: 402n, REENTRANT: 411n },
  },
  {
    asset: "sbtc" as const, pool: "flashstack-sbtc-pool-v3", V: 100_000_000n, feeMax: 100, maxLoan: 10_000_000n,
    rx: "test-sbtc-pool-v3-receiver-reentrant", bad: "test-sbtc-receiver-bad",
    E: { NOT_ADMIN: 700n, ZERO: 701n, REPAY: 702n, RESERVE: 703n, LIMIT: 704n, PAUSED: 705n, INVALID_FEE: 707n, INS_SHARES: 709n, XFER: 710n, REENTRANT: 712n },
  },
];

const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ t: fc.constant("deposit" as const), who: whoArb, amt: amountArb }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant("withdraw" as const), who: whoArb, pct: pctArb }) },
  { weight: 5, arbitrary: fc.record({ t: fc.constant("flash" as const), kind: fc.constantFrom<Kind>("good", "under", "over", "bad", "reDeposit", "reWithdraw"), size: sizeArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("donate" as const), who: whoArb, amt: amountArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("pause" as const), on: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("fee" as const), bps: fc.integer({ min: 0, max: 1005 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("seed" as const), amt: fc.bigInt(1n, 10_000_000n) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("probe" as const), who: whoArb, fn: fc.integer({ min: 0, max: 5 }) }) },
);

/** Inline receiver: mode 0 repays amount+fee, 1 repays one unit short, 2 over-pays by 7. */
const modalRx = (asset: "stx" | "sbtc", pool: string) => {
  const pay = asset === "stx"
    ? "(try! (as-contract (stx-transfer? pay tx-sender core)))"
    : "(try! (as-contract (contract-call? .sbtc-token transfer pay tx-sender core none)))";
  return `(impl-trait .${asset}-flash-receiver-trait.${asset}-flash-receiver-trait)
(define-data-var mode uint u0)
(define-public (set-mode (m uint)) (ok (var-set mode m)))
(define-public (execute-${asset}-flash (amount uint) (core principal))
  (let ((fee (unwrap-panic (contract-call? .${pool} calculate-fee amount)))
        (m (var-get mode))
        (pay (if (is-eq m u1) (- (+ amount fee) u1) (if (is-eq m u2) (+ amount fee u7) (+ amount fee)))))
    ${pay}
    (ok true)))`;
};

for (const P of POOLS) {
  describe(`invariants: ${P.pool} (stateful, random action sequences)`, () => {
    it("I1-I10 hold after every step of random deposit/withdraw/flash/donate/pause sequences", async () => {
      const cov = new Coverage();
      await stateful(P.pool, fc.array(actArb, { minLength: 12, maxLength: 28 }), (acts, log) => {
        const { deployer, wallets } = accounts();
        const pool = `${deployer}.${P.pool}`;
        const rx = `${deployer}.${P.rx}`;
        const mrxName = `inv-rx-${P.asset}`;
        deploy(mrxName, modalRx(P.asset, P.pool));
        const mrx = `${deployer}.${mrxName}`;
        const holders = [...wallets, rx];

        const bal = (p: string) => (P.asset === "stx" ? stxBalance(p) : ftBalance("sbtc-token", p));
        const fund = (amt: bigint, to: string) =>
          P.asset === "stx"
            ? simnet.transferSTX(Number(amt), to, deployer)
            : simnet.callPublicFn("sbtc-token", "mint", [Cl.uint(amt), Cl.principal(to)], deployer);
        const sendSbtc = (amt: bigint, from: string, to: string) =>
          call("sbtc-token", "transfer", [Cl.uint(amt), Cl.principal(from), Cl.principal(to), Cl.none()], from);

        // Setup: funded wallets and receivers, all receivers approved.
        if (P.asset === "sbtc") for (const w of wallets) fund(1_000_000_000_000n, w);
        for (const r of [rx, mrx]) fund(P.asset === "stx" ? 50_000_000_000n : 1_000_000_000n, r);
        for (const r of [rx, mrx, `${deployer}.${P.bad}`])
          expectRes(call(P.pool, "add-approved-receiver", [Cl.principal(r)], deployer), true, "setup-approve");

        // Bootstrap liquidity from wallet_3 so loans have something to borrow.
        expectRes(call(P.pool, "deposit", [Cl.uint(P.maxLoan)], wallets[2]), true, "setup-bootstrap-deposit");
        if (P.asset === "sbtc") ftBalanceChecked("sbtc-token", pool);
        // State is read straight from the contract's maps/vars (cheap); the
        // read-only getters are cross-checked once per run below.
        const shares = (p: string): bigint => mapEntry(P.pool, "lp-shares", Cl.principal(p)) ?? 0n;
        inv(shares(wallets[2]) === ro(P.pool, "get-shares", [Cl.principal(wallets[2])]), "harness: map read == get-shares");
        const snap = () => ({
          B: bal(pool),
          S: dataVar(P.pool, "total-shares") as bigint,
          sh: holders.map(shares),
          stats: {
            "total-loans": dataVar(P.pool, "total-loans") as bigint,
            "total-fees": dataVar(P.pool, "total-fees") as bigint,
            "paused": dataVar(P.pool, "paused") as boolean,
            "fee-basis-points": dataVar(P.pool, "fee-basis-points") as bigint,
          },
        });
        let paused = false;
        let bps = 5n;

        const checkGlobal = (pre: ReturnType<typeof snap>, post: ReturnType<typeof snap>, step: string) => {
          inv(dataVar(P.pool, "reentrancy-locked") === false, "I7 lock released", step);
          inv(post.S === post.sh.reduce((a, b) => a + b, 0n), "I1 total-shares == sum(shares)", { S: post.S, sh: post.sh });
          const redeemable = post.sh.reduce((a, s) => a + (s * (post.B + 1n)) / (post.S + P.V), 0n);
          inv(redeemable <= post.B, "I2 solvency", { redeemable, B: post.B });
          // price = (B+1)/(S+V); cross-multiplied so no rounding hides a drop
          inv((post.B + 1n) * (pre.S + P.V) >= (pre.B + 1n) * (post.S + P.V), "I3 share price non-decreasing", { pre, post });
          inv(post.stats["paused"] === paused, "model paused");
          inv(post.stats["fee-basis-points"] === bps, "model fee");
        };

        acts.forEach((a, i) => {
          const pre = snap();
          const step = `#${i} ${json(a)}`;
          log.push(`${step} | B=${pre.B} S=${pre.S} paused=${paused} bps=${bps}`);

          switch (a.t) {
            case "deposit": {
              const w = wallets[a.who];
              const wb = bal(w);
              const r = call(P.pool, "deposit", [Cl.uint(a.amt)], w);
              const want = paused ? P.E.PAUSED : wb < a.amt ? P.E.XFER : true;
              expectRes(r, want, "deposit outcome (I6 when paused)", step);
              cov.hit(`deposit:${r.ok ? "ok" : r.code}`);
              if (r.ok) {
                const minted = (a.amt * (pre.S + P.V)) / (pre.B + 1n);
                inv(r.val === minted, "I5 deposit shares == floor(amt*(S+V)/(B+1))", { got: r.val, minted });
                inv(shares(w) === pre.sh[a.who] + minted, "I5 depositor credited", step);
                inv(bal(pool) === pre.B + a.amt, "deposit moves exactly amt", step);
              }
              break;
            }
            case "withdraw": {
              // Prefer a wallet that actually holds shares, so exits get exercised.
              const holding = [0, 1, 2].filter((k) => pre.sh[k] > 0n);
              const w = wallets[holding.length ? holding[a.who % holding.length] : a.who];
              const mine = pre.sh[wallets.indexOf(w)];
              const sh = pctOf(mine, a.pct);
              const wb = bal(w);
              const out = (sh * (pre.B + 1n)) / (pre.S + P.V);
              const r = call(P.pool, "withdraw", [Cl.uint(sh)], w);
              // I6: no `paused` term -- withdraw must behave identically when paused.
              const want = sh === 0n ? P.E.ZERO : sh > mine ? P.E.INS_SHARES : out === 0n ? P.E.ZERO : true;
              expectRes(r, want, "withdraw outcome (I6: never pause-gated)", step);
              cov.hit(`withdraw:${r.ok ? "ok" : r.code}${paused ? ":paused" : ""}`);
              if (r.ok) {
                inv(r.val === out, "I5 withdraw out == floor(sh*(B+1)/(S+V))", { got: r.val, out });
                inv(bal(w) === wb + out && bal(pool) === pre.B - out, "withdraw moves exactly out", step);
              }
              break;
            }
            case "flash": {
              const cap = pre.B < P.maxLoan ? pre.B : P.maxLoan;
              const amt = a.size === "overReserve" ? pre.B + 1n
                : a.size === "overLimit" ? P.maxLoan + 1n
                : pctOf(cap, a.size.pct) > 0n ? pctOf(cap, a.size.pct) : 1n;
              const fee = feeOf(amt, bps);
              inv(ro(P.pool, "calculate-fee", [Cl.uint(amt)]) === fee, "I9 calculate-fee == max(1, floor(amt*bps/1e4))", { amt, bps });
              let target = rx;
              if (a.kind === "good") call(P.rx, "set-mode", [Cl.uint(0)], deployer);
              if (a.kind === "reDeposit") call(P.rx, "set-mode", [Cl.uint(1)], deployer);
              if (a.kind === "reWithdraw") call(P.rx, "set-mode", [Cl.uint(2)], deployer);
              if (a.kind === "bad") target = `${deployer}.${P.bad}`;
              if (a.kind === "under" || a.kind === "over") {
                target = mrx;
                call(mrxName, "set-mode", [Cl.uint(a.kind === "under" ? 1 : 2)], deployer);
              }
              const pre2 = snap(); // after set-mode (receiver state only)
              const [ca, cn] = target.split(".");
              const r = call(P.pool, "flash-loan", [Cl.uint(amt), Cl.contractPrincipal(ca, cn)], wallets[0]);
              const want = paused ? P.E.PAUSED
                : amt > P.maxLoan ? P.E.LIMIT
                : amt > pre.B ? P.E.RESERVE
                : a.kind === "good" || a.kind === "over" ? true
                : a.kind === "under" || a.kind === "bad" ? P.E.REPAY
                : P.E.REENTRANT;
              expectRes(r, want, "flash-loan outcome (I4/I6)", { step, amt, fee });
              cov.hit(`flash:${a.kind}:${r.ok ? "ok" : r.code}`);
              cov.hit(`flash:any:${r.ok ? "ok" : r.code}`);
              const post = snap();
              if (r.ok) {
                const paid = a.kind === "over" ? fee + 7n : fee;
                inv(post.B - pre2.B === paid && paid >= fee, "I4 reserve grows by the fee paid", { delta: post.B - pre2.B, fee });
                inv(json(post.sh) === json(pre2.sh) && post.S === pre2.S, "I4 flash-loan never mints/burns shares", { pre2, post });
                inv(post.stats["total-loans"] === pre2.stats["total-loans"] + 1n, "I4 total-loans +1");
                const feeStat = P.asset === "stx" ? fee : paid; // stx books the nominal fee, sbtc the measured delta
                inv(post.stats["total-fees"] === pre2.stats["total-fees"] + feeStat, "I4 total-fees", { post: post.stats, pre: pre2.stats });
              } else {
                inv(json(post) === json(pre2), "I4 reverted flash-loan changes nothing", { pre2, post });
              }
              break;
            }
            case "donate": {
              const w = wallets[a.who];
              if (P.asset === "stx") simnet.transferSTX(Number(a.amt), pool, w);
              else expectRes(sendSbtc(a.amt, w, pool), true, "donate");
              inv(bal(pool) === pre.B + a.amt, "donation lands", step);
              break;
            }
            case "pause":
              expectRes(call(P.pool, "set-paused", [Cl.bool(a.on)], deployer), true, "admin set-paused");
              paused = a.on;
              break;
            case "fee": {
              const ok = a.bps >= 1 && a.bps <= P.feeMax;
              expectRes(call(P.pool, "set-fee-basis-points", [Cl.uint(a.bps)], deployer), ok ? true : P.E.INVALID_FEE, "admin set-fee bounds", step);
              if (ok) bps = BigInt(a.bps);
              break;
            }
            case "seed": {
              // The reentrant receiver takes an LP position of its own (as-contract deposit).
              const r = call(P.rx, "seed-deposit", [Cl.uint(a.amt)], deployer);
              expectRes(r, paused ? P.E.PAUSED : true, "receiver seed-deposit", step);
              break;
            }
            case "probe": {
              const w = wallets[a.who];
              const fns: [string, any[]][] = [
                ["set-paused", [Cl.bool(!paused)]],
                ["set-fee-basis-points", [Cl.uint(7)]],
                ["set-max-single-loan", [Cl.uint(1)]],
                ["add-approved-receiver", [Cl.principal(w)]],
                ["remove-approved-receiver", [Cl.principal(rx)]],
                ["transfer-admin", [Cl.principal(w)]],
              ];
              const [fn, args] = fns[a.fn];
              expectRes(call(P.pool, fn, args, w), P.E.NOT_ADMIN, `I8 non-admin ${fn}`, step);
              break;
            }
          }
          checkGlobal(pre, snap(), step);
        });

        // I10: unpause and drain. Every wallet must be able to take all its shares out.
        call(P.pool, "set-paused", [Cl.bool(false)], deployer);
        paused = false;
        wallets.forEach((w, k) => {
          const pre = snap();
          const mine = pre.sh[k];
          if (mine === 0n) return;
          const out = (mine * (pre.B + 1n)) / (pre.S + P.V);
          const r = call(P.pool, "withdraw", [Cl.uint(mine)], w);
          expectRes(r, out === 0n ? P.E.ZERO : true, "I10 drain: full exit honoured", { w: k, mine, pre });
          checkGlobal(pre, snap(), `drain ${k}`);
        });
      }, 15);
      const E = P.E;
      cov.require(P.pool, [
        "deposit:ok", `deposit:${E.PAUSED}`, "withdraw:ok", "withdraw:ok:paused", `withdraw:${E.INS_SHARES}`,
        "flash:good:ok", "flash:over:ok", `flash:under:${E.REPAY}`, `flash:bad:${E.REPAY}`, `flash:any:${E.LIMIT}`, `flash:any:${E.RESERVE}`,
        `flash:reDeposit:${E.REENTRANT}`, `flash:reWithdraw:${E.REENTRANT}`, `flash:any:${E.PAUSED}`,
      ]);
    });
  });
}

// -------------------------------------------------------------------------
// FINDING (repro): the single-asset v3 pools accept a deposit that mints zero
// shares. flashstack-pool-v3 rejects this (`(asserts! (> new-shares u0)
// ERR-ZERO-AMOUNT)`, MULTI_ASSET_CORE_DESIGN.md section 13 finding 2), but the
// guard was never ported to flashstack-stx-pool-v3 / flashstack-sbtc-pool-v3.
// After any donation that pushes (B+1) above amount*(S+V), a small deposit is
// taken in full and credited nothing; the value accrues to existing holders.
// `it.fails`: these pass while the bug exists and will go red once the guard
// is added -- flip them to `it` then.
// -------------------------------------------------------------------------
for (const P of POOLS) {
  describe(`finding: ${P.pool} zero-share deposit`, () => {
    it.fails("a successful deposit always mints > 0 shares (violated: dust deposit after a donation)", () => {
      const { deployer, wallets } = accounts();
      const [attacker, victim] = wallets;
      const pool = `${deployer}.${P.pool}`;
      if (P.asset === "sbtc") {
        for (const w of wallets) simnet.callPublicFn("sbtc-token", "mint", [Cl.uint(10n ** 12n), Cl.principal(w)], deployer);
      }
      // Empty pool (S = 0). Donate V units: a 1-unit deposit then mints
      // floor(1 * V / (V + 1)) = 0 shares.
      if (P.asset === "stx") simnet.transferSTX(Number(P.V), pool, attacker);
      else expectRes(call("sbtc-token", "transfer", [Cl.uint(P.V), Cl.principal(attacker), Cl.principal(pool), Cl.none()], attacker), true, "donate");
      const before = P.asset === "stx" ? stxBalance(pool) : ftBalance("sbtc-token", pool);
      const r = call(P.pool, "deposit", [Cl.uint(1)], victim);
      const after = P.asset === "stx" ? stxBalance(pool) : ftBalance("sbtc-token", pool);
      // Today: ok u0, and the pool kept the victim's unit.
      inv(!(r.ok && r.val === 0n && after === before + 1n), "deposit minted 0 shares but took the funds", { r, before, after });
    });
  });
}
