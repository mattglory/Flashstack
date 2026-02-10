import {
  fetchCallReadOnlyFunction,
  cvToJSON,
  standardPrincipalCV,
  uintCV,
  ClarityValue,
} from "@stacks/transactions";
import { CONTRACT_ADDRESS, CONTRACT_NAME, getNetwork, NetworkType } from "./config";
import type { ProtocolStats } from "./types";

async function callReadOnly(
  functionName: string,
  functionArgs: ClarityValue[],
  network: NetworkType
) {
  const result = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    network: getNetwork(network),
    senderAddress: CONTRACT_ADDRESS,
  });
  return cvToJSON(result);
}

export async function fetchProtocolStats(
  network: NetworkType
): Promise<ProtocolStats> {
  const json = await callReadOnly("get-stats", [], network);

  const val = json.value.value;
  return {
    totalFlashMints: parseInt(val["total-flash-mints"].value, 10),
    totalVolume: BigInt(val["total-volume"].value),
    totalFeesCollected: BigInt(val["total-fees-collected"].value),
    currentFeeBp: parseInt(val["current-fee-bp"].value, 10),
    paused: val.paused.value,
  };
}

export async function fetchStxLocked(
  address: string,
  network: NetworkType
): Promise<bigint> {
  const json = await callReadOnly(
    "get-stx-locked",
    [standardPrincipalCV(address)],
    network
  );
  return BigInt(json.value);
}

export async function fetchMaxFlashAmount(
  lockedStx: bigint,
  network: NetworkType
): Promise<bigint> {
  const json = await callReadOnly(
    "get-max-flash-amount",
    [uintCV(lockedStx)],
    network
  );
  return BigInt(json.value.value);
}

export async function fetchMaxSingleLoan(
  network: NetworkType
): Promise<bigint> {
  const json = await callReadOnly("get-max-single-loan", [], network);
  return BigInt(json.value.value);
}

export async function fetchMaxBlockVolume(
  network: NetworkType
): Promise<bigint> {
  const json = await callReadOnly("get-max-block-volume", [], network);
  return BigInt(json.value.value);
}
