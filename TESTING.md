# FlashStack Testing Guide

Comprehensive testing documentation for FlashStack using Clarigen and Vitest.

## Table of Contents
- [Overview](#overview)
- [Setup](#setup)
- [Running Tests](#running-tests)
- [Test Structure](#test-structure)
- [Writing Tests](#writing-tests)
- [Coverage Reports](#coverage-reports)
- [Best Practices](#best-practices)

## Overview

FlashStack uses a modern testing stack:
- **Vitest** - Fast unit test framework
- **Clarigen** - Type-safe Clarity contract bindings
- **Clarinet SDK** - Simnet for contract simulation
- **Custom Matchers** - Clarity-specific assertions

## Setup

### 1. Install Dependencies

```bash
npm install
```

This installs:
- `@clarigen/cli@^4.0.1` - CLI for generating type-safe bindings
- `@clarigen/core@^4.0.1` - Core Clarigen library
- `@clarigen/test@^4.0.1` - Testing utilities
- `@hirosystems/clarinet-sdk@^2.8.0` - Clarinet SDK for simnet
- `vitest@^1.0.0` - Test runner

### 2. Configuration Files

#### `.clarigen`
```json
{
  "output": "src/clarigen",
  "esm": true
}
```

#### `vitest.config.js`
Configures test execution and coverage:
- Single-threaded execution for deterministic contract state
- 120s timeout for contract deployments
- Custom setup file for Clarity matchers
- Coverage reporting configuration

## Running Tests

### Run All Tests
```bash
npm test
```

### Watch Mode (Auto-rerun on changes)
```bash
npm run test:watch
```

### With Coverage Report
```bash
npm run test:coverage
```

Coverage reports will be generated in the `coverage/` directory with:
- HTML report (open `coverage/index.html` in browser)
- LCOV format for CI integration
- JSON format for programmatic access
- Text summary in terminal

### Run Specific Test File
```bash
npx vitest run tests/flashstack-comprehensive.test.ts
```

## Test Structure

### Test Files

```
tests/
├── setup.ts                              # Global test setup & custom matchers
├── flashstack-core_test.ts               # Basic core contract tests
├── flashstack-comprehensive.test.ts       # Comprehensive test suite
├── sbtc-token_test.ts                    # sBTC token contract tests
└── flashstack-test.ts                    # Legacy tests (for reference)
```

### Custom Clarity Matchers

Located in `tests/setup.ts`, these provide type-safe assertions:

```typescript
// Response type assertions
expect(result).toBeOk(expectedValue?)
expect(result).toBeErr(expectedValue?)

// Primitive type assertions
expect(result).toBeUint(expectedNumber)
expect(result).toBeBool(expectedBoolean)
expect(result).toBeTuple(expectedObject)
```

## Writing Tests

### Basic Test Structure

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

describe("My Contract Tests", () => {
  let deployer: string;
  let wallet1: string;

  beforeEach(() => {
    const accounts = simnet.getAccounts();
    deployer = accounts.get("deployer")!;
    wallet1 = accounts.get("wallet_1")!;
  });

  it("tests a read-only function", () => {
    const { result } = simnet.callReadOnlyFn(
      "contract-name",
      "function-name",
      [Cl.uint(123)],
      deployer
    );
    expect(result).toBeOk(Cl.uint(456));
  });

  it("tests a public function", () => {
    const { result } = simnet.callPublicFn(
      "contract-name",
      "function-name",
      [Cl.principal(wallet1)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));
  });
});
```

### Working with Clarity Values

#### Creating Clarity Values
```typescript
import { Cl } from "@stacks/transactions";

// Unsigned integers
Cl.uint(100)

// Booleans
Cl.bool(true)

// Principals (addresses)
Cl.principal("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM")
Cl.principal(`${deployer}.contract-name`)

// Strings
Cl.stringAscii("Hello")
Cl.stringUtf8("Hello 👋")

// Tuples
Cl.tuple({
  amount: Cl.uint(100),
  recipient: Cl.principal(wallet1)
})

// Lists
Cl.list([Cl.uint(1), Cl.uint(2), Cl.uint(3)])
```

#### Reading Clarity Values
```typescript
import { cvToValue } from "@stacks/transactions";

const { result } = simnet.callReadOnlyFn(...);

// Direct property access for simple types
result.value  // For ok/err responses
result.data   // For tuples

// Convert to JavaScript values
const jsValue = cvToValue(result);

// Access tuple fields
const tupleData = result.value;
tupleData.data["field-name"].value  // Get uint/bool value
```

### Testing Patterns

#### 1. Admin Functions
```typescript
it("admin can pause protocol", () => {
  const { result } = simnet.callPublicFn(
    "flashstack-core",
    "pause",
    [],
    deployer
  );
  expect(result).toBeOk(Cl.bool(true));
});

it("non-admin cannot pause", () => {
  const { result } = simnet.callPublicFn(
    "flashstack-core",
    "pause",
    [],
    wallet1  // Non-admin wallet
  );
  expect(result).toBeErr(Cl.uint(102)); // ERR-UNAUTHORIZED
});
```

#### 2. Error Conditions
```typescript
it("rejects zero amount", () => {
  const { result } = simnet.callPublicFn(
    "flashstack-core",
    "flash-mint",
    [Cl.uint(0), Cl.principal(`${deployer}.receiver`)],
    wallet1
  );
  expect(result).toBeErr(Cl.uint(104)); // ERR-INVALID-AMOUNT
});
```

#### 3. State Verification
```typescript
it("updates state correctly", () => {
  // Perform action
  simnet.callPublicFn("contract", "update-value", [Cl.uint(100)], deployer);

  // Verify state
  const { result } = simnet.callReadOnlyFn(
    "contract",
    "get-value",
    [],
    deployer
  );
  expect(result).toBeOk(Cl.uint(100));
});
```

#### 4. Complex Scenarios
```typescript
it("complete flash loan workflow", () => {
  // 1. Setup: Set flash minter
  simnet.callPublicFn(
    "sbtc-token",
    "set-flash-minter",
    [Cl.principal(`${deployer}.flashstack-core`)],
    deployer
  );

  // 2. Setup: Approve receiver
  simnet.callPublicFn(
    "flashstack-core",
    "add-approved-receiver",
    [Cl.principal(`${deployer}.test-receiver`)],
    deployer
  );

  // 3. Setup: Set collateral
  simnet.callPublicFn(
    "flashstack-core",
    "set-test-stx-locked",
    [Cl.principal(wallet1), Cl.uint(3000000000)],
    deployer
  );

  // 4. Execute: Flash mint
  const { result } = simnet.callPublicFn(
    "flashstack-core",
    "flash-mint",
    [Cl.uint(1000000000), Cl.principal(`${deployer}.test-receiver`)],
    wallet1
  );

  // 5. Verify: Success response
  expect(result.type).toBe(7); // ResponseOk
});
```

## Comprehensive Test Coverage

Our test suite (`flashstack-comprehensive.test.ts`) covers:

### 1. Contract Initialization (4 tests)
- Contract deployment verification
- Initial fee configuration
- Initial paused state
- Circuit breaker limits

### 2. Admin Functions (22 tests)
- Pause/unpause (4 tests)
- Fee management (5 tests)
- Whitelist management (4 tests)
- Circuit breaker management (6 tests)
- Admin transfer (2 tests)
- Error conditions for unauthorized access

### 3. Calculations (8 tests)
- Fee calculations at different rates
- Collateral requirement calculations
- Maximum flash amount calculations

### 4. Flash Loan Execution (8 tests)
- Paused protocol rejection
- Zero amount rejection
- Unapproved receiver rejection
- Loan limit enforcement
- Collateral requirement enforcement
- Statistics tracking

### 5. Security & Edge Cases (6 tests)
- Block volume limits
- Very small amounts
- Maximum safe amounts
- Stats accuracy across operations

**Total: 60 tests across all files**

## Coverage Reports

### Interpreting Coverage

Coverage reports show:
- **Statements**: Individual lines of code executed
- **Branches**: Decision points (if/else) tested
- **Functions**: Functions called during tests
- **Lines**: Physical lines in files tested

Target: 80% minimum across all metrics

### Coverage Thresholds

Configured in `vitest.config.js`:
```javascript
coverage: {
  lines: 80,
  functions: 80,
  branches: 80,
  statements: 80,
}
```

## Best Practices

### 1. Test Organization
- Group related tests in `describe` blocks
- Use descriptive test names starting with lowercase
- Follow AAA pattern: Arrange, Act, Assert

### 2. Use beforeEach for Setup
```typescript
beforeEach(() => {
  const accounts = simnet.getAccounts();
  deployer = accounts.get("deployer")!;
  // ... setup code
});
```

### 3. Test One Thing Per Test
```typescript
// Good
it("admin can pause protocol", () => { ... });
it("non-admin cannot pause protocol", () => { ... });

// Bad
it("tests pause functionality", () => {
  // Tests both admin and non-admin in one test
});
```

### 4. Use Custom Matchers
```typescript
// Good - Type-safe and clear
expect(result).toBeOk(Cl.uint(5));

// Less ideal - Manual type checking
expect(result.type).toBe(7);
expect(result.value.value).toBe(5n);
```

### 5. Test Error Cases
Always test both success and failure paths:
```typescript
it("succeeds with valid input", () => { ... });
it("fails with invalid input", () => { ... });
it("fails when unauthorized", () => { ... });
```

### 6. Document Complex Tests
```typescript
it("enforces 300% collateral ratio", () => {
  // 1 sBTC (100000000 sats) requires 3 STX (300000000 ustx)
  const loanAmount = 100000000;
  const requiredCollateral = 300000000;
  // ... test code
});
```

### 7. Avoid Test Interdependence
Each test should be independent and not rely on state from other tests.

### 8. Use Constants for Error Codes
```typescript
const ERR_UNAUTHORIZED = 102;
const ERR_INVALID_AMOUNT = 104;

expect(result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
```

## Troubleshooting

### Common Issues

#### 1. "Unknown contract" errors
Make sure contracts are listed in `Clarinet.toml`:
```toml
[contracts.my-contract]
path = "contracts/my-contract.clar"
clarity_version = 2
epoch = 2.5
```

#### 2. Type errors with Clarity values
Always use `Cl.*` constructors from `@stacks/transactions`:
```typescript
import { Cl } from "@stacks/transactions";
```

#### 3. Tests timing out
Increase timeouts in `vitest.config.js`:
```javascript
{
  hookTimeout: 120000,
  testTimeout: 120000,
}
```

#### 4. State bleeding between tests
Ensure `isolate: false` and `singleThread: true` in vitest config, and use `beforeEach` for setup.

## Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [Clarigen Documentation](https://github.com/mechanismHQ/clarigen)
- [Clarinet SDK Documentation](https://docs.hiro.so/clarinet)
- [Clarity Language Reference](https://docs.stacks.co/clarity)

## Next Steps

1. Run the full test suite: `npm test`
2. Check coverage: `npm run test:coverage`
3. Review the comprehensive test suite for examples
4. Write tests for new features before implementing them (TDD)
5. Maintain 80%+ coverage as you add features
