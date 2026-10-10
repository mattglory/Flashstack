import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

/**
 * Security regression for zest-v2-liquidation-receiver's v0-8 migration.
 *
 * v0-4-market is dead (confirmed directly: v0-market-vault.get-impl()
 * returns v0-8-market exclusively on all 7 of Zest's per-asset vaults, and
 * v0-4-market's own most recent transactions all abort for exactly that
 * reason). v0-8 requires a real signed Pyth Lazer price update on every
 * liquidate() call -- proved that end-to-end against Zest's actual deployed
 * decoder before wiring it in here (see the contract's own header).
 *
 * Same structural limitation as bitflow-arb-receiver-v5's test suite:
 * FLASH-CORE is hardcoded to the real mainnet address, and contract-caller
 * is unforgeable, so "called via the real core, price-feed guard fires"
 * is untestable in local simnet -- no contract deployed under any other
 * principal, including this project's own local copy of
 * flashstack-stx-core, can ever produce a matching contract-caller. What
 * IS directly testable is that a direct call -- from anyone, including
 * this project's own local core -- is rejected before it ever reaches the
 * price-feed check.
 *
 * Error codes: 900 NOT-OWNER · 901 REPAY-FAILED · 902 LIQUIDATION
 * 903 INSUFFICIENT · 904 ZERO-AMOUNT · 905 BAD-MODE · 906 SWAP-FAILED
 * 907 NOT-CORE · 908 SWEEP-FAILED · 909 NOT-PENDING · 910 NO-PRICE-FEED
 */

const CORE = "flashstack-stx-core";
const RX = "zest-v2-liquidation-receiver";

const RESERVE = 1_000_000_000; // 1,000 STX seeded
const LOAN = 100_000_000; //   100 STX

describe("zest-v2-liquidation-receiver (v0-8 migration)", () => {
  let deployer: string;
  let wallet1: string;
  let wallet2: string;

  beforeEach(() => {
    deployer = simnet.getAccounts().get("deployer")!;
    wallet1 = simnet.getAccounts().get("wallet_1")!;
    wallet2 = simnet.getAccounts().get("wallet_2")!;
    simnet.callPublicFn(CORE, "deposit-reserve", [Cl.uint(RESERVE)], deployer);
    simnet.callPublicFn(CORE, "add-approved-receiver", [Cl.contractPrincipal(deployer, RX)], deployer);
  });

  // --- The caller gate ------------------------------------------------------

  it("rejects execute-stx-flash called directly, not through the real core", () => {
    // `core` passed as the real FLASH-CORE literal isolates the
    // contract-caller check itself -- see bitflow-arb-receiver-v5's test
    // for why this matters (there's no second defense-in-depth assert on
    // `core` here, but matching the real core's own argument shape keeps
    // the test honest about what it's exercising).
    const result = simnet.callPublicFn(
      RX,
      "execute-stx-flash",
      [Cl.uint(LOAN), Cl.contractPrincipal("SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5", "flashstack-stx-core")],
      wallet1,
    ).result;
    expect(result).toBeErr(Cl.uint(907)); // ERR-NOT-CORE
  });

  it("rejects execute-stx-flash even when called through this project's own local flashstack-stx-core copy", () => {
    simnet.callPublicFn(RX, "set-target", [Cl.principal(wallet2), Cl.uint(1_000_000), Cl.uint(2)], deployer);
    const result = simnet.callPublicFn(CORE, "flash-loan", [Cl.uint(LOAN), Cl.contractPrincipal(deployer, RX)], wallet1).result;
    expect(result).toBeErr(Cl.uint(907));
  });

  // --- set-target / set-price-feed / set-slippage ----------------------------

  it("set-target validates mode range and rejects a zero debt", () => {
    expect(simnet.callPublicFn(RX, "set-target", [Cl.principal(wallet2), Cl.uint(0), Cl.uint(1)], deployer).result).toBeErr(Cl.uint(904));
    expect(simnet.callPublicFn(RX, "set-target", [Cl.principal(wallet2), Cl.uint(1_000_000), Cl.uint(4)], deployer).result).toBeErr(Cl.uint(905));
    expect(simnet.callPublicFn(RX, "set-target", [Cl.principal(wallet2), Cl.uint(1_000_000), Cl.uint(2)], deployer).result).toBeOk(Cl.bool(true));
  });

  it("set-price-feed is owner-gated and has-price-feed reflects state", () => {
    expect(simnet.callReadOnlyFn(RX, "has-price-feed", [], deployer).result).toBeBool(false);

    expect(simnet.callPublicFn(RX, "set-price-feed", [Cl.bufferFromHex("00")], wallet1).result).toBeErr(Cl.uint(900));

    expect(simnet.callPublicFn(RX, "set-price-feed", [Cl.bufferFromHex("00")], deployer).result).toBeOk(Cl.bool(true));
    expect(simnet.callReadOnlyFn(RX, "has-price-feed", [], deployer).result).toBeBool(true);
  });

  it("set-slippage enforces its bounds and ownership", () => {
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(200)], wallet1).result).toBeErr(Cl.uint(900));
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(10)], deployer).result).toBeErr(Cl.uint(905)); // below u50
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(1000)], deployer).result).toBeErr(Cl.uint(905)); // above u500
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(300)], deployer).result).toBeOk(Cl.bool(true));
  });

  // --- Ownership / sweeps ----------------------------------------------------

  it("sweeps and ownership functions reject non-owner callers", () => {
    expect(simnet.callPublicFn(RX, "sweep-stx", [Cl.uint(1)], wallet1).result).toBeErr(Cl.uint(900));
    expect(simnet.callPublicFn(RX, "sweep-sbtc", [Cl.uint(1)], wallet1).result).toBeErr(Cl.uint(900));
    expect(simnet.callPublicFn(RX, "propose-owner", [Cl.principal(wallet1)], wallet1).result).toBeErr(Cl.uint(900));
  });

  it("two-step ownership transfer: propose then accept, old owner loses access", () => {
    expect(simnet.callPublicFn(RX, "propose-owner", [Cl.principal(wallet1)], deployer).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(RX, "accept-ownership", [], wallet2).result).toBeErr(Cl.uint(909));
    expect(simnet.callPublicFn(RX, "accept-ownership", [], wallet1).result).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(300)], deployer).result).toBeErr(Cl.uint(900));
    expect(simnet.callPublicFn(RX, "set-slippage", [Cl.uint(300)], wallet1).result).toBeOk(Cl.bool(true));
  });

  it("get-target reflects live state", () => {
    simnet.callPublicFn(RX, "set-target", [Cl.principal(wallet2), Cl.uint(5_000_000), Cl.uint(3)], deployer);
    expect(simnet.callReadOnlyFn(RX, "get-target", [], deployer).result).toBeOk(
      Cl.tuple({ borrower: Cl.principal(wallet2), debt: Cl.uint(5_000_000), mode: Cl.uint(3) }),
    );
  });
});
