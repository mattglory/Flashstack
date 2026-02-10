/**
 * Format sBTC amount (8 decimals) to human-readable string.
 */
export function formatSbtc(amount: bigint): string {
  const whole = amount / 100_000_000n;
  const frac = amount % 100_000_000n;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

/**
 * Format STX amount (6 decimals) to human-readable string.
 */
export function formatStx(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fracStr}`;
}

/**
 * Format basis points as percentage string.
 */
export function formatFeeBp(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

/**
 * Truncate a Stacks address for display.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
