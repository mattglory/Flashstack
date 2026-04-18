/**
 * Seed flashstack-stx-pool with STX
 * Usage: DEPLOYER_MNEMONIC="..." /opt/homebrew/bin/node scripts/seed-pool.mjs
 */
import { makeContractCall, broadcastTransaction, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const API      = "https://api.hiro.so";
const AMOUNT   = parseInt(process.env.AMOUNT_STX ?? "30") * 1_000_000;

if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;

  const res  = await fetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`).then(r => r.json());
  const nonce = res.nonce;
  const bal   = parseInt(res.balance, 16) / 1e6;
  console.log(`Balance: ${bal.toFixed(3)} STX, Nonce: ${nonce}`);
  console.log(`Depositing: ${AMOUNT / 1e6} STX`);

  if (bal < AMOUNT / 1e6 + 0.5) {
    console.error(`Insufficient balance. Need at least ${AMOUNT / 1e6 + 0.5} STX.`);
    process.exit(1);
  }

  const tx = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "flashstack-stx-pool",
    functionName:      "deposit",
    functionArgs:      [Cl.uint(AMOUNT)],
    senderKey:         pk,
    network:           STACKS_MAINNET,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000,
  });

  const result = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
  if (result.error) { console.error(`FAILED: ${result.error} - ${result.reason}`); process.exit(1); }

  console.log(`txid: ${result.txid}`);
  console.log(`https://explorer.hiro.so/txid/0x${result.txid}?chain=mainnet`);

  // Wait for confirm
  process.stdout.write("Waiting for confirm");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 12000));
    const d = await fetch(`${API}/extended/v1/tx/0x${result.txid}`).then(r => r.json());
    if (d.tx_status === "success") { console.log(" SUCCESS"); return; }
    if (d.tx_status?.startsWith("abort")) { console.log(` FAILED: ${d.tx_result?.repr}`); return; }
    process.stdout.write(".");
  }
  console.log(" TIMEOUT");
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
