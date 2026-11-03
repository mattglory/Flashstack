import { describe, expect, it } from "vitest";
import { explorerTxUrl, normalizeTxId, txIdFromResult } from "./txid";

const HEX = "6b478469" + "ab".repeat(24) + "5a55a197";

describe("txid normalisation", () => {
  it("adds 0x when missing and keeps it when present", () => {
    expect(normalizeTxId(HEX)).toBe(`0x${HEX}`);
    expect(normalizeTxId(`0x${HEX}`)).toBe(`0x${HEX}`);
    expect(normalizeTxId(`0X${HEX.toUpperCase()}`)).toBe(`0x${HEX}`);
  });

  it("rejects anything that is not 32 bytes of hex", () => {
    for (const bad of ["", "0x", HEX.slice(2), `${HEX}00`, `0x0x${HEX}`, `${HEX.slice(1)}g`, "javascript:alert(1)"]) {
      expect(normalizeTxId(bad), bad).toBeNull();
    }
  });

  it("builds one explorer URL shape regardless of prefix", () => {
    const url = `https://explorer.hiro.so/txid/0x${HEX}?chain=mainnet`;
    expect(explorerTxUrl(HEX)).toBe(url);
    expect(explorerTxUrl(`0x${HEX}`)).toBe(url);
    expect(explorerTxUrl("nope")).toBeNull();
  });

  it("extracts and normalises the txid from a wallet result", () => {
    expect(txIdFromResult({ txid: HEX })).toBe(`0x${HEX}`);
    expect(txIdFromResult({ txid: `0x${HEX}` })).toBe(`0x${HEX}`);
    expect(txIdFromResult({})).toBeNull();
    expect(txIdFromResult(null)).toBeNull();
  });
});
