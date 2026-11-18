import { describe, it } from "vitest";
import fc from "fast-check";
import { Cl, ClarityValue } from "@stacks/transactions";
import { Coverage, accounts, call, dataVar, expectRes, inv, json, stateful } from "./invariants-harness";

/**
 * Model-based authorization test, all five successor contracts.
 *
 * A random sequence of (caller, action) pairs over all four simnet accounts,
 * where an action is "propose X as admin", "accept", or one of the contract's
 * admin-only functions. The model tracks (admin, pending). After every call:
 *
 *   A1 an admin-only function succeeds iff the caller is the model's admin;
 *      otherwise it fails with exactly ERR-NOT-ADMIN
 *   A2 propose succeeds iff the caller is the admin, and only sets pending:
 *      the pending admin has NO powers until it accepts
 *   A3 accept succeeds iff the caller is the pending admin; afterwards the
 *      old admin has no powers and pending is cleared
 *   A4 on-chain (admin, pending-admin) == model after every call
 *
 * The admin functions are called with benign arguments so a successful call
 * does not change what later calls are allowed to do.
 */

type Spec = {
  contract: string;
  propose: string;
  NOT_ADMIN: bigint;
  NOT_PENDING: bigint;
  adminFns: (who: string, deployer: string) => [string, ClarityValue[]][];
};

const SPECS: Spec[] = [
  {
    contract: "flashstack-pool-v3", propose: "transfer-admin", NOT_ADMIN: 800n, NOT_PENDING: 801n,
    adminFns: (w, d) => [
      ["set-paused", [Cl.bool(false)]],
      ["add-approved-receiver", [Cl.principal(w)]],
      ["remove-approved-receiver", [Cl.principal(w)]],
      ["set-asset", [Cl.principal(`${d}.sbtc-token`), Cl.uint(5), Cl.uint(1_000_000), Cl.bool(false)]],
      // remove + add of mock-usdcx alternate; an admin call may legitimately
      // fail on listing state, so A1 for admins only requires "not ERR-NOT-ADMIN".
      ["remove-asset", [Cl.principal(`${d}.mock-usdcx`)]],
      ["add-asset", [Cl.contractPrincipal(d, "mock-usdcx"), Cl.uint(5), Cl.uint(1_000_000)]],
    ],
  },
  {
    contract: "flashstack-stx-pool-v3", propose: "transfer-admin", NOT_ADMIN: 400n, NOT_PENDING: 410n,
    adminFns: (w) => [
      ["set-paused", [Cl.bool(false)]],
      ["set-fee-basis-points", [Cl.uint(5)]],
      ["set-max-single-loan", [Cl.uint(5_000_000_000)]],
      ["add-approved-receiver", [Cl.principal(w)]],
      ["remove-approved-receiver", [Cl.principal(w)]],
    ],
  },
  {
    contract: "flashstack-sbtc-pool-v3", propose: "transfer-admin", NOT_ADMIN: 700n, NOT_PENDING: 711n,
    adminFns: (w) => [
      ["set-paused", [Cl.bool(false)]],
      ["set-fee-basis-points", [Cl.uint(5)]],
      ["set-max-single-loan", [Cl.uint(10_000_000)]],
      ["add-approved-receiver", [Cl.principal(w)]],
      ["remove-approved-receiver", [Cl.principal(w)]],
    ],
  },
  {
    contract: "flashstack-stx-core-v2", propose: "transfer-admin", NOT_ADMIN: 300n, NOT_PENDING: 309n,
    adminFns: (w) => [
      ["set-paused", [Cl.bool(false)]],
      ["set-fee-basis-points", [Cl.uint(5)]],
      ["set-max-single-loan", [Cl.uint(500_000_000_000)]],
      ["add-approved-receiver", [Cl.principal(w)]],
      ["remove-approved-receiver", [Cl.principal(w)]],
      // Moves value: deposit 1 then withdraw 1 (to the admin) -- net zero for
      // the reserve, and the probe for "who can move the reserve".
      ["deposit-reserve", [Cl.uint(1)]],
      ["withdraw-reserve", [Cl.uint(1)]],
    ],
  },
  {
    contract: "flashstack-sbtc-core-v2", propose: "set-admin", NOT_ADMIN: 310n, NOT_PENDING: 312n,
    adminFns: (w) => [
      ["set-paused", [Cl.bool(false)]],
      ["set-fee-basis-points", [Cl.uint(5)]],
      ["set-max-single-loan", [Cl.uint(10_000_000)]],
      ["add-approved-receiver", [Cl.principal(w)]],
      ["remove-approved-receiver", [Cl.principal(w)]],
      ["deposit-reserve", [Cl.uint(1)]],
      ["withdraw-reserve", [Cl.uint(1), Cl.principal(w)]],
    ],
  },
];

type Act = { caller: number; op: "propose"; target: number } | { caller: number; op: "accept" } | { caller: number; op: "fn"; fn: number };
const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ caller: fc.integer({ min: 0, max: 3 }), op: fc.constant("propose" as const), target: fc.integer({ min: 0, max: 3 }) }) },
  { weight: 2, arbitrary: fc.record({ caller: fc.integer({ min: 0, max: 3 }), op: fc.constant("accept" as const) }) },
  { weight: 5, arbitrary: fc.record({ caller: fc.integer({ min: 0, max: 3 }), op: fc.constant("fn" as const), fn: fc.integer({ min: 0, max: 6 }) }) },
);

describe("invariants: admin authorization + two-step transfer (all successors)", () => {
  for (const S of SPECS) {
    it(`A1-A4 on ${S.contract}`, async () => {
      const cov = new Coverage();
      await stateful(`${S.contract} admin`, fc.array(actArb, { minLength: 15, maxLength: 40 }), (acts, log) => {
        const { deployer, wallets } = accounts();
        const ppl = [deployer, ...wallets];
        // Everyone can pay for deposit-reserve; the core holds 1 unit so withdraw-reserve(1) can succeed.
        for (const p of ppl) call("sbtc-token", "mint", [Cl.uint(1_000_000), Cl.principal(p)], deployer);
        if (S.contract === "flashstack-sbtc-core-v2") call(S.contract, "deposit-reserve", [Cl.uint(1000)], deployer);
        if (S.contract === "flashstack-stx-core-v2") call(S.contract, "deposit-reserve", [Cl.uint(1000)], deployer);
        if (S.contract === "flashstack-pool-v3")
          for (const t of ["sbtc-token", "mock-usdcx"])
            expectRes(call(S.contract, "add-asset", [Cl.contractPrincipal(deployer, t), Cl.uint(5), Cl.uint(1_000_000)], deployer), true, "setup add-asset");

        let admin = 0;
        let pending: number | null = null;
        acts.forEach((a, n) => {
          const who = ppl[a.caller];
          const step = `#${n} ${json(a)} model admin=${admin} pending=${pending}`;
          log.push(step);
          if (a.op === "propose") {
            const r = call(S.contract, S.propose, [Cl.principal(ppl[a.target])], who);
            expectRes(r, a.caller === admin ? true : S.NOT_ADMIN, "A2 propose iff admin", step);
            if (r.ok) pending = a.target;
            cov.hit(`propose:${r.ok}`);
          } else if (a.op === "accept") {
            const r = call(S.contract, "accept-admin", [], who);
            expectRes(r, pending !== null && a.caller === pending ? true : S.NOT_PENDING, "A3 accept iff pending", step);
            if (r.ok) {
              cov.hit(admin !== pending ? "accept:handover" : "accept:self");
              admin = pending!;
              pending = null;
            }
          } else {
            const fns = S.adminFns(who, deployer);
            const [fn, args] = fns[a.fn % fns.length];
            const r = call(S.contract, fn, args, who);
            if (a.caller === admin) inv(r.ok || r.code !== S.NOT_ADMIN, "A1 admin is never refused as non-admin", { step, fn, r });
            else expectRes(r, S.NOT_ADMIN, `A1 non-admin ${fn} refused`, step);
            if (a.caller !== admin && a.caller === pending) cov.hit("fn:pending-refused");
            if (a.caller !== admin && a.caller === 0) cov.hit("fn:old-admin-refused");
            cov.hit(`fn:${a.caller === admin ? "admin" : "other"}`);
          }
          inv(dataVar(S.contract, "admin") === ppl[admin], "A4 on-chain admin == model", { step, chain: dataVar(S.contract, "admin") });
          const chainPending = dataVar(S.contract, "pending-admin");
          inv(chainPending === (pending === null ? null : ppl[pending]), "A4 on-chain pending == model", { step, chainPending });
        });
      }, 10);
      cov.require(`${S.contract} admin`, ["accept:handover", "fn:pending-refused", "fn:old-admin-refused", "fn:admin", "fn:other", "propose:false"]);
    });
  }
});
