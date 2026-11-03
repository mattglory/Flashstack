/**
 * Freeze the OLD, vulnerable v1 LP pools now that the hardened v2 pools are live.
 * Calls set-paused(true) on the SP20XD46 v1 pools so no one can deposit into the
 * version with the first-depositor / donation inflation issue (F-1).
 *
 * Only the POOLS are paused — NOT the cores (they use the reserve model, are not
 * affected by F-1, and the DeepStack flywheel runs through the core).
 *
 * DRY-RUN BY DEFAULT. To broadcast, pass BOTH:  EXECUTE=true  and  --yes-mainnet
 *
 * Usage:
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC   # hidden input; never type it inline
 *   node scripts/pause-v1-pools.mjs                 # dry run
 *   EXECUTE=true node scripts/pause-v1-pools.mjs --yes-mainnet       # live
 *
 * Must be signed by the pools' admin (SPR9PQ… after the 2026-06-12 rotation);
 * otherwise the calls fail with ERR-NOT-ADMIN.
 */

import { makeContractCall, broadcastTransaction, Cl, PostConditionMode, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, assertSigner } from "./lib/safe-signer.mjs";

const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const ADMIN    = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG"; // expected signer (pool admin)
const V1       = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";

const POOLS = [
  { address: V1, name: "flashstack-stx-pool" },
  { address: V1, name: "flashstack-sbtc-pool" },
];

const MNEMONIC = await loadMnemonic("DEPLOYER_MNEMONIC");
const GATE     = broadcastGate({ network: "mainnet" }); // mainnet-only script
const EXECUTE  = GATE.broadcast;
const FEE      = BigInt(process.env.FEE ?? "50000"); // 0.05 STX default; override with FEE=…


async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const sender = privateKeyToAddress(pk, "mainnet");

  const acct  = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  let   nonce = acct.nonce;

  console.log("==========================================================");
  console.log("  FlashStack — Pause the v1 LP pools (deprecate)");
  console.log("==========================================================");
  console.log(`  Mode:     ${EXECUTE ? "LIVE — WILL BROADCAST" : "DRY RUN (nothing broadcast)"}`);
  console.log(`  Signer:   ${sender}`);
  console.log(`  Balance:  ${bal.toFixed(3)} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log();

  if (sender !== ADMIN) {
    console.error(`  ⚠ WARNING: signer is not the expected admin (${ADMIN}).`);
    console.error(`    set-paused will fail with ERR-NOT-ADMIN unless this wallet is the pool admin.`);
    if (EXECUTE) assertSigner(sender, ADMIN); // throws: never broadcast from the wrong key
  }

  for (const p of POOLS) {
    console.log(`  • set-paused(true) → ${p.address}.${p.name}   (nonce ${nonce})`);

    if (!EXECUTE) { nonce++; continue; }

    const tx = await makeContractCall({
      contractAddress:   p.address,
      contractName:      p.name,
      functionName:      "set-paused",
      functionArgs:      [Cl.bool(true)],
      senderKey:         pk,
      network:           STACKS_MAINNET,
      postConditionMode: PostConditionMode.Deny,
      fee:               FEE,
      nonce,
    });
    const res = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
    if (res.error) { console.error(`    ✗ ${res.error} ${res.reason ?? ""}`); process.exit(1); }
    console.log(`    ✓ ${EXPLORER}/0x${res.txid}?chain=mainnet`);
    nonce++;
  }

  console.log();
  console.log(EXECUTE
    ? "  Broadcast. Once confirmed, the v1 pools reject new deposits (withdrawals stay open)."
    : "  Dry run complete. Re-run with EXECUTE=true --yes-mainnet to broadcast.");
}

main().catch((e) => { console.error(e); process.exit(1); });
