/**
 * FlashStack — Deploy Zest Flash Liquidation Receiver
 *
 * Deploys zest-liquidation-receiver and whitelists it in both
 * flashstack-stx-core and flashstack-sbtc-core.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/deploy-zest-receiver.mjs
 */

import {
  makeContractDeploy,
  makeContractCall,
  PostConditionMode,
  ClarityVersion,
  Cl,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";

// ── Config ────────────────────────────────────────────────────────────────────

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = process.env.DEPLOYER_ADDRESS ?? "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_MAINNET;

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC environment variable.");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function getNonce() {
  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  const data = await res.json();
  return data.nonce;
}

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") {
      console.log(" confirmed.");
      return data;
    }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "unknown";
      console.log(`\n  FAILED: ${reason}`);
      console.log(`  Tx: ${EXPLORER}/${txid}?chain=mainnet`);
      throw new Error(`"${label}" failed: ${reason}`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}"`);
}

async function broadcast(tx) {
  const raw   = tx.serialize();
  const bytes = typeof raw === "string"
    ? Buffer.from(raw.replace(/^0x/, ""), "hex")
    : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body:    bytes,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Node response not JSON: ${text.slice(0, 200)}`); }
  if (typeof data === "object" && data.error) {
    throw new Error(`${data.error} — ${data.reason ?? ""} ${data.reason_data ? JSON.stringify(data.reason_data) : ""}`);
  }
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  return txid;
}

async function deployContract(privateKey, nonce, name, sourcePath) {
  console.log(`  Deploying ${name}...`);
  const source = readFileSync(sourcePath, "utf8");
  const tx = await makeContractDeploy({
    contractName:      name,
    codeBody:          source,
    senderKey:         privateKey,
    network,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee:               500_000,
    nonce,
  });
  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  return txid;
}

async function whitelistReceiver(privateKey, nonce, coreName, receiverPrincipal) {
  console.log(`  Whitelisting in ${coreName}...`);
  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      coreName,
    functionName:      "add-approved-receiver",
    functionArgs:      [Cl.principal(receiverPrincipal)],
    senderKey:         privateKey,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    fee:               100_000,
    nonce,
  });
  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  return txid;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║    FlashStack — Deploy Zest Liquidation Receiver     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Deployer: ${DEPLOYER}\n`);

  const privateKey = await getPrivateKey();
  let nonce = await getNonce();
  console.log(`  Starting nonce: ${nonce}\n`);

  const CONTRACT_NAME = "zest-liquidation-receiver";
  const CONTRACT_PATH = "contracts/zest-liquidation-receiver.clar";
  const receiverPrincipal = `${DEPLOYER}.${CONTRACT_NAME}`;

  // ── Step 1: Deploy ────────────────────────────────────────────────────────
  console.log("Step 1 — Deploy zest-liquidation-receiver");
  const deployTxid = await deployContract(privateKey, nonce++, CONTRACT_NAME, CONTRACT_PATH);
  await waitForConfirm(deployTxid, "deploy zest-liquidation-receiver");
  console.log();

  // ── Step 2: Whitelist in flashstack-stx-core ──────────────────────────────
  console.log("Step 2 — Whitelist in flashstack-stx-core (modes 1 & 2)");
  const stxWhitelistTxid = await whitelistReceiver(
    privateKey, nonce++,
    "flashstack-stx-core",
    receiverPrincipal,
  );
  await waitForConfirm(stxWhitelistTxid, "whitelist in flashstack-stx-core");
  console.log();

  // ── Step 3: Whitelist in flashstack-sbtc-core ─────────────────────────────
  console.log("Step 3 — Whitelist in flashstack-sbtc-core (modes 3 & 4)");
  const sbtcWhitelistTxid = await whitelistReceiver(
    privateKey, nonce++,
    "flashstack-sbtc-core",
    receiverPrincipal,
  );
  await waitForConfirm(sbtcWhitelistTxid, "whitelist in flashstack-sbtc-core");
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║                DEPLOYMENT COMPLETE                   ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`  Contract:  ${receiverPrincipal}`);
  console.log(`  Deploy:    ${EXPLORER}/${deployTxid}?chain=mainnet`);
  console.log(`  STX wlist: ${EXPLORER}/${stxWhitelistTxid}?chain=mainnet`);
  console.log(`  sBTC wlist:${EXPLORER}/${sbtcWhitelistTxid}?chain=mainnet`);
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Supported modes:                                    ║");
  console.log("║  1 — STX flash → wSTX debt + wSTX collateral         ║");
  console.log("║  2 — STX flash → wSTX debt + sBTC collateral         ║");
  console.log("║  3 — sBTC flash → sBTC debt + sBTC collateral        ║");
  console.log("║  4 — sBTC flash → sBTC debt + wSTX collateral        ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log("║  Next steps:                                         ║");
  console.log("║  1. Send contract address to Zest for whitelisting   ║");
  console.log("║  2. Zest adds to is-approved-contract list           ║");
  console.log("║  3. Test with simulate() read-only before live call  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
}

main().catch(e => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
