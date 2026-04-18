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

export interface PoolStats {
  poolBalance: bigint;
  totalShares: bigint;
  totalLoans: number;
  totalVolume: bigint;
  totalFees: bigint;
  feeBasisPoints: number;
  paused: boolean;
  maxSingleLoan: bigint;
}

export interface PoolUserPosition {
  shares: bigint;
  stxValue: bigint;
}
