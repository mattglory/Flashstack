import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  ALLOW_MODE_ANNOTATION,
  assertSigner,
  broadcastGate,
  loadMnemonic,
  resolveNetwork,
  sendOrDryRun,
  stopIfDryRun,
  DryRunStop,
  // @ts-expect-error — plain .mjs helper, no types
} from "../scripts/lib/safe-signer.mjs";

/**
 * R-03: mainnet operator scripts encouraged key exposure (inline mnemonics,
 * plaintext ./mbegu seed files) and broadcast by default.
 *
 * Two halves. The unit tests pin scripts/lib/safe-signer.mjs, weighted toward
 * the dangerous direction: a gate that refuses something valid costs a
 * re-type, a gate that opens when it shouldn't broadcasts on mainnet.
 *
 * The static scan reads every scripts/**\/*.mjs as TEXT and never imports one:
 * most of them load a key or sign at top level, and running them is exactly
 * what this file must never do.
 */

const ROOT = join(__dirname, "..");
const SCRIPTS = join(ROOT, "scripts");
const LIB = "scripts/lib/safe-signer.mjs";

describe("resolveNetwork — no implicit network", () => {
  it("accepts exactly mainnet and testnet", () => {
    expect(resolveNetwork({ NETWORK: "mainnet" })).toBe("mainnet");
    expect(resolveNetwork({ NETWORK: "testnet" })).toBe("testnet");
  });
  it("throws on anything else rather than defaulting", () => {
    for (const v of [undefined, "", "Mainnet", "MAINNET", " mainnet", "devnet", "main"]) {
      expect(() => resolveNetwork(v === undefined ? {} : { NETWORK: v }), String(v)).toThrow(/NETWORK must be set explicitly/);
    }
  });
});

describe("broadcastGate — dry run unless explicitly opened", () => {
  const yes = ["node", "x.mjs", "--yes-mainnet"];
  const no = ["node", "x.mjs"];

  it("mainnet broadcasts only with EXECUTE=true AND --yes-mainnet", () => {
    expect(broadcastGate({ network: "mainnet", argv: yes, env: { EXECUTE: "true" } }).broadcast).toBe(true);
  });
  it("mainnet stays a dry run for every partial or misspelled opening", () => {
    const cases: [string, string[], Record<string, string>][] = [
    ["EXECUTE=true, no flag", no, { EXECUTE: "true" }],
    ["flag, no EXECUTE", yes, {}],
    ["flag, EXECUTE=1", yes, { EXECUTE: "1" }],
    ["flag, EXECUTE=TRUE", yes, { EXECUTE: "TRUE" }],
    ["flag, EXECUTE=yes", yes, { EXECUTE: "yes" }],
    ["neither", no, {}],
    ["DRY_RUN=0 does not open it", yes, { DRY_RUN: "0" }],
    ["flag spelled --yes-mainnet=1", ["node", "x", "--yes-mainnet=1"], { EXECUTE: "true" }],
    ["flag spelled --yes", ["node", "x", "--yes"], { EXECUTE: "true" }],
    ];
    for (const [label, argv, env] of cases) {
      const g = broadcastGate({ network: "mainnet", argv, env });
      expect(g.broadcast, label).toBe(false);
      expect(g.reason, label).toMatch(/dry run/);
    }
  });
  it("testnet broadcasts with EXECUTE=true, flag not needed", () => {
    expect(broadcastGate({ network: "testnet", argv: no, env: { EXECUTE: "true" } }).broadcast).toBe(true);
  });
  it("testnet is a dry run by default, and --yes-mainnet alone does not open it", () => {
    expect(broadcastGate({ network: "testnet", argv: no, env: {} }).broadcast).toBe(false);
    expect(broadcastGate({ network: "testnet", argv: yes, env: {} }).broadcast).toBe(false);
  });
  it("throws on an unknown network instead of picking one", () => {
    for (const network of [undefined, "", "Mainnet", "devnet"]) {
      expect(() => broadcastGate({ network, argv: yes, env: { EXECUTE: "true" } }), String(network)).toThrow(/unknown network/);
    }
  });
  it("always returns a reason", () => {
    for (const network of ["mainnet", "testnet"]) {
      for (const env of [{}, { EXECUTE: "true" }]) {
        for (const argv of [yes, no]) {
          expect(typeof broadcastGate({ network, argv, env }).reason).toBe("string");
        }
      }
    }
  });
});

describe("assertSigner", () => {
  const A = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG";
  const B = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
  it("passes on an exact match", () => {
    expect(assertSigner(A, A)).toBe(A);
  });
  it("throws on a mismatch, naming both addresses", () => {
    expect(() => assertSigner(B, A)).toThrow(new RegExp(`${B}.*${A}`));
  });
  it("is exact: no case folding, no trimming", () => {
    expect(() => assertSigner(A.toLowerCase(), A)).toThrow();
    expect(() => assertSigner(` ${A}`, A)).toThrow();
  });
  it("throws when an address is missing", () => {
    for (const [d, e] of [[undefined, A], [A, undefined], ["", ""], [null, null]]) {
      expect(() => assertSigner(d, e)).toThrow();
    }
  });
});

describe("loadMnemonic — env or hidden prompt, never a file", () => {
  const words = "abandon ability able about above absent absorb abstract absurd abuse access accident";
  const noPrompt = async () => { throw new Error("prompt must not be called"); };

  it("reads the named env var and normalises whitespace", async () => {
    await expect(loadMnemonic("X_MNEMONIC", { env: { X_MNEMONIC: `  ${words.replace(/ /g, "  \n")} ` }, isTTY: false, prompt: noPrompt }))
      .resolves.toBe(words);
  });
  it("reads only the named variable", async () => {
    await expect(loadMnemonic("X_MNEMONIC", { env: { MAINNET_MNEMONIC: words }, isTTY: false, prompt: noPrompt }))
      .rejects.toThrow(/X_MNEMONIC is not set/);
  });
  it("throws with the read -rs hint when unset and stdin is not a TTY", async () => {
    await expect(loadMnemonic("X_MNEMONIC", { env: {}, isTTY: false, prompt: noPrompt }))
      .rejects.toThrow(/read -rs X_MNEMONIC && export X_MNEMONIC/);
  });
  it("treats an empty or whitespace-only value as unset", async () => {
    await expect(loadMnemonic("X_MNEMONIC", { env: { X_MNEMONIC: "   " }, isTTY: false, prompt: noPrompt }))
      .rejects.toThrow(/not set/);
  });
  it("prompts (hidden) when unset and stdin is a TTY", async () => {
    let asked = "";
    const prompt = async (q: string) => { asked = q; return words; };
    await expect(loadMnemonic("X_MNEMONIC", { env: {}, isTTY: true, prompt })).resolves.toBe(words);
    expect(asked).toMatch(/X_MNEMONIC.*hidden/);
  });
  it("throws if the prompt returns nothing", async () => {
    await expect(loadMnemonic("X_MNEMONIC", { env: {}, isTTY: true, prompt: async () => "" })).rejects.toThrow(/empty/);
  });
  it("requires an env var name", async () => {
    await expect(loadMnemonic(undefined as any, { env: {}, isTTY: false })).rejects.toThrow(/envName/);
  });
  it("does not touch the filesystem (no fs import in the lib)", () => {
    const src = readFileSync(join(ROOT, LIB), "utf8");
    expect(src).not.toMatch(/from\s+["'](node:)?fs["']|require\(["'](node:)?fs["']\)|readFileSync/);
  });
});

describe("sendOrDryRun / stopIfDryRun", () => {
  const tx = { txid: () => "abc123" };
  const closed = { broadcast: false, reason: "dry run" };
  const open = { broadcast: true, reason: "go" };

  it("never calls send when the gate is closed, returns null", async () => {
    let sent = false;
    await expect(sendOrDryRun(closed, tx, async () => { sent = true; return "x"; })).resolves.toBeNull();
    expect(sent).toBe(false);
  });
  it("treats a truthy-but-not-true broadcast as closed", async () => {
    let sent = false;
    await sendOrDryRun({ broadcast: "true" } as any, tx, async () => { sent = true; });
    await sendOrDryRun(undefined as any, tx, async () => { sent = true; });
    expect(sent).toBe(false);
  });
  it("calls send when the gate is open", async () => {
    await expect(sendOrDryRun(open, tx, async () => "txid-1")).resolves.toBe("txid-1");
  });
  it("stopIfDryRun throws DryRunStop when closed and returns when open", async () => {
    await expect(stopIfDryRun(closed, tx, "deploy")).rejects.toBeInstanceOf(DryRunStop);
    await expect(stopIfDryRun(open, tx, "deploy")).resolves.toBeUndefined();
  });
});

// ── Static scan ────────────────────────────────────────────────────────────

function listMjs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listMjs(p));
    else if (name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

const FILES = listMjs(SCRIPTS).map((p) => ({ rel: relative(ROOT, p), src: readFileSync(p, "utf8") }));

/** Pure rule check over one file's text; exported shape so the rules themselves are testable. */
function violations(rel: string, src: string): string[] {
  const out: string[] = [];
  const isLib = rel === LIB;
  const lines = src.split("\n");

  // 1. plaintext seed-file fallback
  lines.forEach((l, i) => { if (/mbegu/i.test(l)) out.push(`${rel}:${i + 1}: references mbegu (plaintext seed file)`); });

  // 2. inline mnemonic on a command line: VAR_MNEMONIC="..." / $env:VAR_MNEMONIC="..." / VAR_MNEMONIC=...
  lines.forEach((l, i) => {
    if (/\b[A-Z0-9_]*MNEMONIC[A-Z0-9_]*=(?!=)\S/.test(l)) out.push(`${rel}:${i + 1}: inline mnemonic assignment in usage text`);
  });

  // 3. keys read straight from the env instead of loadMnemonic()
  if (!isLib) {
    lines.forEach((l, i) => {
      if (/process\.env(\.|\[\s*["'])[A-Z0-9_]*MNEMONIC/.test(l)) out.push(`${rel}:${i + 1}: reads a mnemonic from process.env directly; use loadMnemonic()`);
    });
  }

  // 4. any broadcast sink must go through broadcastGate
  const sinks = /broadcastTransaction\s*\(|\/v2\/transactions\b/;
  if (!isLib && sinks.test(src) && !/\bbroadcastGate\s*\(/.test(src)) {
    out.push(`${rel}: broadcasts (broadcastTransaction or POST /v2/transactions) without broadcastGate()`);
  }
  // 4b. anything that signs must also be gated (a signed tx can be relayed by other means)
  if (!isLib && /\b(makeContractCall|makeContractDeploy|makeSTXTokenTransfer)\s*\(/.test(src) && !/\bbroadcastGate\s*\(/.test(src)) {
    out.push(`${rel}: builds signed transactions without broadcastGate()`);
  }

  // 5. Allow mode needs the annotation on the line directly above
  lines.forEach((l, i) => {
    if (/PostConditionMode\s*\.\s*Allow\b|PostConditionMode\s*\[\s*["']Allow["']\s*\]|postConditionMode\s*:\s*["']allow["']/i.test(l)) {
      const prev = lines[i - 1] ?? "";
      if (!prev.includes(ALLOW_MODE_ANNOTATION) || !new RegExp(`${ALLOW_MODE_ANNOTATION}\\s+\\S`).test(prev)) {
        out.push(`${rel}:${i + 1}: PostConditionMode.Allow without "${ALLOW_MODE_ANNOTATION} <reason>" on the preceding line`);
      }
    }
  });

  // 6. implicit mainnet default
  lines.forEach((l, i) => {
    if (
      /(\?\?|\|\|)\s*["'`]mainnet["'`]/.test(l) ||
      /(\?\?|\|\|)\s*STACKS_MAINNET\b/.test(l) ||
      /["'`]testnet["'`]\s*\?\s*[\w.]+\s*:\s*STACKS_MAINNET\b/.test(l)
    ) out.push(`${rel}:${i + 1}: defaults the network to mainnet`);
  });

  return out;
}

describe("static scan of scripts/**/*.mjs (text only, nothing is executed)", () => {
  it("finds the scripts and the lib", () => {
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((f) => f.rel === LIB)).toBe(true);
  });

  // One test over every file (not one per file): tests/setup.ts re-inits simnet
  // before EACH test, so per-file cases would add ~1s apiece for nothing.
  it("every script follows the safe-signer rules", () => {
    const all = FILES.flatMap((f) => violations(f.rel, f.src));
    expect(all).toEqual([]);
  });

  // The rules themselves, so a regex that silently stops matching is caught here.
  describe("rule self-check", () => {
    const f = "scripts/x.mjs";
    const gated = 'broadcastGate({ network: "mainnet" });\n';
    it("flags every kind of violation", () => {
      const cases: [string, string][] = [
      ["mbegu", gated + 'if (existsSync("mbegu2")) {}'],
      ["inline bash mnemonic", gated + ' *   DEPLOYER_MNEMONIC="w1 w2" node x.mjs'],
      ["inline PowerShell mnemonic", gated + ' *   $env:DEPLOYER_MNEMONIC="w1"; node x.mjs'],
      ["raw env read", gated + "const M = process.env.DEPLOYER_MNEMONIC;"],
      ["ungated broadcastTransaction", "await broadcastTransaction({ transaction: tx });"],
      ["ungated raw POST", 'await fetch(`${API}/v2/transactions`, { method: "POST" });'],
      ["ungated signing", "await makeContractCall({});"],
      ["unannotated Allow", gated + "  postConditionMode: PostConditionMode.Allow,"],
      ["annotation with no reason", gated + "  // safe-signer: allow-mode\n  postConditionMode: PostConditionMode.Allow,"],
      ["annotation not on the preceding line", gated + "  // safe-signer: allow-mode reason\n\n  postConditionMode: PostConditionMode.Allow,"],
      ["string allow mode", gated + '  postConditionMode: "allow",'],
      ["?? mainnet", gated + 'const NET = process.env.NETWORK ?? "mainnet";'],
      ["|| mainnet", gated + "const NET = process.env.NETWORK || 'mainnet';"],
      ["ternary to mainnet", gated + 'const network = NET === "testnet" ? STACKS_TESTNET : STACKS_MAINNET;'],
      ];
      for (const [label, src] of cases) expect(violations(f, src).length, label).toBeGreaterThan(0);
    });
    it("accepts an annotated Allow and a gated broadcast", () => {
      const src = gated + "  // safe-signer: allow-mode flash loan moves STX\n  postConditionMode: PostConditionMode.Allow,\n await broadcastTransaction({});";
      expect(violations(f, src)).toEqual([]);
    });
  });
});
