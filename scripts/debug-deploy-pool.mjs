/**
 * Debug deploy — posts tx bytes directly to /v2/transactions
 * so we can see the raw API response instead of "unable to parse node response"
 */

import { makeContractDeploy, PostConditionMode, ClarityVersion } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

const MNEMONIC  = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API       = "https://api.hiro.so";

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;

async function deployRaw(pk, nonce, name, path) {
  const source = readFileSync(path, "utf8");
  console.log(`  Source length: ${source.length} bytes`);

  const tx = await makeContractDeploy({
    contractName:      name,
    codeBody:          source,
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               1_000_000,
    clarityVersion:    ClarityVersion.Clarity3,
  });

  const txBytes = tx.serialize();
  const txHexLen = typeof txBytes === "string" ? txBytes.length : txBytes.length * 2;
  console.log(`  Serialized tx length: ${txHexLen / 2} bytes (${txHexLen} hex chars)`);

  // Post exactly like broadcastTransaction does: JSON body with hex tx
  const txHex = typeof txBytes === "string" ? txBytes : Buffer.from(txBytes).toString("hex");
  const resp = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ tx: txHex }),
  });

  const text = await resp.text();
  console.log(`  HTTP status: ${resp.status}`);
  console.log(`  Raw response: ${text}`);

  try {
    const json = JSON.parse(text);
    if (json.error) {
      console.error(`  ERROR: ${json.error} — ${json.reason}`);
      if (json.reason_data) console.error(`  Reason data: ${JSON.stringify(json.reason_data)}`);
      return null;
    }
    // txid is a bare hex string on success
    const txid = typeof json === "string" ? json : json.txid ?? json;
    console.log(`  txid: ${txid}`);
    return txid;
  } catch {
    console.error("  Response was not JSON — shown raw above");
    return null;
  }
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  const res = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  let nonce  = res.nonce;
  const bal  = parseInt(res.balance, 16) / 1e6;
  console.log(`Balance: ${bal.toFixed(3)} STX, Nonce: ${nonce}\n`);

  // Pool only (arkadiko-liquidation-receiver already deployed at nonce 21)
  console.log("--- flashstack-stx-pool ---");
  await deployRaw(pk, nonce, "flashstack-stx-pool", "contracts/flashstack-stx-pool.clar");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
