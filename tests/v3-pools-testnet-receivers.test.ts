import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { Cl } from "@stacks/transactions";

/**
 * The four testnet receivers for the section 6e stage of flashstack-stx-pool-v3 /
 * flashstack-sbtc-pool-v3 (docs/TESTNET_STAGING.md, Flashstack-ajv.6.9).
 *
 * Each canonical contracts/*.clar file is deployed at runtime with
 * simnet.deployContract, not registered in Clarinet.toml, so none of them is
 * ever in the plan `clarinet deployments apply --mainnet` computes
 * (tests/mainnet-plan-guard.test.ts). The only rewrite is the sBTC principal,
 * pointed at the simnet mock; everything else is the exact file the testnet
 * script publishes.
 *
 * Pinned, for both pools:
 *   honest receiver      repays exactly amount + fee; refuses an unarmed loan, a
 *                        loan for a different amount, a stranger's loan (even
 *                        while armed), and a direct callback call
 *   adversarial receiver deposit-reentry and withdraw-reentry fail with the
 *                        pool's ERR-REENTRANT, under-repay with ERR-REPAY-FAILED,
 *                        each changing nothing; then an honest loan, exit and
 *                        rescue all succeed (the lock is released)
 *   both                 every state-changing function is owner-only
 * These are the on-chain expectations of deployments/testnet-v3-pools-plan.yaml
 * (A5-A27 / B5-B27), checked here first.
 */

const SBTC_MAINNET = "'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

const POOLS = [
  {
    asset: "stx", pool: "flashstack-stx-pool-v3",
    honest: "stx-pool-v3-test-receiver", adv: "stx-pool-v3-adversarial-receiver",
    rescue: "rescue-stx", errReentrant: 411, errRepay: 402,
    // deployments/testnet-v3-pools-plan.yaml line A amounts (microSTX)
    deposit: 50_000_000, seed: 1_000_000, loan: 10_000_000, fee: 5_000, advFund: 6_000_000, advSeed: 5_000_000,
  },
  {
    asset: "sbtc", pool: "flashstack-sbtc-pool-v3",
    honest: "sbtc-pool-v3-test-receiver", adv: "sbtc-pool-v3-adversarial-receiver",
    rescue: "rescue-sbtc", errReentrant: 712, errRepay: 702,
    // line B amounts (sats)
    deposit: 5_000, seed: 100, loan: 2_000, fee: 1, advFund: 1_100, advSeed: 1_000,
  },
] as const;

const RX = { notOwner: 920, notPool: 921, notArmed: 922, badMode: 926 } as const;
const MODE = { honest: 0, deposit: 1, withdraw: 2, underRepay: 3 } as const;

function receiverSource(name: string): string {
  const src = readFileSync(`contracts/${name}.clar`, "utf-8");
  return src.replaceAll(SBTC_MAINNET, ".sbtc-token");
}

for (const P of POOLS) {
  describe(`section 6e receivers: ${P.pool}`, () => {
    let deployer: string, stranger: string;
    let honest: string, adv: string;

    const balance = (who: string): number =>
      P.asset === "stx"
        ? Number(simnet.getAssetsMap().get("STX")?.get(who) ?? 0n)
        : Number((simnet.callReadOnlyFn("sbtc-token", "get-balance", [Cl.principal(who)], deployer).result as any).value.value);
    const fund = (amount: number, to: string) =>
      P.asset === "sbtc"
        ? simnet.callPublicFn("sbtc-token", "mint", [Cl.uint(amount), Cl.principal(to)], deployer)
        : simnet.transferSTX(amount, to, deployer);
    const flashLoan = (rx: string, sender = deployer, amount: number = P.loan) =>
      simnet.callPublicFn(P.pool, "flash-loan", [Cl.uint(amount), Cl.principal(rx)], sender).result;
    const shares = (who: string) =>
      Number((simnet.callReadOnlyFn(P.pool, "get-shares", [Cl.principal(who)], deployer).result as any).value);
    const armed = (rx: string) => simnet.callReadOnlyFn(rx, "get-armed", [], deployer).result;
    const poolPrincipal = () => `${deployer}.${P.pool}`;
    // Everything a blocked attempt could corrupt.
    const snapshot = () => ({
      stats: simnet.callReadOnlyFn(P.pool, "get-stats", [], deployer).result,
      pool: balance(poolPrincipal()),
      adv: balance(adv),
      advShares: shares(adv),
      lpShares: shares(deployer),
    });

    beforeEach(() => {
      deployer = simnet.getAccounts().get("deployer")!;
      stranger = simnet.getAccounts().get("wallet_1")!;
      for (const name of [P.honest, P.adv]) {
        expect(simnet.deployContract(name, receiverSource(name), { clarityVersion: 3 }, deployer).result).toBeBool(true);
      }
      honest = `${deployer}.${P.honest}`;
      adv = `${deployer}.${P.adv}`;

      if (P.asset === "sbtc") fund(P.deposit, deployer);
      expect(simnet.callPublicFn(P.pool, "deposit", [Cl.uint(P.deposit)], deployer).result.type).toBe("ok");
      for (const rx of [honest, adv]) {
        expect(simnet.callPublicFn(P.pool, "add-approved-receiver", [Cl.principal(rx)], deployer).result).toBeOk(Cl.bool(true));
      }
      fund(P.seed, honest);
      fund(P.advFund, adv);
    });

    describe("honest receiver", () => {
      it("an armed loan repays exactly amount + fee, and the arm is single-use", () => {
        const poolBefore = balance(poolPrincipal());
        const rxBefore = balance(honest);
        expect(simnet.callPublicFn(P.honest, "arm", [Cl.uint(P.loan)], deployer).result).toBeOk(Cl.bool(true));
        expect(flashLoan(honest)).toBeOk(Cl.bool(true));
        expect(balance(poolPrincipal())).toBe(poolBefore + P.fee);
        expect(balance(honest)).toBe(rxBefore - P.fee);
        expect(armed(P.honest)).toBeOk(Cl.none());

        const stats = (simnet.callReadOnlyFn(P.pool, "get-stats", [], deployer).result as any).value.value;
        expect(stats["total-loans"]).toBeUint(1);
        expect(stats["total-volume"]).toBeUint(P.loan);
        expect(stats["total-fees"]).toBeUint(P.fee);

        // the same loan again, without re-arming, is refused
        expect(flashLoan(honest)).toBeErr(Cl.uint(RX.notArmed));
      });

      it("refuses an unarmed loan and a loan for a different amount than armed", () => {
        expect(flashLoan(honest)).toBeErr(Cl.uint(RX.notArmed));
        simnet.callPublicFn(P.honest, "arm", [Cl.uint(P.loan)], deployer);
        expect(flashLoan(honest, deployer, P.loan - 1)).toBeErr(Cl.uint(RX.notArmed));
      });

      it("refuses a stranger's loan even while armed (no front-running the arm), and the arm survives", () => {
        simnet.callPublicFn(P.honest, "arm", [Cl.uint(P.loan)], deployer);
        const before = balance(honest);
        expect(flashLoan(honest, stranger)).toBeErr(Cl.uint(RX.notOwner));
        expect(balance(honest)).toBe(before);
        expect(armed(P.honest)).toBeOk(Cl.some(Cl.uint(P.loan)));
      });

      it("refuses a direct callback call from anyone but the pool (B4)", () => {
        const fn = P.asset === "stx" ? "execute-stx-flash" : "execute-sbtc-flash";
        for (const sender of [deployer, stranger]) {
          expect(
            simnet.callPublicFn(P.honest, fn, [Cl.uint(P.loan), Cl.principal(poolPrincipal())], sender).result,
          ).toBeErr(Cl.uint(RX.notPool));
        }
      });

      it("arm, disarm and rescue are owner-only; rescue pays the owner", () => {
        expect(simnet.callPublicFn(P.honest, "arm", [Cl.uint(P.loan)], stranger).result).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.honest, "disarm", [], stranger).result).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.honest, P.rescue, [Cl.uint(1)], stranger).result).toBeErr(Cl.uint(RX.notOwner));

        simnet.callPublicFn(P.honest, "arm", [Cl.uint(P.loan)], deployer);
        expect(simnet.callPublicFn(P.honest, "disarm", [], deployer).result).toBeOk(Cl.bool(true));
        expect(armed(P.honest)).toBeOk(Cl.none());

        const ownerBefore = balance(deployer);
        expect(simnet.callPublicFn(P.honest, P.rescue, [Cl.uint(P.seed)], deployer).result).toBeOk(Cl.bool(true));
        expect(balance(honest)).toBe(0);
        expect(balance(deployer)).toBe(ownerBefore + P.seed);
      });
    });

    describe("adversarial receiver (the plan's A16-A27 / B16-B27 sequence)", () => {
      const arm = (mode: number, sender = deployer) =>
        simnet.callPublicFn(P.adv, "arm", [Cl.uint(mode), Cl.uint(P.loan)], sender).result;

      it("deposit-reentry, withdraw-reentry and under-repay all fail and change nothing; then the lock is free", () => {
        const seeded = simnet.callPublicFn(P.adv, "seed-deposit", [Cl.uint(P.advSeed)], deployer).result as any;
        expect(seeded.type).toBe("ok");
        expect(shares(adv)).toBe(Number(seeded.value.value));
        expect(shares(adv)).toBeGreaterThan(0);

        for (const [mode, code] of [
          [MODE.deposit, P.errReentrant],
          [MODE.withdraw, P.errReentrant],
          [MODE.underRepay, P.errRepay],
        ] as const) {
          expect(arm(mode)).toBeOk(Cl.bool(true));
          const before = snapshot();
          expect(flashLoan(adv), `mode u${mode}`).toBeErr(Cl.uint(code));
          expect(snapshot(), `mode u${mode} changed state`).toEqual(before);
        }

        // lock released: an honest loan through the same receiver succeeds
        expect(arm(MODE.honest)).toBeOk(Cl.bool(true));
        const poolBefore = balance(poolPrincipal());
        expect(flashLoan(adv)).toBeOk(Cl.bool(true));
        expect(balance(poolPrincipal())).toBe(poolBefore + P.fee);

        // exit withdraws the seeded shares outside a loan
        expect((simnet.callPublicFn(P.adv, "exit", [], deployer).result as any).type).toBe("ok");
        expect(shares(adv)).toBe(0);

        // rescue to zero
        const left = balance(adv);
        expect(left).toBeGreaterThan(0);
        expect(simnet.callPublicFn(P.adv, P.rescue, [Cl.uint(left)], deployer).result).toBeOk(Cl.bool(true));
        expect(balance(adv)).toBe(0);
      });

      it("a stranger can't arm, seed, exit, rescue, or trigger an armed mode", () => {
        expect(arm(MODE.deposit, stranger)).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.adv, "seed-deposit", [Cl.uint(P.advSeed)], stranger).result).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.adv, "exit", [], stranger).result).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.adv, P.rescue, [Cl.uint(1)], stranger).result).toBeErr(Cl.uint(RX.notOwner));
        expect(simnet.callPublicFn(P.adv, "disarm", [], stranger).result).toBeErr(Cl.uint(RX.notOwner));

        arm(MODE.deposit);
        const before = snapshot();
        expect(flashLoan(adv, stranger)).toBeErr(Cl.uint(RX.notOwner));
        expect(snapshot()).toEqual(before);
      });

      it("refuses an unarmed loan, a wrong amount, an unknown mode, and a direct callback call", () => {
        expect(flashLoan(adv)).toBeErr(Cl.uint(RX.notArmed));
        arm(MODE.honest);
        expect(flashLoan(adv, deployer, P.loan - 1)).toBeErr(Cl.uint(RX.notArmed));
        expect(simnet.callPublicFn(P.adv, "arm", [Cl.uint(4), Cl.uint(P.loan)], deployer).result).toBeErr(Cl.uint(RX.badMode));

        const fn = P.asset === "stx" ? "execute-stx-flash" : "execute-sbtc-flash";
        expect(
          simnet.callPublicFn(P.adv, fn, [Cl.uint(P.loan), Cl.principal(poolPrincipal())], deployer).result,
        ).toBeErr(Cl.uint(RX.notPool));
      });
    });
  });
}

describe("section 6e receivers: what the script publishes is what this suite compiles", () => {
  it("the only simnet rewrite is the sBTC principal, and the STX receivers need none", () => {
    for (const name of ["stx-pool-v3-test-receiver", "stx-pool-v3-adversarial-receiver"]) {
      expect(readFileSync(`contracts/${name}.clar`, "utf-8")).not.toMatch(/'S[PM][0-9A-Z]+\./);
    }
    for (const name of ["sbtc-pool-v3-test-receiver", "sbtc-pool-v3-adversarial-receiver"]) {
      const other = readFileSync(`contracts/${name}.clar`, "utf-8").replaceAll(SBTC_MAINNET, "");
      expect(other).not.toMatch(/'S[PM][0-9A-Z]+\./);
    }
  });
});
