/**
 * Deploy the hardened v2 LP pools (F-1 fix: virtual shares/assets).
 *
 * DRY-RUN BY DEFAULT — prints the plan and broadcasts nothing.
 * To actually deploy, pass BOTH:  EXECUTE=true  and  --yes-mainnet
 *
 * Usage (DEPLOYER_MNEMONIC = the SECURE wallet, SPR9PQ…; load it without echo):
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC
 *   node scripts/deploy-pool-v2.mjs                                 # dry run
 *   EXECUTE=true node scripts/deploy-pool-v2.mjs --yes-mainnet      # live deploy
 *
 * Deploys under whichever wallet signs. It REFUSES to deploy under the
 * compromised SP20XD46… namespace — the v2 pools must live under the secure
 * post-rotation wallet.
 */

import { makeContractDeploy, broadcastTransaction, ClarityVersion, PostConditionMode, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate } from "./lib/safe-signer.mjs";
import { readFileSync } from "fs";

const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const COMPROMISED = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5"; // exposed key — do NOT deploy here

// Deploy the DEPLOYABLE sources (mainnet trait refs), not the localized test copies.
// Order matters: the oracle references the STX pool, so the pool deploys first.
const CONTRACTS = [
  { name: "flashstack-stx-pool-v2",  path: "contracts/flashstack-stx-pool-v2.clar"  },
  { name: "flashstack-sbtc-pool-v2", path: "contracts/flashstack-sbtc-pool-v2.clar" },
  { name: "flashstack-pool-oracle-v2", path: "contracts/flashstack-pool-oracle-v2.clar" },
];

const MNEMONIC = await loadMnemonic("DEPLOYER_MNEMONIC");
const GATE     = broadcastGate({ network: "mainnet" }); // mainnet-only script
const EXECUTE  = GATE.broadcast;
const FEE      = BigInt(process.env.FEE ?? "3000000"); // 3 STX default per deploy; override with FEE=…


async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const sender = privateKeyToAddress(pk, "mainnet");

  const acct  = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  let   nonce = acct.nonce;

  console.log("==========================================================");
  console.log("  FlashStack — Deploy hardened v2 LP pools (F-1 fix)");
  console.log("==========================================================");
  console.log(`  Mode:     ${EXECUTE ? "LIVE — WILL BROADCAST" : "DRY RUN (nothing broadcast)"}`);
  console.log(`  Deployer: ${sender}`);
  console.log(`  Balance:  ${bal.toFixed(3)} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log(`  Fee/tx:   ${(Number(FEE) / 1e6).toFixed(3)} STX`);
  console.log();

  // Hard guard: never deploy under the compromised namespace.
  if (sender === COMPROMISED) {
    console.error("  ✗ ABORT: this is the COMPROMISED SP20XD46 wallet. Deploy the v2 pools");
    console.error("           under the SECURE post-rotation wallet (SPR9PQ…) instead.");
    process.exit(1);
  }

  const need = (Number(FEE) / 1e6) * CONTRACTS.length + 0.5;
  if (bal < need) {
    console.error(`  ✗ Insufficient balance: need ~${need.toFixed(2)} STX for ${CONTRACTS.length} deploys.`);
    process.exit(1);
  }

  for (const c of CONTRACTS) {
    const source = readFileSync(c.path, "utf8");
    const kb = (Buffer.byteLength(source, "utf8") / 1024).toFixed(1);
    console.log(`  • ${sender}.${c.name}   (${kb} KB, nonce ${nonce})`);

    if (!EXECUTE) { nonce++; continue; }

    const tx = await makeContractDeploy({
      contractName:   c.name,
      codeBody:       source,
      senderKey:      pk,
      network:        STACKS_MAINNET,
      clarityVersion: ClarityVersion.Clarity3,
      postConditionMode: PostConditionMode.Deny,
      fee:            FEE,
      nonce,
    });
    const res = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
    if (res.error) {
      console.error(`    ✗ broadcast failed: ${res.error} ${res.reason ?? ""}`);
      process.exit(1);
    }
    console.log(`    ✓ ${EXPLORER}/0x${res.txid}?chain=mainnet`);
    nonce++;
  }

  console.log();
  if (!EXECUTE) {
    console.log("  Dry run complete. Re-run with EXECUTE=true --yes-mainnet to broadcast.");
    console.log("  Then follow docs/04-deployment/POOL_V2_DEPLOYMENT.md for post-deploy steps.");
  } else {
    console.log("  Deploys broadcast. Wait for confirmation, then run the post-deploy checklist:");
    console.log("  docs/04-deployment/POOL_V2_DEPLOYMENT.md");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
