# Testing Summary

Quick reference for FlashStack testing. See [TESTING.md](./TESTING.md) for full documentation.

## Quick Start

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Test Coverage

**60 tests** across 4 test files, covering:
- Contract initialization and deployment
- Admin functions (pause, fees, whitelist, limits)
- Fee and collateral calculations
- Flash loan execution scenarios
- Security checks and edge cases

## Test Files

- `tests/flashstack-comprehensive.test.ts` - Main test suite (39 tests)
- `tests/flashstack-core_test.ts` - Core contract tests (10 tests)
- `tests/sbtc-token_test.ts` - Token contract tests (10 tests)
- `tests/flashstack-test.ts` - Basic tests (1 test)

## Custom Clarity Matchers

```typescript
import { Cl } from "@stacks/transactions";

// Response assertions
expect(result).toBeOk(Cl.uint(5));
expect(result).toBeErr(Cl.uint(102));

// Type assertions
expect(result).toBeUint(100);
expect(result).toBeBool(true);
expect(result).toBeTuple({ field: Cl.uint(1) });
```

## Example Test

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

describe("FlashStack", () => {
  let deployer: string;

  beforeEach(() => {
    const accounts = simnet.getAccounts();
    deployer = accounts.get("deployer")!;
  });

  it("calculates fee correctly", () => {
    const { result } = simnet.callReadOnlyFn(
      "flashstack-core",
      "calculate-fee",
      [Cl.uint(100000000)], // 1 sBTC
      deployer
    );
    expect(result).toBeOk(Cl.uint(50000)); // 0.05% fee
  });
});
```

## Tech Stack

- **Vitest** - Fast test runner
- **Clarigen** - Type-safe contract bindings
- **Clarinet SDK** - Contract simulation
- **Custom Matchers** - Clarity-specific assertions

## Coverage Targets

Minimum 80% coverage for:
- Statements
- Branches
- Functions
- Lines

View detailed coverage reports: `npm run test:coverage` then open `coverage/index.html`

---

For detailed testing guide, see [TESTING.md](./TESTING.md)
