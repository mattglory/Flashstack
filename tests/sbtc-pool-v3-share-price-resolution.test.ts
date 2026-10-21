import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * Flashstack-ajv.3.4: flashstack-sbtc-pool-v3 (undeployed) carried the same
 * get-share-price expression as sbtc-pool-v2 (F-11, pinned for v2 in
 * sbtc-pool-v2-share-price-resolution.test.ts): deposit mints 1e8 shares per
 * sat, but the price was scaled by only 1e8, so it read 1 at launch and
 * ignored any gain short of +100%.
 *
 * v3 now scales the price by PRICE-PRECISION (1e16): launch reads 1e8 (the
 * value the header documents) and a 1-sat fee on a 44,990-sat pool moves it.
 * get-collateral-snapshot.share-price is the same expression and moves with it.
 * Only the read-only output changed: the deposit and withdraw amounts below
 * are the same as v2's.
 *
 * Mutation check: putting SHARE-PRECISION back into either price expression
 * turns these tests red.
 */

const POOL = "flashstack-sbtc-pool-v3";
const SBTC = "sbtc-token";
const LP_DEP = 44_990; // same deposit as the v2 test, so the numbers compare directly
const LP_SHARES = 4_499_000_000_000n; // 1e8 shares per sat, same as v2

describe("flashstack-sbtc-pool-v3: get-share-price resolution (F-11 rescale, ajv.3.4)", () => {
  let deployer: string;
  let lp: string;
  let donor: string;

  const mint = (amount: number, to: string) =>
    expect(simnet.callPublicFn(SBTC, "mint", [Cl.uint(amount), Cl.principal(to)], deployer).result).toBeOk(Cl.bool(true));
  const price = () =>
    BigInt((simnet.callReadOnlyFn(POOL, "get-share-price", [], deployer).result as any).value.value);
  const snapshotPrice = () =>
    BigInt((simnet.callReadOnlyFn(POOL, "get-collateral-snapshot", [], deployer).result as any).value.value["share-price"].value);
  const lpValue = (who: string) =>
    Number((simnet.callReadOnlyFn(POOL, "get-lp-value", [Cl.principal(who)], deployer).result as any).value.value);
  const donate = (amount: number) => {
    mint(amount, donor);
    expect(
      simnet.callPublicFn(SBTC, "transfer", [Cl.uint(amount), Cl.principal(donor), Cl.principal(`${deployer}.${POOL}`), Cl.none()], donor).result,
    ).toBeOk(Cl.bool(true));
  };
  // (balance + 1) * 1e16 / (shares + 1e8), the contract's formula
  const expected = (balance: number, shares: bigint) => ((BigInt(balance) + 1n) * 10n ** 16n) / (shares + 10n ** 8n);

  beforeEach(() => {
    const a = simnet.getAccounts();
    deployer = a.get("deployer")!;
    lp = a.get("wallet_1")!;
    donor = a.get("wallet_2")!;
  });

  it("reads 1e8 at launch, as the header documents", () => {
    expect(price()).toBe(100_000_000n);
    expect(snapshotPrice()).toBe(100_000_000n);
  });

  it("moves with a 1-sat gain on a 44,990-sat pool, where v2's expression stays at 1", () => {
    mint(LP_DEP, lp);
    expect(simnet.callPublicFn(POOL, "deposit", [Cl.uint(LP_DEP)], lp).result).toBeOk(Cl.uint(LP_SHARES));
    const p0 = price();
    expect(p0).toBe(expected(LP_DEP, LP_SHARES));
    expect(p0).toBe(100_000_000n);

    donate(1); // a single-sat fee
    const p1 = price();
    expect(p1).toBe(expected(LP_DEP + 1, LP_SHARES));
    expect(p1).toBeGreaterThan(p0);
    expect(snapshotPrice()).toBe(p1);

    donate(LP_DEP); // ~+100%: v2 only now steps 1 -> 2; v3 reads ~2e8
    expect(price()).toBe(expected(2 * LP_DEP + 1, LP_SHARES));
    expect(lpValue(lp)).toBe(89_980);
  });

  it("deposit and withdraw amounts are unchanged by the rescale", () => {
    mint(LP_DEP, lp);
    expect(simnet.callPublicFn(POOL, "deposit", [Cl.uint(LP_DEP)], lp).result).toBeOk(Cl.uint(LP_SHARES));
    expect(simnet.callPublicFn(POOL, "withdraw", [Cl.uint(LP_SHARES)], lp).result).toBeOk(Cl.uint(LP_DEP));
  });
});
