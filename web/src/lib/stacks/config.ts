import { STACKS_TESTNET, STACKS_MAINNET, StacksNetwork } from "@stacks/network";

export type NetworkType = "testnet" | "mainnet";

export const CONTRACT_ADDRESS = "ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7";
export const CONTRACT_NAME = "flashstack-core";

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
