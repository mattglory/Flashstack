import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * F-9 regression for the undeployed v3 successors (Flashstack-ajv.4.9).
 *
 * The live v2 pools let a flash-loan receiver "repay" by calling the pool's own
 * deposit mid-callback, minting shares at the loan-depressed price (proven in
 * stx-/sbtc-pool-v2-deposit-reentrancy.test.ts). flashstack-stx-pool-v3 and
 * flashstack-sbtc-pool-v3 shipped without a fix (PR #84). They now carry the
 * pool-v3 pv3-F1 lock: one bool shared by deposit, withdraw and flash-loan
 * (withdraw included per Matt's Option B decision, 2026-10-05).
 *
 * Pinned, for both pools separately (STX uses stx-transfer?, sBTC a SIP-010
 * transfer -- do not assume one proves the other):
 *   - the happy paths still work            (the lock must not over-block)
 *   - flash-loan -> deposit is rejected     (the F-9 vector itself)
 *   - flash-loan -> withdraw is rejected    (Option B)
 *   - flash-loan -> flash-loan aborts       (the Clarity VM itself rejects the
 *                                            nested call, before the lock is reached)
 *   - a rejected attempt mutates nothing    (not just "returned err")
 *   - the lock never stays set              (after success, a blocked reentry,
 *                                            or an under-repay revert)
 */

const POOLS = [
  { asset: "stx", pool: "flashstack-stx-pool-v3", rx: "test-stx-pool-v3-receiver-reentrant", nestedRx: "test-pool-receiver-good", errReentrant: 411, errRepay: 402 },
  { asset: "sbtc", pool: "flashstack-sbtc-pool-v3", rx: "test-sbtc-pool-v3-receiver-reentrant", nestedRx: "test-sbtc-pool-receiver-good", errReentrant: 712, errRepay: 702 },
] as const;

const MODE = { honest: 0, deposit: 1, withdraw: 2, underRepay: 3, nestedLoan: 4 } as const;

const LP_DEP = 10_000_000; // the honest LP's deposit
const LOAN = 9_900_000; // 99% of the reserve, under both pools' max-single-loan
const FEE = 4_950; // 0.05% of LOAN
const RX_FUND = 2_000_000; // receiver's own capital: covers the fee and a seed deposit
const RX_SEED = 1_000_000; // shares the receiver holds before the withdraw-reentry attempt

for (const { asset, pool, rx, nestedRx, errReentrant, errRepay } of POOLS) {
  describe(`F-9: ${pool} reentrancy lock`, () => {
    let deployer: string, attacker: string, lp: string, rxPrincipal: string;

    const fund = (amount: number, to: string) =>
      asset === "sbtc"
        ? simnet.callPublicFn("sbtc-token", "mint", [Cl.uint(amount), Cl.principal(to)], deployer)
        : simnet.transferSTX(amount, to, deployer);
    const setMode = (m: number) => simnet.callPublicFn(rx, "set-mode", [Cl.uint(m)], deployer);
    const flashLoan = () =>
      simnet.callPublicFn(pool, "flash-loan", [Cl.uint(LOAN), Cl.contractPrincipal(deployer, rx)], attacker).result;
    const shares = (who: string) =>
      Number((simnet.callReadOnlyFn(pool, "get-shares", [Cl.principal(who)], deployer).result as any).value);
    // Everything an attempt could corrupt: pool balance, total-shares, loan/fee
    // stats, and both share holders' positions.
    const snapshot = () => ({
      stats: simnet.callReadOnlyFn(pool, "get-stats", [], deployer).result,
      lp: shares(lp),
      rx: shares(rxPrincipal),
    });

    beforeEach(() => {
      deployer = simnet.getAccounts().get("deployer")!;
      attacker = simnet.getAccounts().get("wallet_1")!;
      lp = simnet.getAccounts().get("wallet_2")!;
      rxPrincipal = `${deployer}.${rx}`;

      if (asset === "sbtc") fund(LP_DEP, lp);
      // First deposit in a fresh simnet: also proves the lock starts unset.
      expect(simnet.callPublicFn(pool, "deposit", [Cl.uint(LP_DEP)], lp).result.type).toBe("ok");
      simnet.callPublicFn(pool, "add-approved-receiver", [Cl.principal(rxPrincipal)], deployer);
      fund(RX_FUND, rxPrincipal);
    });

    it("happy path: honest flash-loan, deposit and withdraw all still succeed in sequence", () => {
      setMode(MODE.honest);
      expect(flashLoan()).toBeOk(Cl.bool(true));
      if (asset === "sbtc") fund(LP_DEP, lp);
      const minted = simnet.callPublicFn(pool, "deposit", [Cl.uint(LP_DEP)], lp).result as any;
      expect(minted.type).toBe("ok");
      expect(simnet.callPublicFn(pool, "withdraw", [minted.value], lp).result.type).toBe("ok");
      expect(flashLoan()).toBeOk(Cl.bool(true));

      const stats = (simnet.callReadOnlyFn(pool, "get-stats", [], deployer).result as any).value.value;
      expect(stats["total-loans"]).toBeUint(2);
      expect(stats["total-fees"]).toBeUint(2 * FEE);
    });

    it("flash-loan -> callback -> deposit (the F-9 vector) is rejected with ERR-REENTRANT", () => {
      setMode(MODE.deposit);
      expect(flashLoan()).toBeErr(Cl.uint(errReentrant));
    });

    it("the rejected deposit-reentry mutates nothing: no shares minted, no stats, no balance change", () => {
      const before = snapshot();
      setMode(MODE.deposit);
      flashLoan();
      expect(snapshot()).toEqual(before);
      expect(shares(rxPrincipal)).toBe(0);
    });

    it("flash-loan -> callback -> withdraw (Option B) is rejected, receiver's existing shares untouched", () => {
      expect(simnet.callPublicFn(rx, "seed-deposit", [Cl.uint(RX_SEED)], deployer).result.type).toBe("ok");
      const before = snapshot();
      expect(before.rx).toBeGreaterThan(0);

      setMode(MODE.withdraw);
      expect(flashLoan()).toBeErr(Cl.uint(errReentrant));
      expect(snapshot()).toEqual(before);
    });

    it("flash-loan -> callback -> flash-loan (nested, same pool) aborts in the VM, not via the lock", () => {
      // The nested loan goes through an honest, approved, funded receiver. It
      // never reaches the lock: Clarity refuses to re-enter a function that is
      // already on the call stack (RuntimeCheck CircularReference), so the
      // whole transaction aborts. Same result with or without the F-9 lock --
      // pinned here so the claim that this path is unreachable stays checked.
      const nested = `${deployer}.${nestedRx}`;
      simnet.callPublicFn(pool, "add-approved-receiver", [Cl.principal(nested)], deployer);
      fund(10_000, nested);
      const before = snapshot();

      setMode(MODE.nestedLoan);
      expect(() => flashLoan()).toThrow(/CircularReference/);
      expect(snapshot()).toEqual(before);
    });

    it("lock is released after a blocked reentry: an honest flash-loan succeeds right after", () => {
      setMode(MODE.deposit);
      expect(flashLoan()).toBeErr(Cl.uint(errReentrant));
      setMode(MODE.honest);
      expect(flashLoan()).toBeOk(Cl.bool(true));
    });

    it("lock is released after an under-repay revert (fails after the callback returns ok)", () => {
      const before = snapshot();
      setMode(MODE.underRepay);
      expect(flashLoan()).toBeErr(Cl.uint(errRepay));
      expect(snapshot()).toEqual(before);

      // Every entry point that takes the lock still works afterward.
      expect(simnet.callPublicFn(pool, "withdraw", [Cl.uint(Math.floor(shares(lp) / 2))], lp).result.type).toBe("ok");
      if (asset === "sbtc") fund(LP_DEP, lp);
      expect(simnet.callPublicFn(pool, "deposit", [Cl.uint(LP_DEP)], lp).result.type).toBe("ok");
      setMode(MODE.honest);
      expect(flashLoan()).toBeOk(Cl.bool(true));
    });
  });
}
