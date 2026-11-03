/**
 * safe-signer: the one place operator scripts get a key, decide whether to
 * broadcast, and pick a network (risk R-03).
 *
 * House rules every signing script under scripts/ follows, and that
 * tests/script-safety.test.ts enforces by static scan:
 *
 *   1. Keys come from an environment variable only, or a hidden TTY prompt.
 *      Never from a file (no plaintext seed-file fallback), never typed inline on the
 *      command line (that lands in shell history and /proc/<pid>/environ of
 *      every child). Load the variable first, without echo:
 *
 *        read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC
 *
 *   2. Dry run is the default. Broadcasting needs EXECUTE=true, and on mainnet
 *      ALSO the `--yes-mainnet` argv flag. A dry run builds and signs the tx
 *      locally and prints its summary; nothing is sent.
 *
 *   3. No implicit network. A script that can target either chain must be
 *      given NETWORK=mainnet|testnet explicitly.
 *
 *   4. PostConditionMode.Deny unless the call legitimately moves assets
 *      without declared post-conditions. Every Allow must sit directly under
 *      a `// safe-signer: allow-mode <reason>` comment.
 *
 * Everything here except promptHidden() is pure and takes its inputs as
 * arguments, so it can be unit-tested without a key or a network.
 */

/** The comment that must sit on the line directly above any Allow mode. */
export const ALLOW_MODE_ANNOTATION = "// safe-signer: allow-mode";

const NETWORKS = new Set(["mainnet", "testnet"]);

/**
 * Resolve the target network from NETWORK. No default: a missing or unknown
 * value throws, so nothing ends up on mainnet because a variable was unset.
 */
export function resolveNetwork(env = process.env) {
  const v = env.NETWORK;
  if (!NETWORKS.has(v)) {
    throw new Error(
      `NETWORK must be set explicitly to "mainnet" or "testnet" (got ${v === undefined ? "nothing" : JSON.stringify(v)}). There is no default.`,
    );
  }
  return v;
}

/**
 * Decide whether this run may broadcast. Returns { broadcast, reason }.
 *   mainnet: EXECUTE=true AND --yes-mainnet in argv
 *   testnet: EXECUTE=true
 * Anything else is a dry run.
 */
export function broadcastGate({ network, argv = process.argv, env = process.env }) {
  if (!NETWORKS.has(network)) {
    throw new Error(`broadcastGate: unknown network ${JSON.stringify(network)}`);
  }
  const execute = env.EXECUTE === "true";
  const yes = argv.includes("--yes-mainnet");
  if (network === "mainnet") {
    if (execute && yes) return { broadcast: true, reason: "mainnet: EXECUTE=true and --yes-mainnet given" };
    if (execute) return { broadcast: false, reason: "dry run: mainnet also needs the --yes-mainnet flag" };
    return { broadcast: false, reason: "dry run: set EXECUTE=true and pass --yes-mainnet to broadcast on mainnet" };
  }
  if (execute) return { broadcast: true, reason: "testnet: EXECUTE=true given" };
  return { broadcast: false, reason: "dry run: set EXECUTE=true to broadcast on testnet" };
}

/** Throw unless the address derived from the loaded key is the expected one. */
export function assertSigner(derived, expected) {
  if (!derived || !expected) {
    throw new Error(`assertSigner: both addresses are required (derived=${derived}, expected=${expected})`);
  }
  if (derived !== expected) {
    throw new Error(
      `Signer mismatch: the loaded key derives ${derived}, but this script must be signed by ${expected}. Load the right key.`,
    );
  }
  return derived;
}

/**
 * Read a mnemonic from env[envName]. If it is not set and stdin is a TTY,
 * prompt for it without echo. Never reads a file. Throws otherwise.
 * `isTTY` and `prompt` are injectable for tests.
 */
export async function loadMnemonic(envName, {
  env = process.env,
  isTTY = Boolean(process.stdin.isTTY),
  prompt = promptHidden,
} = {}) {
  if (!envName) throw new Error("loadMnemonic: envName is required");
  let value = env[envName];
  if (value === undefined || value.trim() === "") {
    if (!isTTY) {
      throw new Error(
        `${envName} is not set and stdin is not a TTY to prompt on. Load it without echo first:\n` +
        `  read -rs ${envName} && export ${envName}`,
      );
    }
    value = await prompt(`${envName} (input hidden): `);
  }
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error(`${envName} is empty`);
  return words.join(" ");
}

/** Prompt on the TTY with echo off. Not unit-tested (needs a real TTY). */
export function promptHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("promptHidden: stdin is not a TTY"));
      return;
    }
    output.write(question);
    let buf = "";
    const done = (err) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      if (err) reject(err); else resolve(buf);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done();
        if (ch === "\u0003") return done(new Error("aborted"));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** One-line description of the gate for a script's header. */
export function describeGate(gate) {
  return gate.broadcast ? `LIVE — WILL BROADCAST (${gate.reason})` : `DRY RUN, nothing broadcast (${gate.reason})`;
}

/**
 * Broadcast `tx` with the script's own `send(tx)` if the gate allows it;
 * otherwise print what would have been sent and return null. Callers treat
 * null as "not sent" and skip anything that waits on a txid.
 */
export async function sendOrDryRun(gate, tx, send, label = "tx") {
  if (gate?.broadcast === true) return send(tx);
  let txid = "(unavailable)";
  try { txid = tx.txid(); } catch { /* summary is best-effort */ }
  console.log(`  [dry run] would broadcast ${label}: txid ${txid} (signed locally, NOT sent)`);
  return null;
}

/** Thrown by stopIfDryRun; a script's top-level catch exits 0 on it. */
export class DryRunStop extends Error {
  constructor(label) {
    super(`dry run: stopped before broadcasting ${label}`);
    this.name = "DryRunStop";
  }
}

/**
 * For multi-step scripts whose later steps read on-chain state the earlier
 * ones create: in a dry run, print the first tx and stop the whole run there
 * (throws DryRunStop), rather than carrying on against a chain that never
 * saw it. Returns normally when the gate is open.
 */
export async function stopIfDryRun(gate, tx, label = "tx") {
  if (gate?.broadcast === true) return;
  await sendOrDryRun(gate, tx, label);
  console.log("  [dry run] later steps depend on this tx confirming on chain, so the run stops here.");
  throw new DryRunStop(label);
}
