import { initSimnet } from "@hirosystems/clarinet-sdk";
import { project, projectFactory } from "@clarigen/core";
import type { TestProvider } from "@clarigen/test";
import { Cl } from "@stacks/transactions";

// Initialize simnet
export const simnet = await initSimnet();

// Get contract interfaces from Clarinet
const manifest = simnet.getContractsInterfaces();

// Create Clarigen project from manifest
export const contracts = projectFactory(manifest, "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM");

// Helper to get accounts
export function getAccounts() {
  const accountsMap = simnet.getAccounts();
  return {
    deployer: accountsMap.get("deployer")!,
    wallet1: accountsMap.get("wallet_1")!,
    wallet2: accountsMap.get("wallet_2")!,
    wallet3: accountsMap.get("wallet_3")!,
    wallet4: accountsMap.get("wallet_4")!,
  };
}

// Create a test provider for Clarigen
export function createTestProvider(): TestProvider {
  return {
    callReadOnly: (contractId, functionName, args) => {
      const [address, name] = contractId.split(".");
      return simnet.callReadOnlyFn(name, functionName, args, address);
    },
    callPublic: (contractId, functionName, args, sender) => {
      const [address, name] = contractId.split(".");
      return simnet.callPublicFn(name, functionName, args, sender);
    },
    getBlockHeight: () => simnet.blockHeight,
    mineBlock: (txs) => {
      return simnet.mineBlock(txs);
    },
  };
}
