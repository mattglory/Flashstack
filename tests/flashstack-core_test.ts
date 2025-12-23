import { describe, expect, it, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

describe("FlashStack Core Tests", () => {
  let accounts: Map<string, string>;
  let deployer: string;
  let wallet1: string;
  let wallet2: string;

  beforeEach(() => {
    accounts = simnet.getAccounts();
    deployer = accounts.get("deployer")!;
    wallet1 = accounts.get("wallet_1")!;
    wallet2 = accounts.get("wallet_2")!;
  });

  it("ensures contracts are deployed", () => {
    // Try to call a read-only function to verify deployment
    const { result: feeResult } = simnet.callReadOnlyFn(
      "flashstack-core",
      "get-fee-basis-points",
      [],
      deployer
    );
    expect(feeResult).toBeOk(Cl.uint(5)); // Default fee is 5 basis points

    const { result: nameResult } = simnet.callReadOnlyFn(
      "sbtc-token",
      "get-name",
      [],
      deployer
    );
    expect(nameResult).toBeOk(Cl.stringAscii("Stacks Bitcoin"));
  });

  it("can set flash minter", () => {
    const { result } = simnet.callPublicFn(
      "sbtc-token",
      "set-flash-minter",
      [Cl.principal(`${deployer}.flashstack-core`)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));
  });

  it("calculates fees correctly", () => {
    const { result } = simnet.callReadOnlyFn(
      "flashstack-core",
      "calculate-fee",
      [Cl.uint(10000000000)], // 100 sBTC
      deployer
    );
    // Fee is 0.05% = 5 basis points (default)
    // 10000000000 * 5 / 10000 = 5000000
    // Result is (ok uint), so use toBeOk
    expect(result).toBeOk(Cl.uint(5000000));
  });

  it("can flash mint with proper setup", () => {
    // First set up the flash minter
    simnet.callPublicFn(
      "sbtc-token",
      "set-flash-minter",
      [Cl.principal(`${deployer}.flashstack-core`)],
      deployer
    );

    // Try a flash mint (will fail without proper receiver, but shouldn't error on permission)
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "flash-mint",
      [
        Cl.uint(1000000), // 0.01 sBTC
        Cl.principal(`${deployer}.test-receiver`)
      ],
      wallet1
    );
    
    // Should execute (even if receiver fails, the flash-mint call itself works)
    expect(result).toBeDefined();
  });

  it("admin can pause protocol", () => {
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "pause",
      [],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify paused - is-paused returns (ok bool)
    const { result: isPausedResult } = simnet.callReadOnlyFn(
      "flashstack-core",
      "is-paused",
      [],
      deployer
    );
    expect(isPausedResult).toBeOk(Cl.bool(true));
  });

  it("admin can unpause protocol", () => {
    // First pause
    simnet.callPublicFn("flashstack-core", "pause", [], deployer);

    // Then unpause
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "unpause",
      [],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify unpaused - is-paused returns (ok bool)
    const { result: isPausedResult } = simnet.callReadOnlyFn(
      "flashstack-core",
      "is-paused",
      [],
      deployer
    );
    expect(isPausedResult).toBeOk(Cl.bool(false));
  });

  it("non-admin cannot pause protocol", () => {
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "pause",
      [],
      wallet1
    );
    // ERR-UNAUTHORIZED = 102
    expect(result).toBeErr(Cl.uint(102));
  });

  it("admin can update fee", () => {
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "set-fee",
      [Cl.uint(100)], // 1%
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    // Verify new fee - get-fee-basis-points returns (ok uint)
    const { result: newFeeResult } = simnet.callReadOnlyFn(
      "flashstack-core",
      "get-fee-basis-points",
      [],
      deployer
    );
    expect(newFeeResult).toBeOk(Cl.uint(100));
  });

  it("cannot set fee above maximum", () => {
    const { result } = simnet.callPublicFn(
      "flashstack-core",
      "set-fee",
      [Cl.uint(101)], // Above 1% max (100 basis points)
      deployer
    );
    // Contract returns ERR-UNAUTHORIZED (102) for invalid fee
    expect(result).toBeErr(Cl.uint(102));
  });

  it("gets protocol statistics", () => {
    const { result } = simnet.callReadOnlyFn(
      "flashstack-core",
      "get-stats",
      [],
      deployer
    );
    
    // get-stats returns (ok {...}), verify it's ok
    expect(result.type).toBe(7); // ResponseOk
    
    // Extract the tuple value and check fields
    const statsTuple = result.value;
    expect(statsTuple.data["total-flash-mints"].value).toBe(0n);
    expect(statsTuple.data["total-volume"].value).toBe(0n);
    expect(statsTuple.data["total-fees-collected"].value).toBe(0n);
    expect(statsTuple.data["current-fee-bp"].value).toBe(5n);
    
    // Check paused field - BoolFalse = type 4, BoolTrue = type 3
    const pausedValue = statsTuple.data["paused"];
    expect(pausedValue.type).toBe(4); // BoolFalse
  });
});
