import { describe, expect, it } from "vitest";
import { LP_POOLS, STX_RECEIVER_CONTRACTS, SBTC_RECEIVER_CONTRACTS } from "./config";
import {
  assertApprovedReceiver,
  assertTxAllowed,
  depositPostConditions,
  sbtcFlashLoanPostConditions,
  stxFlashLoanPostConditions,
  withdrawPostConditions,
} from "./tx";

const USER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const CORE_DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const STX_CORE = `${CORE_DEPLOYER}.flashstack-stx-core`;
const SBTC_CORE = `${CORE_DEPLOYER}.flashstack-sbtc-core`;
const STX_RECEIVER = `${CORE_DEPLOYER}.stx-test-receiver` as const;
const SBTC_RECEIVER = `${CORE_DEPLOYER}.sbtc-test-receiver` as const;
const SBTC_ASSET = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
const STX_POOL = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG.flashstack-stx-pool-v2";
const SBTC_POOL = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG.flashstack-sbtc-pool-v2";

describe("flash-loan post-conditions", () => {
  it("STX: user sends 0, core sends exactly amount, receiver repays >= amount", () => {
    expect(stxFlashLoanPostConditions(USER, 2_010_000n, STX_RECEIVER)).toEqual([
      { type: "stx-postcondition", address: USER, condition: "eq", amount: "0" },
      { type: "stx-postcondition", address: STX_CORE, condition: "eq", amount: "2010000" },
      { type: "stx-postcondition", address: STX_RECEIVER, condition: "gte", amount: "2010000" },
    ]);
  });

  it("sBTC: user sends 0 STX and 0 sBTC, core sends exactly amount, receiver repays >= amount", () => {
    expect(sbtcFlashLoanPostConditions(USER, 29_000_000n, SBTC_RECEIVER)).toEqual([
      { type: "stx-postcondition", address: USER, condition: "eq", amount: "0" },
      { type: "ft-postcondition", address: USER, condition: "eq", amount: "0", asset: SBTC_ASSET },
      { type: "ft-postcondition", address: SBTC_CORE, condition: "eq", amount: "29000000", asset: SBTC_ASSET },
      { type: "ft-postcondition", address: SBTC_RECEIVER, condition: "gte", amount: "29000000", asset: SBTC_ASSET },
    ]);
  });
});

describe("pool post-conditions", () => {
  it("deposit: user sends exactly amount (STX and sBTC)", () => {
    expect(depositPostConditions(LP_POOLS.stx, USER, 290_000n)).toEqual([
      { type: "stx-postcondition", address: USER, condition: "eq", amount: "290000" },
    ]);
    expect(depositPostConditions(LP_POOLS.sbtc, USER, 57_000_000n)).toEqual([
      { type: "ft-postcondition", address: USER, condition: "eq", amount: "57000000", asset: SBTC_ASSET },
    ]);
  });

  it("withdraw: pool sends at least minReceive (STX and sBTC)", () => {
    expect(withdrawPostConditions(LP_POOLS.stx, 990n)).toEqual([
      { type: "stx-postcondition", address: STX_POOL, condition: "gte", amount: "990" },
    ]);
    expect(withdrawPostConditions(LP_POOLS.sbtc, 990n)).toEqual([
      { type: "ft-postcondition", address: SBTC_POOL, condition: "gte", amount: "990", asset: SBTC_ASSET },
    ]);
  });
});

describe("tx guard", () => {
  it("allows every approved contract on mainnet", () => {
    for (const c of [STX_CORE, SBTC_CORE, STX_POOL, SBTC_POOL]) {
      expect(assertTxAllowed("mainnet", c)).toBe(c);
    }
  });

  it("rejects testnet even for an approved contract", () => {
    expect(() => assertTxAllowed("testnet", STX_CORE)).toThrow(/mainnet only/);
  });

  it("rejects contracts not listed in config.ts", () => {
    // retired v1 pool, a lookalike name, and a different deployer
    for (const c of [
      `${CORE_DEPLOYER}.flashstack-stx-pool`,
      `${STX_CORE}-v2`,
      "SP000000000000000000002Q6VF78.flashstack-stx-core",
    ]) {
      expect(() => assertTxAllowed("mainnet", c)).toThrow(/unapproved contract/);
    }
  });

  it("accepts only receivers listed for that core", () => {
    expect(assertApprovedReceiver("stx", STX_RECEIVER)).toBe(STX_RECEIVER);
    expect(assertApprovedReceiver("sbtc", SBTC_RECEIVER)).toBe(SBTC_RECEIVER);
    expect(() => assertApprovedReceiver("stx", SBTC_RECEIVER)).toThrow(/unlisted receiver/);
    expect(() => assertApprovedReceiver("sbtc", `${CORE_DEPLOYER}.evil-receiver`)).toThrow(/unlisted receiver/);
  });
});

// Deny mode is only correct because every listed receiver moves no asset other
// than the loan and its repayment. A strategy receiver (DEX swaps, liquidations)
// moves other assets, and Deny mode would abort every loan through it. Adding one
// requires either declaring its movements or switching that receiver to Allow
// mode while keeping the user-side zero-send conditions. This test forces that
// decision instead of letting it surface as user-facing aborts.
describe("deny-mode precondition", () => {
  it("only repay-only test receivers are listed", () => {
    for (const r of [...STX_RECEIVER_CONTRACTS, ...SBTC_RECEIVER_CONTRACTS]) {
      expect(r.name, `${r.name}: see the comment above before listing a strategy receiver`).toMatch(/^(stx|sbtc)-test-receiver$/);
    }
  });
});
