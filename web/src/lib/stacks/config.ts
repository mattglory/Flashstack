import { STACKS_TESTNET, STACKS_MAINNET, StacksNetwork } from "@stacks/network";

export type NetworkType = "testnet" | "mainnet";

export const CONTRACT_ADDRESS = "ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7";
export const CONTRACT_NAME = "flashstack-core";

export const RECEIVER_CONTRACTS = [
  { name: "test-receiver", label: "Test Receiver", description: "Basic flash loan test" },
  { name: "example-arbitrage-receiver", label: "Arbitrage", description: "DEX arbitrage strategy" },
  { name: "liquidation-receiver", label: "Liquidation", description: "Liquidation bot" },
  { name: "leverage-loop-receiver", label: "Leverage Loop", description: "Leveraged positions" },
  { name: "collateral-swap-receiver", label: "Collateral Swap", description: "Atomic collateral swap" },
  { name: "yield-optimization-receiver", label: "Yield Optimizer", description: "Auto-compounding" },
  { name: "dex-aggregator-receiver", label: "DEX Aggregator", description: "Multi-DEX routing" },
  { name: "snp-flashstack-receiver-v3", label: "SNP Integration", description: "SNP leveraged yield" },
] as const;

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
