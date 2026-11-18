import { describe, it } from "vitest";
import fc from "fast-check";
import { Cl } from "@stacks/transactions";
import {
  Coverage, accounts, amountArb, call, dataVar, deploy, expectRes, feeOf, ftBalance, ftBalanceChecked, inv, json, ro,
  stateful, stxBalance, whoArb,
} from "./invariants-harness";

/**
 * Stateful invariant suite for the admin-funded flash-loan cores
 * flashstack-stx-core-v2 and flashstack-sbtc-core-v2 (no LP shares; the
 * reserve is admin capital). After EVERY step, against an exact model of the
 * reserve balance:
 *
 *   C1 the reserve moves only by: +deposit-reserve, -withdraw-reserve,
 *      +donation, +(what a successful flash-loan's receiver paid, >= fee)
 *   C2 flash-loan ok => reserve grows by exactly what was paid, >= fee;
 *                 err => reserve, stats and receiver balance all unchanged
 *   C3 paused => flash-loan refused; reserve management is not pause-gated
 *   C4 non-admins cannot move the reserve or change config (ERR-NOT-ADMIN)
 *   C5 fee == max(1, floor(amount*bps/10000)), incl. bps = 0 on sbtc-core-v2
 *      (its setter accepts 0..100; the 1-unit minimum fee still applies)
 *   C6 stats: total-loans +1 and total-fees += fee (stx: nominal; sbtc: measured)
 *      only on success
 */

type Kind = "good" | "under" | "over" | "bad";
type Act =
  | { t: "depositReserve"; amt: bigint }
  | { t: "withdrawReserve"; pct: number }
  | { t: "flash"; kind: Kind; pct: number; who: number }
  | { t: "donate"; who: number; amt: bigint }
  | { t: "pause"; on: boolean }
  | { t: "fee"; bps: number }
  | { t: "probe"; who: number; fn: number };

const CORES = [
  {
    asset: "stx" as const, core: "flashstack-stx-core-v2", bad: "test-receiver-bad", maxLoan: 500_000_000_000n,
    feeOk: (b: number) => b >= 1 && b <= 1000, feeErr: 307n, totalFeesVar: "total-fees",
    E: { NOT_ADMIN: 300n, ZERO: 301n, REPAY: 302n, RESERVE: 303n, LIMIT: 304n, PAUSED: 305n, XFER: 308n },
  },
  {
    asset: "sbtc" as const, core: "flashstack-sbtc-core-v2", bad: "test-sbtc-receiver-bad", maxLoan: 10_000_000n,
    // set-fee-basis-points: (<= new-fee u100) else ERR-NOT-ADMIN (sic) -- 0 is accepted.
    feeOk: (b: number) => b <= 100, feeErr: 310n, totalFeesVar: "total-fees-collected",
    E: { NOT_ADMIN: 310n, ZERO: 301n, REPAY: 302n, RESERVE: 303n, LIMIT: 304n, PAUSED: 300n, XFER: 311n },
  },
];

const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ t: fc.constant("depositReserve" as const), amt: amountArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("withdrawReserve" as const), pct: fc.integer({ min: 0, max: 110 }) }) },
  { weight: 6, arbitrary: fc.record({ t: fc.constant("flash" as const), kind: fc.constantFrom<Kind>("good", "under", "over", "bad"), pct: fc.integer({ min: 1, max: 105 }), who: whoArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant("donate" as const), who: whoArb, amt: amountArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("pause" as const), on: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("fee" as const), bps: fc.oneof(fc.constantFrom(0, 1, 100, 101, 1000, 1001), fc.integer({ min: 0, max: 1100 })) }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant("probe" as const), who: whoArb, fn: fc.integer({ min: 0, max: 7 }) }) },
);

const modalRx = (asset: "stx" | "sbtc", core: string) => {
  const pay = asset === "stx"
    ? "(try! (as-contract (stx-transfer? pay tx-sender core)))"
    : "(try! (as-contract (contract-call? .sbtc-token transfer pay tx-sender core none)))";
  return `(impl-trait .${asset}-flash-receiver-trait.${asset}-flash-receiver-trait)
(define-data-var mode uint u0)
(define-public (set-mode (m uint)) (ok (var-set mode m)))
(define-public (execute-${asset}-flash (amount uint) (core principal))
  (let ((fee (unwrap-panic (contract-call? .${core} calculate-fee amount)))
        (m (var-get mode))
        (pay (if (is-eq m u1) (- (+ amount fee) u1) (if (is-eq m u2) (+ amount fee u7) (+ amount fee)))))
    ${pay}
    (ok true)))`;
};

for (const C of CORES) {
  describe(`invariants: ${C.core} (stateful)`, () => {
    it("C1-C6 hold after every step of random reserve/flash/pause/fee sequences", async () => {
      const cov = new Coverage();
      await stateful(C.core, fc.array(actArb, { minLength: 12, maxLength: 28 }), (acts, log) => {
        const { deployer, wallets } = accounts();
        const core = `${deployer}.${C.core}`;
        const rxName = `inv-rx-${C.asset}-core`;
        deploy(rxName, modalRx(C.asset, C.core));
        const mrx = `${deployer}.${rxName}`;
        const bad = `${deployer}.${C.bad}`;
        const bal = (p: string) => (C.asset === "stx" ? stxBalance(p) : ftBalance("sbtc-token", p));
        const mint = (amt: bigint, to: string) =>
          expectRes(call("sbtc-token", "mint", [Cl.uint(amt), Cl.principal(to)], deployer), true, "mint");
        const fund = (amt: bigint, to: string) => (C.asset === "stx" ? simnet.transferSTX(Number(amt), to, deployer) : mint(amt, to));

        if (C.asset === "sbtc") for (const p of [deployer, ...wallets]) mint(10n ** 13n, p);
        fund(C.asset === "stx" ? 20_000_000_000_000n : 1_000_000_000_000n, mrx);
        for (const r of [mrx, bad]) expectRes(call(C.core, "add-approved-receiver", [Cl.principal(r)], deployer), true, "approve");
        expectRes(call(C.core, "deposit-reserve", [Cl.uint(C.maxLoan)], deployer), true, "seed reserve");
        if (C.asset === "sbtc") ftBalanceChecked("sbtc-token", core);

        let paused = false;
        let bps = 5n;
        const stats = () => ({ loans: dataVar(C.core, "total-loans") as bigint, fees: dataVar(C.core, C.totalFeesVar) as bigint });
        const snap = () => ({ B: bal(core), st: stats(), rx: bal(mrx), paused: dataVar(C.core, "paused"), bps: dataVar(C.core, "fee-basis-points") });

        acts.forEach((a, n) => {
          const pre = snap();
          const step = `#${n} ${json(a)}`;
          log.push(`${step} | B=${pre.B} paused=${paused} bps=${bps}`);
          let expectB = pre.B; // C1: the model's reserve after this step

          switch (a.t) {
            case "depositReserve": {
              expectRes(call(C.core, "deposit-reserve", [Cl.uint(a.amt)], deployer), true, "C3 deposit-reserve (not pause-gated)", step);
              expectB = pre.B + a.amt;
              break;
            }
            case "withdrawReserve": {
              const amt = (pre.B * BigInt(a.pct)) / 100n;
              const args = C.asset === "stx" ? [Cl.uint(amt)] : [Cl.uint(amt), Cl.principal(deployer)];
              const r = call(C.core, "withdraw-reserve", args, deployer);
              // stx: ERR-ZERO-AMOUNT for 0; sbtc: no zero check, the token's own transfer refuses 0.
              const want = amt === 0n ? (C.asset === "stx" ? C.E.ZERO : C.E.XFER) : amt > pre.B ? C.E.XFER : true;
              expectRes(r, want, "withdraw-reserve outcome", step);
              cov.hit(`withdrawReserve:${r.ok ? "ok" : r.code}${paused ? ":paused" : ""}`);
              if (r.ok) expectB = pre.B - amt;
              break;
            }
            case "flash": {
              const amt0 = ((pre.B < C.maxLoan ? pre.B : C.maxLoan) * BigInt(a.pct)) / 100n;
              const amt = a.pct > 100 ? C.maxLoan + 1n : amt0 > 0n ? amt0 : 1n;
              const fee = feeOf(amt, bps);
              inv(ro(C.core, "calculate-fee", [Cl.uint(amt)]) === fee, "C5 calculate-fee == max(1, floor(amt*bps/1e4))", { amt, bps });
              let rx = mrx;
              if (a.kind === "bad") rx = bad;
              else call(rxName, "set-mode", [Cl.uint(a.kind === "good" ? 0 : a.kind === "under" ? 1 : 2)], deployer);
              const pre2 = snap();
              const r = call(C.core, "flash-loan", [Cl.uint(amt), Cl.contractPrincipal(deployer, rx.split(".")[1])], wallets[a.who]);
              const want = paused ? C.E.PAUSED : amt > C.maxLoan ? C.E.LIMIT : amt > pre.B ? C.E.RESERVE
                : a.kind === "good" || a.kind === "over" ? true : C.E.REPAY;
              expectRes(r, want, "C2/C3 flash-loan outcome", { step, amt, fee });
              cov.hit(`flash:${a.kind}:${r.ok ? "ok" : r.code}`);
              cov.hit(`flash:any:${r.ok ? "ok" : r.code}`);
              if (bps === 0n && r.ok) cov.hit("flash:ok:bps0");
              const post = snap();
              if (r.ok) {
                const paid = a.kind === "over" ? fee + 7n : fee;
                inv(post.B - pre2.B === paid && paid >= fee, "C2 reserve grows by exactly what was paid, >= fee", { delta: post.B - pre2.B, fee });
                inv(post.st.loans === pre2.st.loans + 1n, "C6 total-loans +1");
                inv(post.st.fees === pre2.st.fees + (C.asset === "stx" ? fee : paid), "C6 total-fees", { pre: pre2.st, post: post.st });
                expectB = pre.B + paid;
              } else {
                inv(json(post) === json(pre2), "C2 reverted flash-loan changes nothing", { pre2, post });
              }
              break;
            }
            case "donate": {
              const w = wallets[a.who];
              if (C.asset === "stx") simnet.transferSTX(Number(a.amt), core, w);
              else expectRes(call("sbtc-token", "transfer", [Cl.uint(a.amt), Cl.principal(w), Cl.principal(core), Cl.none()], w), true, "donate");
              expectB = pre.B + a.amt;
              break;
            }
            case "pause":
              expectRes(call(C.core, "set-paused", [Cl.bool(a.on)], deployer), true, "set-paused");
              paused = a.on;
              break;
            case "fee": {
              const ok = C.feeOk(a.bps);
              expectRes(call(C.core, "set-fee-basis-points", [Cl.uint(a.bps)], deployer), ok ? true : C.feeErr, "C5 fee setter bounds", step);
              if (ok) bps = BigInt(a.bps);
              break;
            }
            case "probe": {
              const w = wallets[a.who];
              const fns: [string, any[]][] = [
                ["deposit-reserve", [Cl.uint(1)]],
                ["withdraw-reserve", C.asset === "stx" ? [Cl.uint(1)] : [Cl.uint(1), Cl.principal(w)]],
                ["add-approved-receiver", [Cl.principal(w)]],
                ["remove-approved-receiver", [Cl.principal(mrx)]],
                ["set-fee-basis-points", [Cl.uint(50)]],
                ["set-paused", [Cl.bool(!paused)]],
                ["set-max-single-loan", [Cl.uint(1)]],
                [C.asset === "stx" ? "transfer-admin" : "set-admin", [Cl.principal(w)]],
              ];
              const [fn, args] = fns[a.fn];
              expectRes(call(C.core, fn, args, w), C.E.NOT_ADMIN, `C4 non-admin ${fn}`, step);
              break;
            }
          }
          const post = snap();
          inv(post.B === expectB, "C1 reserve moves only as modelled", { step, B: post.B, expectB });
          inv(post.paused === paused && post.bps === bps, "model config", { post });
        });
      }, 15);
      const E = C.E;
      cov.require(C.core, [
        "flash:good:ok", "flash:over:ok", `flash:under:${E.REPAY}`, `flash:bad:${E.REPAY}`,
        `flash:any:${E.PAUSED}`, `flash:any:${E.LIMIT}`, "withdrawReserve:ok", "withdrawReserve:ok:paused", `withdrawReserve:${E.XFER}`,
        ...(C.asset === "sbtc" ? ["flash:ok:bps0"] : []),
      ]);
    });
  });
}
