/**
 * Parse a user-typed decimal string (e.g. "0.29") into integer base units
 * (e.g. 290000n µSTX for 6 decimals) without going through floating point.
 *
 * Returns null for anything that is not a plain non-negative decimal with at
 * most `decimals` fractional digits: empty input, exponents ("1e21"), signs
 * ("-1", "+1"), NaN/Infinity, or too many decimals. Never rounds.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? "";
  if (whole === "" && frac === "") return null;
  if (frac.length > decimals) return null;
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
