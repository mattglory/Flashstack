import { STACKS_TESTNET, STACKS_MAINNET, StacksNetwork } from "@stacks/network";

export type NetworkType = "testnet" | "mainnet";

// sBTC flash loan core (original deployer — compromised but contracts still valid)
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ";
export const CONTRACT_NAME = "flashstack-core";

// STX reserve flash loan core (new deployer)
export const STX_CONTRACT_ADDRESS = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
export const STX_CONTRACT_NAME = "flashstack-stx-core";

export const RECEIVER_CONTRACTS = [
  { name: "test-receiver", label: "Test Receiver", description: "Basic flash loan test", address: CONTRACT_ADDRESS },
  { name: "example-arbitrage-receiver", label: "Arbitrage", description: "DEX arbitrage strategy", address: CONTRACT_ADDRESS },
  { name: "liquidation-receiver", label: "Liquidation", description: "Liquidation bot", address: CONTRACT_ADDRESS },
  { name: "leverage-loop-receiver", label: "Leverage Loop", description: "Leveraged positions", address: CONTRACT_ADDRESS },
  { name: "collateral-swap-receiver", label: "Collateral Swap", description: "Atomic collateral swap", address: CONTRACT_ADDRESS },
  { name: "yield-optimization-receiver", label: "Yield Optimizer", description: "Auto-compounding", address: CONTRACT_ADDRESS },
  { name: "dex-aggregator-receiver", label: "DEX Aggregator", description: "Multi-DEX routing", address: CONTRACT_ADDRESS },
  { name: "snp-flashstack-receiver-v3", label: "SNP Integration", description: "SNP leveraged yield", address: CONTRACT_ADDRESS },
];

export const STX_RECEIVER_CONTRACTS = [
  { name: "stx-test-receiver", label: "STX Test Receiver", description: "Borrow STX, repay principal + fee", address: STX_CONTRACT_ADDRESS },
  { name: "bitflow-arb-receiver", label: "Bitflow Arbitrage", description: "STX/stSTX round-trip on Bitflow stableswap", address: STX_CONTRACT_ADDRESS },
];

export const HIRO_API_URLS: Record<NetworkType, string> = {
  testnet: "https://api.testnet.hiro.so",
  mainnet: "https://api.mainnet.hiro.so",
};

export function getNetwork(networkType: NetworkType): StacksNetwork {
  return networkType === "mainnet" ? STACKS_MAINNET : STACKS_TESTNET;
}

export function getApiUrl(networkType: NetworkType): string {
  return HIRO_API_URLS[networkType];
}
