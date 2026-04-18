import {
  fetchCallReadOnlyFunction,
  cvToJSON,
  standardPrincipalCV,
} from "@stacks/transactions";
import { POOL_CONTRACT_ADDRESS, POOL_CONTRACT_NAME, getNetwork, NetworkType } from "./config";
import type { PoolStats, PoolUserPosition } from "./types";

async function callReadOnly(
  functionName: string,
  functionArgs: Parameters<typeof fetchCallReadOnlyFunction>[0]["functionArgs"],
  network: NetworkType
) {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: POOL_CONTRACT_ADDRESS,
    contractName: POOL_CONTRACT_NAME,
    functionName,
    functionArgs,
    network: getNetwork(network),
    senderAddress: POOL_CONTRACT_ADDRESS,
  });
  return cvToJSON(result);
}

export async function fetchPoolStats(network: NetworkType): Promise<PoolStats> {
  const json = await callReadOnly("get-stats", [], network);
  const v = json.value.value;
  return {
    poolBalance:     BigInt(v["pool-balance"].value),
    totalShares:     BigInt(v["total-shares"].value),
    totalLoans:      parseInt(v["total-loans"].value, 10),
    totalVolume:     BigInt(v["total-volume"].value),
    totalFees:       BigInt(v["total-fees"].value),
    feeBasisPoints:  parseInt(v["fee-basis-points"].value, 10),
    paused:          v["paused"].value,
    maxSingleLoan:   BigInt(v["max-single-loan"].value),
  };
}

export async function fetchPoolUserPosition(
  address: string,
  network: NetworkType
): Promise<PoolUserPosition> {
  const [sharesJson, valueJson] = await Promise.all([
    callReadOnly("get-shares", [standardPrincipalCV(address)], network),
    callReadOnly("get-stx-value", [standardPrincipalCV(address)], network),
  ]);
  return {
    shares:   BigInt(sharesJson.value),
    stxValue: BigInt(valueJson.value),
  };
}
