export interface ProtocolStats {
  totalFlashMints: number;
  totalVolume: bigint;
  totalFeesCollected: bigint;
  currentFeeBp: number;
  paused: boolean;
}

export interface UserStats {
  stxLocked: bigint;
  maxFlashAmount: bigint;
}

export interface ContractCallResult {
  okay: boolean;
  result: string;
}
