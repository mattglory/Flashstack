import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

describe("FlashStack Core", () => {
  it("should initialize with correct fee", () => {
    const accounts = simnet.getAccounts();
    const address1 = accounts.get("wallet_1")!;
    const { result } = simnet.callReadOnlyFn(
      "flashstack-core",
      "get-fee-basis-points",
      [],
      address1
    );
    expect(result).toBeOk(Cl.uint(5));
  });
});
