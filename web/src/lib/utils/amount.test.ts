import { describe, expect, it } from "vitest";
import { parseAmount } from "./amount";

describe("parseAmount", () => {
  it("converts decimals exactly, with no float rounding", () => {
    // The old Math.floor(parseFloat(x) * 10 ** d) is one base unit short on
    // each of these: 2.01 STX -> 2009999, 0.29 sBTC -> 28999999, 0.57 sBTC -> 56999999.
    expect(parseAmount("2.01", 6)).toBe(2_010_000n);
    expect(parseAmount("0.29", 8)).toBe(29_000_000n);
    expect(parseAmount("0.57", 8)).toBe(57_000_000n);
    expect(parseAmount("0.29", 6)).toBe(290_000n);
    expect(parseAmount("4.35", 6)).toBe(4_350_000n);
    expect(parseAmount("0.57", 6)).toBe(570_000n);
  });

  it("accepts whole numbers, bare dots and max decimals", () => {
    expect(parseAmount("5000", 6)).toBe(5_000_000_000n);
    expect(parseAmount("1.", 6)).toBe(1_000_000n);
    expect(parseAmount(".5", 6)).toBe(500_000n);
    expect(parseAmount("0.000001", 6)).toBe(1n);
    expect(parseAmount("0.00000001", 8)).toBe(1n);
    expect(parseAmount("0", 6)).toBe(0n);
  });

  it("rejects exponents, signs, NaN, junk and too many decimals", () => {
    for (const bad of ["1e21", "1E5", "-1", "+1", "abc", "NaN", "Infinity", "", ".", " ", "1.2.3", "0x10", "1,5"]) {
      expect(parseAmount(bad, 6), bad).toBeNull();
    }
    expect(parseAmount("0.0000001", 6)).toBeNull();
    expect(parseAmount("0.000000001", 8)).toBeNull();
  });
});
