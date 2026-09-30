import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * D7 (docs/security/CONTRACT_INVENTORY.md §5): these are VERBATIM copies of
 * immutable contracts deployed at SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ. They
 * were checked byte-for-byte against the deployed source on 2026-09-21.
 *
 * A repo copy of an immutable contract can only ever be wrong by changing, which is
 * exactly how F-7 happened: a file described as a copy of the deployed contract was
 * edited and the tests spent weeks proving things about a contract that does not
 * exist on mainnet. These contracts contain mock placeholders and a no-op
 * `remove-vault` stub that look tempting to "fix". Fixing them here would only
 * create drift from what is on chain. If a change is ever legitimate, it is a new
 * contract under a new name, not an edit to these files.
 *
 * ajv.2.4 (axis 2 — repo copy vs deployed mainnet source): the same mechanism now
 * also pins flashstack-stx-core and flashstack-sbtc-core, the two P0 live cores
 * reviewed under ajv.4.3, checked byte-for-byte against SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5
 * on 2026-10-01. A live-fetch CI job was deliberately not built — it would make the
 * merge gate depend on a third-party API and network access, which needs its own
 * decision (blocking gate vs scheduled job). This offline pin catches the same
 * drift — any edit to these files — for zero network cost; re-running the curl
 * below against mainnet is still how the pin itself gets re-verified.
 *
 * Offline on purpose. To re-verify against the chain (principal varies by pin,
 * see each entry above):
 *   curl -s https://api.hiro.so/v2/contracts/source/<principal>/<name> \
 *     | jq -j .source | shasum -a 256
 * (-j: no trailing newline; the API returns the source without one.)
 * *.clar is forced to LF by .gitattributes, so the hash is stable across checkouts.
 */
const PINS = [
  {
    file: "contracts/snp-flashstack-receiver.clar",
    principal: "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ",
    bytes: 3270,
    sha256: "0722955560dbd791d5c3a29c84e1787e4a250df88db5ece6d27be768a0b920ea",
  },
  {
    file: "contracts/snp-flashstack-receiver-v3.clar",
    principal: "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ",
    bytes: 5396,
    sha256: "2560814d0e0103d2e8fcb337fc560cdbc5c39215828b81606712ab82ffb3fdec",
  },
  {
    file: "contracts/flashstack-stx-core.clar",
    principal: "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5",
    bytes: 6538,
    sha256: "a3c3e99b5a8ed46604fbb47d643d680848e51298244cac2bfedb74e192a091ff",
  },
  {
    file: "contracts/flashstack-sbtc-core.clar",
    principal: "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5",
    bytes: 6801,
    sha256: "f723d2bea72e62bece76d6f2ebe3d7d1a9de707176f41b7bc3b709e8e4f839af",
  },
] as const;

describe("verbatim copies of deployed contracts must not change", () => {
  for (const { file, principal, bytes, sha256 } of PINS) {
    it(`${file} still matches the source deployed at ${principal}`, () => {
      const raw = readFileSync(file, "utf-8").replace(/\r\n/g, "\n");
      expect(Buffer.byteLength(raw), "size changed").toBe(bytes);
      expect(createHash("sha256").update(raw).digest("hex"), "content changed").toBe(sha256);
    });
  }
});
