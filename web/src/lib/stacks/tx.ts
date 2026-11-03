import { Pc, type PostCondition } from "@stacks/transactions";
import {
  LP_POOLS,
  SBTC_CONTRACT_ADDRESS,
  SBTC_CONTRACT_NAME,
  SBTC_RECEIVER_CONTRACTS,
  SBTC_TOKEN_ADDRESS,
  SBTC_TOKEN_NAME,
  STX_CONTRACT_ADDRESS,
  STX_CONTRACT_NAME,
  STX_RECEIVER_CONTRACTS,
  type LpPoolMeta,
  type NetworkType,
} from "./config";

type ContractId = `${string}.${string}`;

/** Every contract principal in config.ts is a mainnet deployment. */
export const TX_NETWORK = "mainnet" as const;

export const STX_CORE_ID: ContractId = `${STX_CONTRACT_ADDRESS}.${STX_CONTRACT_NAME}`;
export const SBTC_CORE_ID: ContractId = `${SBTC_CONTRACT_ADDRESS}.${SBTC_CONTRACT_NAME}`;
export const SBTC_TOKEN_ID: ContractId = `${SBTC_TOKEN_ADDRESS}.${SBTC_TOKEN_NAME}`;
// Canonical sBTC declares `(define-fungible-token sbtc-token)`, so the asset
// name equals the contract name. (The local contracts/sbtc-token.clar mock
// uses `sbtc`; it is not what mainnet runs.)
export const SBTC_ASSET_NAME = "sbtc-token";

const APPROVED_TX_CONTRACTS = new Set<string>([
  STX_CORE_ID,
  SBTC_CORE_ID,
  ...Object.values(LP_POOLS).map((p) => `${p.address}.${p.name}`),
]);

const APPROVED_RECEIVERS = {
  stx: new Set(STX_RECEIVER_CONTRACTS.map((r) => `${r.address}.${r.name}`)),
  sbtc: new Set(SBTC_RECEIVER_CONTRACTS.map((r) => `${r.address}.${r.name}`)),
};

/**
 * Throws unless the selected network is the one the contracts live on and the
 * tx targets a contract principal listed in config.ts. Call before request();
 * returns the checked contract id.
 */
export function assertTxAllowed(network: NetworkType, contract: string): ContractId {
  if (network !== TX_NETWORK) {
    throw new Error("FlashStack contracts are deployed on mainnet only. Switch the network selector to Mainnet to send transactions.");
  }
  if (!APPROVED_TX_CONTRACTS.has(contract)) {
    throw new Error(`Refusing to call unapproved contract ${contract}`);
  }
  return contract as ContractId;
}

/** Throws unless `receiver` is one of the listed receivers for that core. */
export function assertApprovedReceiver(kind: "stx" | "sbtc", receiver: string): ContractId {
  if (!APPROVED_RECEIVERS[kind].has(receiver)) {
    throw new Error(`Refusing to use unlisted receiver ${receiver}`);
  }
  return receiver as ContractId;
}

/*
 * Flash-loan post-conditions, used with postConditionMode "deny".
 *
 * In flashstack-{stx,sbtc}-core `flash-loan`, the only asset movements are
 * (1) core -> receiver `amount` (as-contract transfer) and (2) the receiver's
 * callback repaying amount + fee to the core. The caller's own principal sends
 * nothing: the fee comes from the receiver's balance, never from tx-sender.
 * The listed test receivers repay via as-contract from their own balance and
 * move no other asset, so every movement can be declared and Deny mode works.
 *
 * The user-side `willSendEq(0)` conditions are the security point: an approved
 * receiver that tried to pull STX or sBTC from tx-sender would abort the tx.
 * The core/receiver conditions only whitelist the expected movements (the
 * core itself enforces the repayment), so the receiver bound is `>= amount`
 * rather than duplicating the on-chain fee calculation.
 */
export function stxFlashLoanPostConditions(user: string, amount: bigint, receiver: ContractId): PostCondition[] {
  return [
    Pc.principal(user).willSendEq(0).ustx(),
    Pc.principal(STX_CORE_ID).willSendEq(amount).ustx(),
    Pc.principal(receiver).willSendGte(amount).ustx(),
  ];
}

export function sbtcFlashLoanPostConditions(user: string, amount: bigint, receiver: ContractId): PostCondition[] {
  return [
    Pc.principal(user).willSendEq(0).ustx(),
    Pc.principal(user).willSendEq(0).ft(SBTC_TOKEN_ID, SBTC_ASSET_NAME),
    Pc.principal(SBTC_CORE_ID).willSendEq(amount).ft(SBTC_TOKEN_ID, SBTC_ASSET_NAME),
    Pc.principal(receiver).willSendGte(amount).ft(SBTC_TOKEN_ID, SBTC_ASSET_NAME),
  ];
}

/** Pool deposit: exactly `amount` leaves the user. */
export function depositPostConditions(pool: LpPoolMeta, user: string, amount: bigint): PostCondition[] {
  return [
    pool.nativeStx
      ? Pc.principal(user).willSendEq(amount).ustx()
      : Pc.principal(user).willSendEq(amount).ft(pool.tokenContract! as ContractId, pool.tokenName!),
  ];
}

/** Pool withdraw: the pool must send the user at least `minReceive`. */
export function withdrawPostConditions(pool: LpPoolMeta, minReceive: bigint): PostCondition[] {
  const poolId: ContractId = `${pool.address}.${pool.name}`;
  return [
    pool.nativeStx
      ? Pc.principal(poolId).willSendGte(minReceive).ustx()
      : Pc.principal(poolId).willSendGte(minReceive).ft(pool.tokenContract! as ContractId, pool.tokenName!),
  ];
}
