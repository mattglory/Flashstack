import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs helper, no types
import { localize, residualMainnetRefs, OURS, THIRD_PARTY } from "../scripts/lib/testnet-localize.mjs";

/**
 * Guards the testnet address localizer (docs/TESTNET_STAGING.md §5.1).
 *
 * scripts/deploy-testnet.mjs rewrites hardcoded mainnet principals to the
 * testnet deployer before publishing. It used to know about exactly TWO
 * principals, while the current generation references three more — so a
 * current-gen deploy would have been broadcast with an unresolved contract
 * reference and aborted at publish time, burning the contract name permanently
 * at that address (the same way the live system ended up with -v2/-v3 suffixes).
 *
 * These tests pin which contracts are stageable and which are not, so the answer
 * is mechanical rather than a claim in a document.
 */

const DEPLOYER = "ST2X1GBHA2WJXREWP231EEQXZ1GDYZEEXYRAD1PA8"; // shape-valid testnet principal

const read = (p: string) => readFileSync(join("contracts", p), "utf-8");

/** The current-generation testnet staging set: STX line + the pool-v3 line. */
const STAGEABLE = [
  "stx-flash-receiver-trait.clar",
  "flashstack-stx-core-v2.clar",
  "flashstack-stx-pool-v3.clar",
  "flashstack-v3-receiver-trait.clar",
  "flashstack-pool-v3.clar",
  "test/sip-010-trait-ft-standard.clar",
];

/** Depends on canonical sBTC, which is mainnet-only — TESTNET_STAGING.md §5.2. */
const BLOCKED_BY_SBTC = [
  "flashstack-sbtc-core-v2.clar",
  "flashstack-sbtc-pool-v3.clar",
];

describe("testnet localizer", () => {
  it("OURS and THIRD_PARTY are disjoint", () => {
    const overlap = Object.keys(OURS).filter((a) => a in THIRD_PARTY);
    expect(overlap, "a principal cannot be both ours and third-party").toEqual([]);
  });

  describe("current-generation contracts localize completely", () => {
    for (const file of STAGEABLE) {
      it(`${file}: no mainnet principal survives localization`, () => {
        const left = residualMainnetRefs(localize(read(file), DEPLOYER));
        expect(
          left,
          `${file} would abort at publish time on unresolved contract(s): ${left.join(", ")}`,
        ).toEqual([]);
      });
    }
  });

  describe("sBTC-dependent contracts are correctly reported as NOT stageable", () => {
    for (const file of BLOCKED_BY_SBTC) {
      it(`${file}: still references canonical sBTC after localization`, () => {
        // Deliberately asserts a limitation. This should start failing the day a
        // canonical sBTC testnet deployment exists and is added to the localizer —
        // at which point §5.2 is resolved and this expectation is updated.
        const left = residualMainnetRefs(localize(read(file), DEPLOYER));
        expect(left).toContain("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4");
      });
    }
  });

  it("catches the exact regression that motivated this: the old two-principal list", () => {
    // What the previous patcher did — gen-1 and gen-2 deployers only.
    const OLD = ["SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ", "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5"];
    let src = read("flashstack-pool-v3.clar");
    for (const a of OLD) src = src.replaceAll(a, DEPLOYER);

    // pool-v3's two references are to NEITHER of those, so the old patcher was a no-op.
    expect(residualMainnetRefs(src).sort()).toEqual([
      "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
      "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG",
    ]);
    // The new localizer handles both.
    expect(residualMainnetRefs(localize(read("flashstack-pool-v3.clar"), DEPLOYER))).toEqual([]);
  });
});
