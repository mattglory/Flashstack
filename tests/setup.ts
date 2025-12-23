import { beforeEach, expect } from "vitest";
import { initSimnet } from "@hirosystems/clarinet-sdk";
import { Cl, ClarityValue, cvToValue, ClarityType } from "@stacks/transactions";

declare global {
  var simnet: ReturnType<typeof initSimnet>;
}

beforeEach(async () => {
  globalThis.simnet = await initSimnet();
});

// Extend Vitest's expect with custom Clarity matchers
interface CustomMatchers<R = unknown> {
  toBeOk(expected?: any): R;
  toBeErr(expected?: any): R;
  toBeUint(expected: number): R;
  toBeBool(expected: boolean): R;
  toBeTuple(expected: Record<string, any>): R;
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBeOk(received: ClarityValue, expected?: any) {
    const { isNot } = this;
    
    // Type 7 = ResponseOk, Type 8 = ResponseErr
    const isOk = received.type === ClarityType.ResponseOk;
    
    if (!isOk) {
      const isErr = received.type === ClarityType.ResponseErr;
      return {
        pass: false,
        message: () => isErr 
          ? `Expected (ok ...) but got (err ${cvToValue(received.value)})`
          : `Expected Response type but got type ${received.type}`
      };
    }

    if (expected !== undefined) {
      const actualValue = cvToValue(received.value);
      const expectedValue = cvToValue(expected);
      const valuesMatch = JSON.stringify(actualValue) === JSON.stringify(expectedValue);
      
      return {
        pass: valuesMatch,
        message: () => valuesMatch 
          ? `Expected not (ok ${expectedValue})` 
          : `Expected (ok ${expectedValue}) but got (ok ${actualValue})`
      };
    }

    return { 
      pass: true, 
      message: () => `Expected not (ok ...)` 
    };
  },

  toBeErr(received: ClarityValue, expected?: any) {
    const { isNot } = this;
    
    // Type 7 = ResponseOk, Type 8 = ResponseErr
    const isErr = received.type === ClarityType.ResponseErr;
    
    if (!isErr) {
      const isOk = received.type === ClarityType.ResponseOk;
      return {
        pass: false,
        message: () => isOk
          ? `Expected (err ...) but got (ok ${cvToValue(received.value)})`
          : `Expected Response type but got type ${received.type}`
      };
    }

    if (expected !== undefined) {
      const actualValue = cvToValue(received.value);
      const expectedValue = cvToValue(expected);
      const valuesMatch = JSON.stringify(actualValue) === JSON.stringify(expectedValue);
      
      return {
        pass: valuesMatch,
        message: () => valuesMatch 
          ? `Expected not (err ${expectedValue})` 
          : `Expected (err ${expectedValue}) but got (err ${actualValue})`
      };
    }

    return { 
      pass: true, 
      message: () => `Expected not (err ...)` 
    };
  },

  toBeUint(received: ClarityValue, expected: number) {
    if (received.type !== ClarityType.UInt) {
      return {
        pass: false,
        message: () => `Expected uint but got type ${received.type}`
      };
    }

    const actualValue = Number(received.value);
    const valuesMatch = actualValue === expected;
    
    return {
      pass: valuesMatch,
      message: () => valuesMatch
        ? `Expected not uint ${expected}`
        : `Expected uint ${expected} but got uint ${actualValue}`
    };
  },

  toBeBool(received: ClarityValue, expected: boolean) {
    if (received.type !== ClarityType.BoolTrue && received.type !== ClarityType.BoolFalse) {
      return {
        pass: false,
        message: () => `Expected bool but got type ${received.type}`
      };
    }

    const actualValue = received.type === ClarityType.BoolTrue;
    const valuesMatch = actualValue === expected;
    
    return {
      pass: valuesMatch,
      message: () => valuesMatch
        ? `Expected not bool ${expected}`
        : `Expected bool ${expected} but got bool ${actualValue}`
    };
  },

  toBeTuple(received: ClarityValue, expected: Record<string, any>) {
    if (received.type !== ClarityType.Tuple) {
      return {
        pass: false,
        message: () => `Expected tuple but got type ${received.type}`
      };
    }

    const actualData = cvToValue(received);
    const expectedData = Object.fromEntries(
      Object.entries(expected).map(([k, v]) => [k, cvToValue(v)])
    );
    
    const allMatch = Object.entries(expectedData).every(([key, value]) => {
      return JSON.stringify(actualData[key]) === JSON.stringify(value);
    });

    return {
      pass: allMatch,
      message: () => allMatch
        ? `Expected tuples not to match`
        : `Expected tuple ${JSON.stringify(expectedData)} but got ${JSON.stringify(actualData)}`
    };
  }
});
