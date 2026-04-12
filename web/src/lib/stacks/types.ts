export interface ProtocolStats {
  totalFlashMints: number;
  totalVolume: bigint;
  totalFeesCollected: bigint;
  currentFeeBp: number;
  paused: boolean;
  maxSingleLoan: bigint;
}

export interface UserStats {
  stxLocked: bigint;
  maxFlashAmount: bigint;
}

export interface ContractCallResult {
  okay: boolean;
  result: string;
}
