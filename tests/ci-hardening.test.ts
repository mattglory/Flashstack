// Regression guard for CI supply-chain hardening (assessment R-11).
//
// Pins the three properties a future workflow edit could silently drop:
//   1. every third-party action is pinned to a full 40-hex commit SHA, not a tag;
//   2. every workflow declares a top-level `permissions:` block (least privilege);
//   3. every binary downloaded with curl is verified with sha256sum before use.
// Plus: Dependabot tracks the github-actions ecosystem, since SHA pins don't update themselves.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WF_DIR = ".github/workflows";
const workflows = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => ({ file: f, text: readFileSync(join(WF_DIR, f), "utf-8") }));

describe("CI supply-chain hardening", () => {
  it("finds the workflows", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  for (const { file, text } of workflows) {
    it(`${file}: every action is pinned to a commit SHA`, () => {
      const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
      expect(uses.length).toBeGreaterThan(0);
      // Local actions (./path) and docker:// images are out of scope for this check.
      const unpinned = uses.filter(
        (u) => !u.startsWith("./") && !u.startsWith("docker://") && !/@[0-9a-f]{40}$/.test(u),
      );
      expect(unpinned).toEqual([]);
    });

    it(`${file}: declares top-level least-privilege permissions`, () => {
      // A top-level key starts in column 0.
      expect(text).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    });

    it(`${file}: every curl download is checksum-verified`, () => {
      const downloads = (text.match(/curl\s[^\n]*-o\s+(\S+)/g) ?? []).length;
      const verifications = (text.match(/sha256sum\s+-c/g) ?? []).length;
      expect(verifications).toBeGreaterThanOrEqual(downloads);
    });
  }

  it("dependabot updates github-actions", () => {
    const dep = readFileSync(".github/dependabot.yml", "utf-8");
    expect(dep).toMatch(/package-ecosystem:\s*"?github-actions"?/);
  });

  it("node version has a single source of truth used by every setup-node step", () => {
    const nvmrc = readFileSync(".nvmrc", "utf-8").trim();
    expect(nvmrc).toMatch(/^\d+$/);
    for (const { file, text } of workflows) {
      const setups = (text.match(/uses:\s*actions\/setup-node@/g) ?? []).length;
      const viaFile = (text.match(/node-version-file:\s*\.nvmrc/g) ?? []).length;
      expect(viaFile, file).toBe(setups);
    }
  });
});
