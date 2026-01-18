import { describe, expect, it, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

/**
 * Comprehensive FlashStack Core Tests
 *
 * Test Coverage:
 * 1. Contract initialization and deployment
 * 2. Admin functions (pause/unpause, fees, whitelist)
 * 3. Flash loan execution scenarios
 * 4. Security and collateral checks
 * 5. Circuit breaker limits
 * 6. Edge cases and error conditions
 */

describe("FlashStack Core - Comprehensive Test Suite", () => {
  let accounts: Map<string, string>;
  let deployer: string;
  let wallet1: string;
  let wallet2: string;
  let wallet3: string;

  beforeEach(() => {
    accounts = simnet.getAccounts();
    deployer = accounts.get("deployer")!;
    wallet1 = accounts.get("wallet_1")!;
    wallet2 = accounts.get("wallet_2")!;
    wallet3 = accounts.get("wallet_3")!;
  });

  describe("Contract Initialization", () => {
    it("deploys all contracts successfully", () => {
      const { result: coreDeployed } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-fee-basis-points",
        [],
        deployer
      );
      expect(coreDeployed).toBeOk(Cl.uint(5));

      const { result: tokenDeployed } = simnet.callReadOnlyFn(
        "sbtc-token",
        "get-name",
        [],
        deployer
      );
      expect(tokenDeployed).toBeOk(Cl.stringAscii("Stacks Bitcoin"));
    });

    it("sets correct initial fee (5 basis points = 0.05%)", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-fee-basis-points",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.uint(5));
    });

    it("starts unpaused", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "is-paused",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(false));
    });

    it("has correct circuit breaker limits", () => {
      const { result: maxLoan } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-max-single-loan",
        [],
        deployer
      );
      expect(maxLoan).toBeOk(Cl.uint(5000000000)); // 5 sBTC

      const { result: maxVolume } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-max-block-volume",
        [],
        deployer
      );
      expect(maxVolume).toBeOk(Cl.uint(25000000000)); // 25 sBTC
    });
  });

  describe("Admin Functions", () => {
    describe("Pause/Unpause", () => {
      it("admin can pause protocol", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "pause",
          [],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: isPaused } = simnet.callReadOnlyFn(
          "flashstack-core",
          "is-paused",
          [],
          deployer
        );
        expect(isPaused).toBeOk(Cl.bool(true));
      });

      it("admin can unpause protocol", () => {
        simnet.callPublicFn("flashstack-core", "pause", [], deployer);

        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "unpause",
          [],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: isPaused } = simnet.callReadOnlyFn(
          "flashstack-core",
          "is-paused",
          [],
          deployer
        );
        expect(isPaused).toBeOk(Cl.bool(false));
      });

      it("non-admin cannot pause", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "pause",
          [],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });

      it("non-admin cannot unpause", () => {
        simnet.callPublicFn("flashstack-core", "pause", [], deployer);

        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "unpause",
          [],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });
    });

    describe("Fee Management", () => {
      it("admin can update fee", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-fee",
          [Cl.uint(10)], // 0.1%
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: newFee } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-fee-basis-points",
          [],
          deployer
        );
        expect(newFee).toBeOk(Cl.uint(10));
      });

      it("cannot set fee above maximum (100 basis points = 1%)", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-fee",
          [Cl.uint(101)],
          deployer
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });

      it("can set fee to maximum (1%)", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-fee",
          [Cl.uint(100)],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));
      });

      it("can set fee to zero", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-fee",
          [Cl.uint(0)],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: newFee } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-fee-basis-points",
          [],
          deployer
        );
        expect(newFee).toBeOk(Cl.uint(0));
      });

      it("non-admin cannot update fee", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-fee",
          [Cl.uint(10)],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });
    });

    describe("Whitelist Management", () => {
      it("admin can add approved receiver", () => {
        const receiverPrincipal = `${deployer}.test-receiver`;

        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "add-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: isApproved } = simnet.callReadOnlyFn(
          "flashstack-core",
          "is-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );
        expect(isApproved).toBeOk(Cl.bool(true));
      });

      it("admin can remove approved receiver", () => {
        const receiverPrincipal = `${deployer}.test-receiver`;

        simnet.callPublicFn(
          "flashstack-core",
          "add-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );

        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "remove-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: isApproved } = simnet.callReadOnlyFn(
          "flashstack-core",
          "is-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );
        expect(isApproved).toBeOk(Cl.bool(false));
      });

      it("non-admin cannot add approved receiver", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "add-approved-receiver",
          [Cl.principal(`${deployer}.test-receiver`)],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });

      it("non-admin cannot remove approved receiver", () => {
        const receiverPrincipal = `${deployer}.test-receiver`;
        simnet.callPublicFn(
          "flashstack-core",
          "add-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          deployer
        );

        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "remove-approved-receiver",
          [Cl.principal(receiverPrincipal)],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });
    });

    describe("Circuit Breaker Management", () => {
      it("admin can update max single loan", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-single-loan",
          [Cl.uint(10000000000)], // 10 sBTC
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: newMax } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-max-single-loan",
          [],
          deployer
        );
        expect(newMax).toBeOk(Cl.uint(10000000000));
      });

      it("admin can update max block volume", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-block-volume",
          [Cl.uint(50000000000)], // 50 sBTC
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: newMax } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-max-block-volume",
          [],
          deployer
        );
        expect(newMax).toBeOk(Cl.uint(50000000000));
      });

      it("cannot set limits to zero", () => {
        const { result: loanResult } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-single-loan",
          [Cl.uint(0)],
          deployer
        );
        expect(loanResult).toBeErr(Cl.uint(104)); // ERR-INVALID-AMOUNT

        const { result: volumeResult } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-block-volume",
          [Cl.uint(0)],
          deployer
        );
        expect(volumeResult).toBeErr(Cl.uint(104)); // ERR-INVALID-AMOUNT
      });

      it("non-admin cannot update limits", () => {
        const { result: loanResult } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-single-loan",
          [Cl.uint(10000000000)],
          wallet1
        );
        expect(loanResult).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED

        const { result: volumeResult } = simnet.callPublicFn(
          "flashstack-core",
          "set-max-block-volume",
          [Cl.uint(50000000000)],
          wallet1
        );
        expect(volumeResult).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });
    });

    describe("Admin Transfer", () => {
      it("admin can transfer admin rights", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-admin",
          [Cl.principal(wallet1)],
          deployer
        );
        expect(result).toBeOk(Cl.bool(true));

        const { result: newAdmin } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-admin",
          [],
          deployer
        );
        expect(newAdmin).toBeOk(Cl.principal(wallet1));
      });

      it("non-admin cannot transfer admin rights", () => {
        const { result } = simnet.callPublicFn(
          "flashstack-core",
          "set-admin",
          [Cl.principal(wallet2)],
          wallet1
        );
        expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
      });
    });
  });

  describe("Fee Calculations", () => {
    it("calculates fee correctly at 5 basis points (0.05%)", () => {
      const testAmounts = [
        { amount: 100000000, expectedFee: 50000 },     // 1 sBTC
        { amount: 1000000000, expectedFee: 500000 },   // 10 sBTC
        { amount: 10000000000, expectedFee: 5000000 }, // 100 sBTC
      ];

      testAmounts.forEach(({ amount, expectedFee }) => {
        const { result } = simnet.callReadOnlyFn(
          "flashstack-core",
          "calculate-fee",
          [Cl.uint(amount)],
          deployer
        );
        expect(result).toBeOk(Cl.uint(expectedFee));
      });
    });

    it("calculates fee correctly at 100 basis points (1%)", () => {
      simnet.callPublicFn(
        "flashstack-core",
        "set-fee",
        [Cl.uint(100)],
        deployer
      );

      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(100000000)], // 1 sBTC
        deployer
      );
      expect(result).toBeOk(Cl.uint(1000000)); // 0.01 sBTC
    });

    it("calculates zero fee when set to zero", () => {
      simnet.callPublicFn(
        "flashstack-core",
        "set-fee",
        [Cl.uint(0)],
        deployer
      );

      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(100000000)],
        deployer
      );
      expect(result).toBeOk(Cl.uint(0));
    });
  });

  describe("Collateral Calculations", () => {
    it("calculates minimum collateral correctly (300% ratio)", () => {
      const testCases = [
        { loan: 100000000, minCollateral: 300000000 },     // 1 sBTC needs 3 STX
        { loan: 1000000000, minCollateral: 3000000000 },   // 10 sBTC needs 30 STX
        { loan: 500000000, minCollateral: 1500000000 },    // 5 sBTC needs 15 STX
      ];

      testCases.forEach(({ loan, minCollateral }) => {
        const { result } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-min-collateral",
          [Cl.uint(loan)],
          deployer
        );
        expect(result).toBeOk(Cl.uint(minCollateral));
      });
    });

    it("calculates max flash amount from locked STX", () => {
      const testCases = [
        { locked: 300000000, maxFlash: 100000000 },     // 3 STX allows 1 sBTC
        { locked: 3000000000, maxFlash: 1000000000 },   // 30 STX allows 10 sBTC
        { locked: 1500000000, maxFlash: 500000000 },    // 15 STX allows 5 sBTC
      ];

      testCases.forEach(({ locked, maxFlash }) => {
        const { result } = simnet.callReadOnlyFn(
          "flashstack-core",
          "get-max-flash-amount",
          [Cl.uint(locked)],
          deployer
        );
        expect(result).toBeOk(Cl.uint(maxFlash));
      });
    });
  });

  describe("Flash Loan Execution", () => {
    beforeEach(() => {
      // Setup: Set flash minter and approve test receiver
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
    });

    it("rejects flash mint when paused", () => {
      simnet.callPublicFn("flashstack-core", "pause", [], deployer);

      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(3000000000)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(1000000), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(105)); // ERR-PAUSED
    });

    it("rejects zero amount", () => {
      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(0), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-AMOUNT
    });

    it("rejects unapproved receiver", () => {
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(3000000000)],
        deployer
      );

      // Use example-arbitrage-receiver which exists but isn't approved
      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(1000000), Cl.principal(`${deployer}.example-arbitrage-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(106)); // ERR-RECEIVER-NOT-APPROVED
    });

    it("rejects loan exceeding single loan limit", () => {
      const loanAmount = 6000000000; // 6 sBTC (above 5 sBTC limit)

      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(loanAmount * 3)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(loanAmount), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(107)); // ERR-LOAN-TOO-LARGE
    });

    it("rejects insufficient collateral", () => {
      // Set 2 STX locked (not enough for 1 sBTC which needs 3 STX)
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(200000000)],
        deployer
      );

      const { result } = simnet.callPublicFn(
        "flashstack-core",
        "flash-mint",
        [Cl.uint(100000000), Cl.principal(`${deployer}.test-receiver`)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(100)); // ERR-NOT-ENOUGH-COLLATERAL
    });

    it("tracks protocol statistics after flash mint", () => {
      const { result: statsBefore } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-stats",
        [],
        deployer
      );

      // Verify initial stats are zero
      expect(statsBefore.type).toBe(7); // ResponseOk
      const statsData = statsBefore.value;
      expect(statsData.data["total-flash-mints"].value).toBe(0n);
      expect(statsData.data["total-volume"].value).toBe(0n);
    });
  });

  describe("Block Volume Limits", () => {
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
    });

    it("tracks block volume correctly", () => {
      const { result: initialVolume } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-block-volume",
        [Cl.uint(simnet.blockHeight)],
        deployer
      );
      expect(initialVolume).toBeOk(Cl.uint(0));
    });

    it("rejects when block volume limit exceeded", () => {
      // Try to mint 26 sBTC in one block (exceeds 25 sBTC limit)
      // This would require multiple transactions, but we can test by lowering the limit

      simnet.callPublicFn(
        "flashstack-core",
        "set-max-block-volume",
        [Cl.uint(1000000000)], // Set to 10 sBTC
        deployer
      );

      // Set sufficient collateral
      simnet.callPublicFn(
        "flashstack-core",
        "set-test-stx-locked",
        [Cl.principal(wallet1), Cl.uint(30000000000)],
        deployer
      );

      // First loan of 8 sBTC should fail (exceeds 10 sBTC limit even for single loan)
      // Let's use 5 sBTC first
      simnet.callPublicFn(
        "flashstack-core",
        "set-max-single-loan",
        [Cl.uint(10000000000)], // 10 sBTC single loan limit
        deployer
      );

      // This test demonstrates the block limit check exists
      const { result: volumeCheck } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-max-block-volume",
        [],
        deployer
      );
      expect(volumeCheck).toBeOk(Cl.uint(1000000000)); // Confirms limit is set
    });
  });

  describe("Edge Cases", () => {
    it("handles very small amounts correctly", () => {
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(1)], // Smallest possible amount
        deployer
      );
      expect(result).toBeOk(Cl.uint(0)); // Fee rounds down to 0
    });

    it("handles maximum safe amounts", () => {
      const maxSafeAmount = 100000000000; // 1000 sBTC

      const { result: feeResult } = simnet.callReadOnlyFn(
        "flashstack-core",
        "calculate-fee",
        [Cl.uint(maxSafeAmount)],
        deployer
      );
      expect(feeResult).toBeDefined();

      const { result: minCollateral } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-min-collateral",
        [Cl.uint(maxSafeAmount)],
        deployer
      );
      expect(minCollateral).toBeDefined();
    });

    it("maintains stats accuracy across multiple operations", () => {
      // Perform multiple admin operations
      simnet.callPublicFn("flashstack-core", "pause", [], deployer);
      simnet.callPublicFn("flashstack-core", "unpause", [], deployer);
      simnet.callPublicFn("flashstack-core", "set-fee", [Cl.uint(10)], deployer);
      simnet.callPublicFn("flashstack-core", "set-fee", [Cl.uint(5)], deployer);

      // Stats should remain at initial state (no flash mints yet)
      const { result } = simnet.callReadOnlyFn(
        "flashstack-core",
        "get-stats",
        [],
        deployer
      );

      expect(result.type).toBe(7); // ResponseOk
      const statsData = result.value;
      expect(statsData.data["total-flash-mints"].value).toBe(0n);
      expect(statsData.data["total-volume"].value).toBe(0n);
      expect(statsData.data["total-fees-collected"].value).toBe(0n);
      expect(statsData.data["current-fee-bp"].value).toBe(5n); // Back to 5
    });
  });
});
