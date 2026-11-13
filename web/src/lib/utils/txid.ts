/**
 * Normalise a wallet-returned txid to `0x` + 64 lowercase hex chars.
 * Wallets differ on whether they include the 0x prefix. Returns null for
 * anything that is not a 32-byte hex id, so it never ends up in a link.
 */
export function normalizeTxId(txid: string): string | null {
  const hex = txid.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? `0x${hex}` : null;
}

/** Hiro explorer link for a mainnet tx (txs are only sent on mainnet, see lib/stacks/tx.ts). */
export function explorerTxUrl(txid: string): string | null {
  const id = normalizeTxId(txid);
  return id ? `https://explorer.hiro.so/txid/${id}?chain=mainnet` : null;
}

/** Pull the txid out of a stx_callContract result. */
export function txIdFromResult(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("txid" in result)) return null;
  return normalizeTxId(String((result as Record<string, unknown>).txid));
}
