/**
 * Shared plumbing for the property-based / stateful invariant suites
 * (tests/invariants-*.test.ts). Not a test file: excluded in vitest.config.js.
 *
 * Every property runs a random action sequence against a FRESH simnet
 * (initSimnet per run, ~250 ms), checking invariants after every step.
 *
 * Reproducing a failure: fast-check prints `seed` and `path` in the error.
 * The default seed is fixed, so a red run is deterministic. Override with
 *   FC_SEED=<n> FC_RUNS=<n> npx vitest run tests/invariants-*.test.ts
 * FC_SHRINK=1 turns shrinking on (off by default: every shrink step costs a
 * fresh simnet, and the step log in the error is already a readable trace).
 * FC_VERBOSE=1 prints per-run timings and each property's outcome tally.
 */
import fc from "fast-check";
import { initSimnet } from "@stacks/clarinet-sdk";
import { Cl, ClarityValue } from "@stacks/transactions";

export const SEED = Number(process.env.FC_SEED ?? 20261103);
export const runs = (n: number) => Number(process.env.FC_RUNS ?? n);

export const json = (x: unknown) =>
  JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

export class InvariantError extends Error {}

export function inv(cond: unknown, name: string, detail?: unknown): asserts cond {
  if (!cond) throw new InvariantError(`INVARIANT VIOLATED [${name}]${detail === undefined ? "" : " " + json(detail)}`);
}

/** Runs `body` once per generated action list, each time on a fresh simnet. */
export async function stateful<A>(
  label: string,
  actions: fc.Arbitrary<A[]>,
  body: (acts: A[], log: string[]) => void,
  numRuns: number,
) {
  try {
    await fc.assert(
      fc.asyncProperty(actions, async (acts) => {
        const t0 = Date.now();
        globalThis.simnet = await initSimnet();
        const t1 = Date.now();
        const log: string[] = [];
        try {
          body(acts, log);
          if (process.env.FC_VERBOSE) process.stderr.write(`[timing ${label}] init=${t1 - t0}ms body=${Date.now() - t1}ms steps=${acts.length}\n`);
        } catch (e) {
          const msg = (e as Error).message;
          throw new Error(`${msg}\n--- step trace (${log.length} steps) ---\n${log.slice(-12).join("\n")}`);
        }
      }),
      { seed: SEED, numRuns: runs(numRuns), endOnFailure: !process.env.FC_SHRINK },
    );
  } catch (e) {
    (e as Error).message = `[${label}] FC_SEED=${SEED}\n${(e as Error).message}`;
    throw e;
  }
}

// ---------------------------------------------------------------- simnet I/O

export type Res = { ok: boolean; val: any; code: bigint | null };

export const unwrapCv = (cv: any): any => {
  switch (cv.type) {
    case "uint":
    case "int":
      return BigInt(cv.value);
    case "true":
      return true;
    case "false":
      return false;
    case "ok":
    case "err":
    case "some":
      return unwrapCv(cv.value);
    case "none":
      return null;
    case "tuple": {
      const o: Record<string, any> = {};
      for (const [k, v] of Object.entries(cv.value)) o[k] = unwrapCv(v);
      return o;
    }
    case "address":
    case "contract":
      return cv.value;
    default:
      return cv.value;
  }
};

export function call(contract: string, fn: string, args: ClarityValue[], sender: string): Res {
  const cv: any = simnet.callPublicFn(contract, fn, args, sender).result;
  if (cv.type === "ok") return { ok: true, val: unwrapCv(cv.value), code: null };
  if (cv.type === "err") return { ok: false, val: null, code: BigInt(cv.value.value) };
  throw new Error(`unexpected result type ${cv.type} from ${contract}.${fn}`);
}

export const ro = (contract: string, fn: string, args: ClarityValue[] = []) =>
  unwrapCv(simnet.callReadOnlyFn(contract, fn, args, accounts().deployer).result);

export const dataVar = (contract: string, name: string) => unwrapCv(simnet.getDataVar(contract, name));

/** Direct map read (no VM call). A missing key reads as null. */
export const mapEntry = (contract: string, map: string, key: ClarityValue) => {
  try {
    return unwrapCv(simnet.getMapEntry(contract, map, key));
  } catch (e) {
    if (String((e as any)?.message ?? e).includes("value not found")) return null;
    throw e;
  }
};

export function accounts() {
  const a = simnet.getAccounts();
  return {
    deployer: a.get("deployer")!,
    wallets: [a.get("wallet_1")!, a.get("wallet_2")!, a.get("wallet_3")!],
  };
}

export const stxBalance = (p: string): bigint => simnet.getAssetsMap().get("STX")?.get(p) ?? 0n;
/** define-fungible-token name inside each token contract used here. */
const FT_NAME: Record<string, string> = { "sbtc-token": "sbtc", "mock-usdcx": "mock-usdcx" };
/**
 * Token balance read straight from the simnet ledger (~50x cheaper than a
 * read-only call). `ftBalanceChecked` cross-checks it against the token's own
 * SIP-010 get-balance; every suite calls that once per run.
 */
export const ftBalance = (token: string, p: string): bigint =>
  simnet.getAssetsMap().get(`.${token}.${FT_NAME[token]}`)?.get(p) ?? 0n;
export const ftBalanceChecked = (token: string, p: string): bigint => {
  const fast = ftBalance(token, p);
  const slow: bigint = ro(token, "get-balance", [Cl.principal(p)]);
  inv(fast === slow, "harness: ledger read == get-balance", { token, p, fast, slow });
  return fast;
};

export const deploy = (name: string, src: string) => {
  const r: any = simnet.deployContract(name, src, { clarityVersion: 3 }, accounts().deployer).result;
  inv(r.type === "true", "fixture-deploy", name);
};

/** fee = max(1, floor(amount * bps / 10000)) -- the formula every target uses. */
export const feeOf = (amount: bigint, bps: bigint) => {
  const raw = (amount * bps) / 10000n;
  return raw > 0n ? raw : 1n;
};

/** Expect a result: `true` = ok, a bigint = that err code. */
export function expectRes(r: Res, want: true | bigint, name: string, ctx?: unknown) {
  if (want === true) inv(r.ok, name, { want: "ok", got: r.code, ctx });
  else inv(!r.ok && r.code === want, name, { want: `err u${want}`, got: r.ok ? `ok ${json(r.val)}` : `err u${r.code}`, ctx });
}

// ------------------------------------------------------------ arbitraries

/** Amounts biased toward edge sizes: dust, mid, and large. */
export const amountArb = fc.oneof(
  { arbitrary: fc.bigInt(1n, 10n), weight: 2 },
  { arbitrary: fc.bigInt(11n, 1_000_000n), weight: 3 },
  { arbitrary: fc.bigInt(1_000_001n, 50_000_000_000n), weight: 3 },
);
export const whoArb = fc.integer({ min: 0, max: 2 });
/** Percent of something (balance / shares); >100 deliberately exceeds it. */
export const pctArb = fc.oneof(fc.constantFrom(0, 1, 50, 100, 101), fc.integer({ min: 1, max: 120 }));
export const pctOf = (x: bigint, pct: number) => (x * BigInt(pct)) / 100n;

// ------------------------------------------------------------- coverage

/**
 * Outcome tally across all runs of one property. A random suite that never
 * reaches a path proves nothing about it, so each property ends by requiring
 * that its interesting outcomes actually occurred (non-vacuity check).
 */
export class Coverage {
  counts = new Map<string, number>();
  hit(key: string) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  require(label: string, keys: string[]) {
    const summary = [...this.counts.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ");
    if (process.env.FC_VERBOSE) process.stderr.write(`[coverage ${label}] ${summary}\n`);
    const missing = keys.filter((k) => !this.counts.get(k));
    inv(missing.length === 0, `non-vacuity: ${label} never reached`, { missing, summary });
  }
}
