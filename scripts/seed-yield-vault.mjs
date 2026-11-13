/**
 * Seed flashstack-yield-vault-v5 with an initial STX deposit.
 *
 * Usage:
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC   # hidden input; never type it inline
 *   node scripts/seed-yield-vault.mjs
 *   DEPOSIT_STX=10 node scripts/seed-yield-vault.mjs
 *
 * Dry run by default (builds and signs locally, sends nothing). To broadcast:
 *   EXECUTE=true node scripts/seed-yield-vault.mjs --yes-mainnet
 */

import { makeContractCall, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, sendOrDryRun, assertSigner } from "./lib/safe-signer.mjs";

const MNEMONIC     = await loadMnemonic("DEPLOYER_MNEMONIC");
const GATE         = broadcastGate({ network: "mainnet" }); // mainnet-only script
const DEPOSIT_STX  = parseInt(process.env.DEPOSIT_STX ?? "5");
const DEPOSIT_MICRO = DEPOSIT_STX * 1_000_000;

const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const VAULT    = "flashstack-yield-vault-v5";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  assertSigner(privateKeyToAddress(pk, "mainnet"), DEPLOYER); // nonce is read for DEPLOYER

  const acct  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  const nonce = acct.nonce;

  console.log(`\nSeed: ${DEPLOYER}.${VAULT}`);
  console.log(`Balance: ${bal.toFixed(3)} STX  |  Nonce: ${nonce}`);
  console.log(`Depositing: ${DEPOSIT_STX} STX (${DEPOSIT_MICRO} microSTX)\n`);

  if (bal < DEPOSIT_STX + 0.35) {
    console.error(`Need at least ${DEPOSIT_STX + 0.35} STX (deposit + tx fee)`);
    process.exit(1);
  }

  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      VAULT,
    functionName:      "deposit",
    functionArgs:      [Cl.uint(DEPOSIT_MICRO)],
    senderKey:         pk,
    network:           STACKS_MAINNET,
    // safe-signer: allow-mode deposit transfers STX from the signer into the vault
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });

  if (!GATE.broadcast) {
    await sendOrDryRun(GATE, tx, "deposit");
    console.log("  Dry run (default). Re-run with EXECUTE=true --yes-mainnet to broadcast.");
    return;
  }

  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`Deposit failed: ${data.error} -- ${data.reason ?? ""}`);

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`Broadcast: ${txid}`);
  console.log(`Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);

  process.stdout.write("Waiting for confirm");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const tx = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (tx.tx_status === "success") {
      console.log(" confirmed.\n");

      // Read vault stats after deposit
      const r = await fetchCallReadOnlyFunction({
        contractAddress: DEPLOYER, contractName: VAULT,
        functionName: "get-stats", functionArgs: [],
        network: STACKS_MAINNET, senderAddress: DEPLOYER,
      });
      const s = cvToJSON(r)?.value?.value ?? {};
      console.log("Vault state after deposit:");
      console.log(`  vault-balance:    ${(parseInt(s["vault-balance"]?.value ?? 0) / 1e6).toFixed(6)} STX`);
      console.log(`  total-shares:     ${s["total-shares"]?.value ?? 0}`);
      console.log(`  share-price:      ${s["share-price"]?.value ?? 0} (microSTX/share-unit)`);
      console.log(`  compound-count:   ${s["compound-count"]?.value ?? 0}`);
      console.log(`  total-compounded: ${(parseInt(s["total-compounded"]?.value ?? 0) / 1e6).toFixed(6)} STX`);
      return;
    }
    if (tx.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${tx.tx_result?.repr}`);
      if (tx.vm_error) console.log(`vm_error: ${tx.vm_error}`);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check explorer");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
