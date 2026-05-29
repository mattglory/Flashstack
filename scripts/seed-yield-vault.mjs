/**
 * Seed flashstack-yield-vault-v4 with an initial STX deposit.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." node scripts/seed-yield-vault.mjs
 *   DEPOSIT_STX=10 DEPLOYER_MNEMONIC="..." node scripts/seed-yield-vault.mjs
 */

import { makeContractCall, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC     = process.env.DEPLOYER_MNEMONIC;
const DEPOSIT_STX  = parseInt(process.env.DEPOSIT_STX ?? "5");
const DEPOSIT_MICRO = DEPOSIT_STX * 1_000_000;

const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const VAULT    = "flashstack-yield-vault-v4";
const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

if (!MNEMONIC) { console.error("ERROR: Set DEPLOYER_MNEMONIC"); process.exit(1); }

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

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
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });

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
