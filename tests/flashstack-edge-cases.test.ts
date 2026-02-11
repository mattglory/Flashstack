import { describe, expect, it, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

/**
 * FlashStack Edge Cases & Integration Tests
 *
 * Covers gaps not in the comprehensive test suite:
 * 1. Successful end-to-end flash mint execution
 * 2. Stats accumulation after successful mints
 * 3. Multiple sequential loans
 * 4. Admin transfer revokes old admin
 * 5. Block volume accumulation
 * 6. Boundary value calculations
 * 7. SNP receiver v3 read-only functions
 */

describe("FlashStack - Edge Cases & Integration", () => {
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

  describe("Successful Flash Mint Execution", () => {
    beforeEach(() => {
      // Setup: flash minter + whitelist + collateral
      simnet.callPublicFn(
        "sbtc-token",
        "set-flash-minter",
        [Cl.principal(`${deployer}.flashstack-core`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(30000000000)], // 300 STX
        deployer
      );
    });

    it("executes a flash mint successfully with test-receiver", () => {
      const amount = 1000000; // 0.01 sBTC

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(amount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );

      expect(result).toBeOk();
    });

    it("returns correct flash mint result data", () => {
      const amount = 100000000; // 1 sBTC
      const expectedFee = 50000; // 5bp of 1 sBTC

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(amount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );

      expect(result).toBeOk();

      const data = result.value.data;
      expect(data.amount.value).toBe(BigInt(amount));
      expect(data.fee.value).toBe(BigInt(expectedFee));
      expect(data["total-minted"].value).toBe(BigInt(amount + expectedFee));
      expect(data["flash-mint-id"].value).toBe(1n);
    });

    it("increments stats after successful flash mint", () => {
      const amount = 100000000; // 1 sBTC

      simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(amount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );

      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-stats",
        [],
        deployer
      );

      const stats = result.value.data;
      expect(stats["total-flash-mints"].value).toBe(1n);
      expect(stats["total-volume"].value).toBe(BigInt(amount));
      expect(stats["total-fees-collected"].value).toBe(50000n); // 5bp fee
    });

    it("maintains zero sBTC supply after flash mint (mint-burn cycle)", () => {
      const { result: supplyBefore } = simnet.callReadOnlyFn(
        "sbtc-token",
        "get-total-supply",
        [],
        deployer
      );

      simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(100000000), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );

      const { result: supplyAfter } = simnet.callReadOnlyFn(
        "sbtc-token",
        "get-total-supply",
        [],
        deployer
      );

      // Supply should be identical — minted tokens were burned
      expect(supplyAfter).toBeOk(supplyBefore.value);
    });
  });

  describe("Multiple Sequential Loans", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        "sbtc-token",
        "set-flash-minter",
        [Cl.principal(`${deployer}.flashstack-core`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(30000000000)],
        deployer
      );
    });

    it("accumulates stats across multiple flash mints", () => {
      const amounts = [100000000, 200000000, 50000000]; // 1, 2, 0.5 sBTC

      for (const amount of amounts) {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "flash-mint",
          [Cl.uint(amount), Cl.principal(`${deployer}.test-receiver`)],
          wallet1
        );
        expect(result).toBeOk();
      }

      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-stats",
        [],
        deployer
      );

      const stats = result.value.data;
      expect(stats["total-flash-mints"].value).toBe(3n);
      expect(stats["total-volume"].value).toBe(350000000n); // 3.5 sBTC total
    });

    it("assigns incremental flash-mint-ids", () => {
      for (let i = 0; i < 3; i++) {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "flash-mint",
          [Cl.uint(1000000), Cl.principal(`${deployer}.test-receiver`)],
          wallet1
        );
        expect(result).toBeOk();
        expect(result.value.data["flash-mint-id"].value).toBe(BigInt(i + 1));
      }
    });
  });

  describe("Admin Transfer Security", () => {
    it("old admin loses all privileges after transfer", () => {
      // Transfer admin to wallet1
      simnet.callPublicFn(
        "flashstack-core",
        "set-admin",
        [Cl.principal(wallet1)],
        deployer
      );

      // Old admin (deployer) should fail on all admin functions
      const { result: pauseResult } = simnet.callPublicFn(
        "flashstack-core",
        "pause",
        [],
        deployer
      );
      expect(pauseResult).toBeErr(Cl.uint(102));

      const { result: feeResult } = simnet.callPublicFn(
        "flashstack-core",
        "set-fee",
        [Cl.uint(10)],
        deployer
      );
      expect(feeResult).toBeErr(Cl.uint(102));

      const { result: whitelistResult } = simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );
      expect(whitelistResult).toBeErr(Cl.uint(102));
    });

    it("new admin can exercise all admin functions", () => {
      simnet.callPublicFn(
        "flashstack-core",
        "set-admin",
        [Cl.principal(wallet1)],
        deployer
      );

      // New admin should succeed
      const { result: pauseResult } = simnet.callPublicFn(
        "flashstack-core",
        "pause",
        [],
        wallet1
      );
      expect(pauseResult).toBeOk(Cl.bool(true));

      const { result: unpauseResult } = simnet.callPublicFn(
        "flashstack-core",
        "unpause",
        [],
        wallet1
      );
      expect(unpauseResult).toBeOk(Cl.bool(true));

      const { result: feeResult } = simnet.callPublicFn(
        "flashstack-core",
        "set-fee",
        [Cl.uint(50)],
        wallet1
      );
      expect(feeResult).toBeOk(Cl.bool(true));
    });
  });

  describe("Boundary Value Calculations", () => {
    it("fee for amount 1 is zero (rounds down)", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(1)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(0));
    });

    it("fee for amount 19999 is still zero (below rounding threshold)", () => {
      // 19999 * 5 / 10000 = 9.9995, truncates to 9
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(19999)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(9));
    });

    it("fee for amount 20000 is exactly 10", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(20000)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(10));
    });

    it("min collateral for zero loan is zero", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-min-collateral",
        [Cl.uint(0)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(0));
    });

    it("max flash amount for zero locked is zero", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-max-flash-amount",
        [Cl.uint(0)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(0));
    });

    it("collateral exactly at boundary allows loan", () => {
      simnet.callPublicFn(
        "sbtc-token",
        "set-flash-minter",
        [Cl.principal(`${deployer}.flashstack-core`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );

      // 300% ratio: 1 sBTC loan needs exactly 3 STX
      const loanAmount = 100000000; // 1 sBTC
      const exactCollateral = 300000000; // 3 STX

      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(exactCollateral)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(loanAmount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeOk();
    });

    it("collateral one unit below boundary rejects loan", () => {
      simnet.callPublicFn(
        "sbtc-token",
        "set-flash-minter",
        [Cl.principal(`${deployer}.flashstack-core`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );

      const loanAmount = 100000000; // 1 sBTC
      const belowCollateral = 299999999; // 1 unit below 3 STX

      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(belowCollateral)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(loanAmount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(100)); // ERR-NOT-ENOUGH-COLLATERAL
    });
  });

  describe("Block Volume Tracking", () => {
    beforeEach(() => {
      simnet.callPublicFn(
        "sbtc-token",
        "set-flash-minter",
        [Cl.principal(`${deployer}.flashstack-core`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "add-approved-receiver",
        [Cl.principal(`${deployer}.test-receiver`)],
        deployer
      );
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(100000000000)], // 1000 STX
        deployer
      );
    });

    it("loan at exactly the single loan limit succeeds", () => {
      const maxSingleLoan = 5000000000; // 5 sBTC

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(maxSingleLoan), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeOk();
    });

    it("loan one unit above single loan limit fails", () => {
      const aboveLimit = 5000000001; // 5 sBTC + 1

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(aboveLimit), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(107)); // ERR-LOAN-TOO-LARGE
    });
  });

  describe("sbtc-token Operations", () => {
    it("only flash minter can mint tokens", () => {
      const { result } = simnet.callPublicFn(
        "sbtc-token",
        "mint",
        [Cl.uint(1000000), Cl.principal(wallet1)],
        wallet1 // not the minter
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR-NOT-AUTHORIZED
    });

    it("contract owner can mint tokens", () => {
      const { result } = simnet.callPublicFn(
        "sbtc-token",
        "mint",
        [Cl.uint(1000000), Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("cannot mint zero tokens", () => {
      const { result } = simnet.callPublicFn(
        "sbtc-token",
        "mint",
        [Cl.uint(0), Cl.principal(wallet1)],
        deployer
      );
      expect(result).toBeErr(Cl.uint(402)); // ERR-INSUFFICIENT-BALANCE
    });

    it("transfer requires sender authorization", () => {
      // Mint tokens to wallet1 first
      simnet.callPublicFn(
        "sbtc-token",
        "mint",
        [Cl.uint(1000000), Cl.principal(wallet1)],
        deployer
      );

      // wallet2 trying to transfer wallet1's tokens should fail
      const { result } = simnet.callPublicFn(
        "sbtc-token",
        "transfer",
        [Cl.uint(500000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR-NOT-AUTHORIZED
    });

    it("owner can transfer their own tokens", () => {
      simnet.callPublicFn(
        "sbtc-token",
        "mint",
        [Cl.uint(1000000), Cl.principal(wallet1)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "sbtc-token",
        "transfer",
        [Cl.uint(500000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));

      // Verify balance
      const { result: balance } = simnet.callReadOnlyFn(
        "sbtc-token",
        "get-balance",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(balance).toBeOk(Cl.uint(500000));
    });
  });

  describe("SNP Receiver v3 Read-Only Functions", () => {
    it("calculate-leverage-benefit returns correct structure", () => {
      const { result } = simnet.callReadOnlyFn(
        "snp-flashstack-receiver-v3",
        "calculate-leverage-benefit",
        [
          Cl.uint(1000000000), // 10 STX user capital
          Cl.uint(3),          // 3x leverage
          Cl.uint(500),        // 5% vault APY
          Cl.uint(5),          // 5bp flash fee
        ],
        deployer
      );

      const data = result.data;
      expect(data["user-capital"].value).toBe(1000000000n);
      expect(data.leverage.value).toBe(3n);
      expect(data["total-capital"].value).toBe(3000000000n);
      expect(data["flash-loan-amount"].value).toBe(2000000000n);
      expect(data.profitable.type).toBe(3); // ClarityType.BoolTrue
    });

    it("reports zero apy-boost when user capital is zero", () => {
      const { result } = simnet.callReadOnlyFn(
        "snp-flashstack-receiver-v3",
        "calculate-leverage-benefit",
        [
          Cl.uint(0), // zero capital
          Cl.uint(3),
          Cl.uint(500),
          Cl.uint(5),
        ],
        deployer
      );

      const data = result.data;
      expect(data["apy-boost"].value).toBe(0n);
    });

    it("get-stats returns initial values", () => {
      const { result } = simnet.callReadOnlyFn(
        "snp-flashstack-receiver-v3",
        "get-stats",
        [],
        deployer
      );

      const data = result.data;
      expect(data["total-operations"].value).toBe(0n);
      expect(data["total-volume"].value).toBe(0n);
    });

    it("get-owner returns deployer", () => {
      const { result } = simnet.callReadOnlyFn(
        "snp-flashstack-receiver-v3",
        "get-owner",
        [],
        deployer
      );

      expect(result).toBeOk(Cl.principal(deployer));
    });
  });
});
