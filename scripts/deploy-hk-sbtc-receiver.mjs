/**
 * FlashStack -- Deploy hk-sbtc-real-receiver-v1 to mainnet
 *
 * External-developer receiver that runs a REAL Velar sBTC->wSTX->sBTC round-trip
 * inside a flash loan against flashstack-sbtc-core and repays principal + fee
 * atomically. sBTC mirror of the Milestone-1 Bitflow receiver.
 *
 * Deploys from OUR own mainnet wallet (NOT the protocol deployer). The admin-only
 * whitelist call (`add-approved-receiver` on flashstack-sbtc-core) must be done by
 * Matt separately before the receiver can borrow.
 *
 * Usage:
 *   read -rs MAINNET_MNEMONIC && export MAINNET_MNEMONIC   # hidden input; never type it inline
 *   node scripts/deploy-hk-sbtc-receiver.mjs                              # dry run (default)
 *   EXECUTE=true node scripts/deploy-hk-sbtc-receiver.mjs --yes-mainnet   # broadcast
 *
 * Optional env:
 *   EXECUTE=true        Broadcast (mainnet also needs --yes-mainnet). Default: dry run.
 *   DEPLOY_FEE_USTX=...  Override the deploy fee (default 500_000 microSTX = 0.5 STX).
 */

import { makeContractDeploy, PostConditionMode, ClarityVersion, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, describeGate } from "./lib/safe-signer.mjs";
import { readFileSync } from "fs";

const NAME     = "hk-sbtc-real-receiver-v1";
const PATH     = "contracts/hk-sbtc-real-receiver-v1.clar";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const FEE      = Number(process.env.DEPLOY_FEE_USTX ?? 500_000);
const GATE     = broadcastGate({ network: "mainnet" }); // mainnet-only script
const DRY_RUN  = !GATE.broadcast;
const network  = STACKS_MAINNET;

async function getNonce(addr) {
  return (await (await fetch(`${API}/v2/accounts/${addr}?proof=0`)).json()).nonce;
}
async function getBalance(addr) {
  return BigInt((await (await fetch(`${API}/extended/v1/address/${addr}/balances`)).json()).stx.balance);
}
async function broadcast(tx) {
  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${data.error} -- ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`No txid: ${text.slice(0, 200)}`);
  return txid;
}
async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const data = await (await fetch(`${API}/extended/v1/tx/0x${txid}`)).json();
    if (data.tx_status === "success") { console.log(" confirmed."); return; }
    if (data.tx_status?.startsWith("abort")) {
      console.log(`\n  FAILED: ${data.tx_result?.repr ?? "unknown"}`);
      throw new Error(`"${label}" failed`);
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout: "${label}"`);
}

async function main() {
  const mnemonic = await loadMnemonic("MAINNET_MNEMONIC");
  const wc = mnemonic.split(/\s+/).length;
  if (wc !== 24) throw new Error(`Expected 24-word mnemonic, got ${wc} words`);

  const wallet  = await generateWallet({ secretKey: mnemonic, password: "" });
  const pk      = wallet.accounts[0].stxPrivateKey;
  const sender  = privateKeyToAddress(pk, "mainnet");
  const balance = await getBalance(sender);
  const nonce   = await getNonce(sender);

  console.log("=======================================================");
  console.log("    FlashStack -- Deploy hk-sbtc-real-receiver-v1     ");
  console.log("=======================================================");
  console.log(`  Sender:   ${sender}`);
  console.log(`  Balance:  ${Number(balance) / 1e6} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log(`  Fee:      ${FEE} microSTX (${FEE / 1e6} STX)`);
  console.log(`  Contract: ${sender}.${NAME}`);
  console.log(`  Source:   ${PATH}`);
  console.log(`  Network:  mainnet`);
  console.log(`  Mode:     ${describeGate(GATE)}`);
  console.log();

  if (balance < BigInt(FEE)) {
    throw new Error(`Insufficient balance: ${balance} microSTX < fee ${FEE} microSTX`);
  }

  const tx = await makeContractDeploy({
    contractName:      NAME,
    codeBody:          readFileSync(PATH, "utf8"),
    senderKey:         pk,
    network,
    clarityVersion:    ClarityVersion.Clarity3,
    postConditionMode: PostConditionMode.Deny, // deploy: contract has no top-level asset movement
    anchorMode:        1,
    fee:               FEE,
    nonce,
  });

  if (DRY_RUN) {
    console.log("  Dry run (default) -- not broadcasting. Re-run with EXECUTE=true --yes-mainnet to broadcast.");
    console.log(`  Built tx OK. Serialized length: ${tx.serialize().length} bytes-ish.`);
    return;
  }

  const txid = await broadcast(tx);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=mainnet`);
  await waitForConfirm(txid, "deploy hk-sbtc-real-receiver-v1");

  console.log();
  console.log("=======================================================");
  console.log("                  DEPLOYMENT COMPLETE                   ");
  console.log("=======================================================");
  console.log(`  Contract:  ${sender}.${NAME}`);
  console.log(`  Tx:        ${EXPLORER}/${txid}?chain=mainnet`);
  console.log();
  console.log("  Next steps:");
  console.log(`  1. Ask Matt to whitelist ${sender}.${NAME}`);
  console.log("     (admin-only: add-approved-receiver on flashstack-sbtc-core)");
  console.log("  2. Acquire sBTC if needed:  node scripts/buy-sbtc.mjs   (see minimum_seed_analysis.md)");
  console.log("  3. Seed the receiver:       node scripts/seed-hk-sbtc-receiver.mjs   (SEED_SATS=500)");
  console.log("  4. Execute the flash loan:  node scripts/execute-sbtc-flash-loan.mjs (AMOUNT_SATS=1000)");
  console.log("  5. Recover the seed:        rescue-sbtc(amount, our-wallet)");
}

main().catch(e => { console.error("\nFAILED:", e.message); process.exit(1); });
