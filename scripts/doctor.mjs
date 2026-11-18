#!/usr/bin/env node
// Developer environment check: `npm run doctor`. Read-only, no network, no keys.
//
// Verifies the local toolchain matches CI, so local results mean the same thing
// as CI results. The clarinet version matters most: tests/mainnet-plan-guard.test.ts
// SKIPS its computed-mainnet-plan checks when the local clarinet differs from CI's.
// That check is the D6 guard, and a skip looks like a pass in a quick glance.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const results = [];
const ok = (name, detail) => results.push({ ok: true, name, detail });
const fail = (name, detail, fix) => results.push({ ok: false, name, detail, fix });

// Single sources of truth: .nvmrc for node, the CI download URL + checksum for clarinet.
const testYml = readFileSync(".github/workflows/test.yml", "utf-8");
const ciClarinet = testYml.match(/clarinet\/releases\/download\/v(\d+\.\d+\.\d+)\//)?.[1];
const ciSha = testYml.match(/CLARINET_SHA256:\s*([0-9a-f]{64})/)?.[1];
const nodeMajor = readFileSync(".nvmrc", "utf-8").trim();

// Node
const localNode = process.versions.node;
if (Number(localNode.split(".")[0]) >= Number(nodeMajor)) {
  ok("node", `v${localNode} (CI: ${nodeMajor}.x)`);
} else {
  fail("node", `v${localNode} is older than CI's ${nodeMajor}.x`, `install node ${nodeMajor} (e.g. nvm install ${nodeMajor})`);
}

// Clarinet
const bin = process.env.CLARINET_BIN || "clarinet";
const probe = spawnSync(bin, ["--version"], { encoding: "utf-8" });
const localClarinet = probe.stdout?.match(/clarinet (\d+\.\d+\.\d+)/)?.[1];
if (!ciClarinet) {
  fail("clarinet", "could not read the CI pin from .github/workflows/test.yml", "fix the download URL in test.yml");
} else if (localClarinet === ciClarinet) {
  ok("clarinet", `${localClarinet} (${bin}) matches CI`);
} else {
  const url = `https://github.com/stx-labs/clarinet/releases/download/v${ciClarinet}/clarinet-linux-x64-glibc.tar.gz`;
  fail(
    "clarinet",
    `${localClarinet ?? "not found"} (${bin}); CI uses ${ciClarinet}. The D6 mainnet-plan guard will SKIP locally.`,
    [
      `curl -fsSL ${url} -o clarinet.tar.gz`,
      ciSha ? `echo "${ciSha}  clarinet.tar.gz" | sha256sum -c -` : "(no checksum found in test.yml)",
      "tar -xzf clarinet.tar.gz && install -m 755 clarinet ~/.local/bin/clarinet",
      "(or point CLARINET_BIN at the binary)",
    ].join("\n      "),
  );
}

// Dependencies installed from the lockfiles
for (const dir of [".", "web"]) {
  const lock = `${dir}/package-lock.json`;
  const installed = `${dir}/node_modules/.package-lock.json`;
  if (!existsSync(lock)) continue;
  if (!existsSync(installed)) {
    fail(`deps (${dir})`, "node_modules missing", `cd ${dir} && npm ci`);
    continue;
  }
  const want = JSON.parse(readFileSync(lock, "utf-8")).packages ?? {};
  const have = JSON.parse(readFileSync(installed, "utf-8")).packages ?? {};
  const drift = Object.keys(want).filter((k) => k && have[k] && have[k].version !== want[k].version);
  if (drift.length === 0) ok(`deps (${dir})`, "node_modules matches package-lock.json");
  else fail(`deps (${dir})`, `${drift.length} packages differ from the lockfile (e.g. ${drift[0]})`, `cd ${dir} && npm ci`);
}

for (const r of results) {
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.detail}`);
  if (!r.ok) console.log(`      fix: ${r.fix}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : "\nEnvironment matches CI.");
process.exit(failed ? 1 : 0);
