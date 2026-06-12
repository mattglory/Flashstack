/**
 * Execute a 1 STX flash loan using ian-stx-receiver-v1
 *
 * Usage (Windows PowerShell):
 *   $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/execute-ian-flash-loan.mjs
 *
 * Usage (Mac/Linux):
 *   DEPLOYER_MNEMONIC="word1 ... word24" node scripts/execute-ian-flash-loan.mjs
 *
 * Before running: seed the receiver with at least 1 STX so it can cover the fee.
 */

import { makeContractCall, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC    = process.env.DEPLOYER_MNEMONIC;
const LOAN_MICRO  = 1_000_000; // 1 STX
const API         = "https://api.hiro.so";
const EXPLORER    = "https://explorer.hiro.so/txid";
const FLASH_CORE  = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const RECEIVER    = "SP3F4D91XKMH76JSC9CA7ZKN5PDP442JE2KWDB63A.ian-stx-receiver-v1";

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC");
  console.error('  Windows: $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/execute-ian-flash-loan.mjs');
  process.exit(1);
}

async function main() {
  const wallet  = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk      = wallet.accounts[0].stxPrivateKey;
  const { privateKeyToAddress } = await import("@stacks/transactions");
  const sender  = privateKeyToAddress(pk, "mainnet");

  const acct    = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal     = parseInt(acct.balance, 16) / 1e6;
  const nonce   = acct.nonce;

  // Check receiver balance
  const recv    = await fetch(`${API}/v2/accounts/${RECEIVER}?proof=0`).then(r => r.json());
  const recvBal = parseInt(recv.balance, 16) / 1e6;

  console.log("=======================================================");
  console.log("  FlashStack -- Ian STX Flash Loan Execution");
  console.log("=======================================================");
  console.log(`  Sender:           ${sender}`);
  console.log(`  Sender balance:   ${bal.toFixed(3)} STX`);
  console.log(`  Receiver:         ${RECEIVER}`);
  console.log(`  Receiver balance: ${recvBal.toFixed(6)} STX`);
  console.log(`  Loan amount:      ${LOAN_MICRO / 1e6} STX`);
  console.log(`  Flash fee:        0.0005 STX (0.05%)`);
  console.log(`  Nonce:            ${nonce}`);
  console.log();

  if (recvBal < 0.001) {
    console.error("  ERROR: Receiver needs at least 0.001 STX to cover the fee.");
    console.error(`  Send STX to: ${RECEIVER}`);
    process.exit(1);
  }

  if (bal < 0.01) {
    console.error("  ERROR: Sender needs at least 0.01 STX for tx fee.");
    process.exit(1);
  }

  const tx = await makeContractCall({
    contractAddress:   FLASH_CORE,
    contractName:      "flashstack-stx-core",
    functionName:      "flash-loan",
    functionArgs:      [Cl.uint(LOAN_MICRO), Cl.principal(RECEIVER)],
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
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`Broadcast failed: ${data.error} -- ${data.reason ?? ""}`);

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);

  process.stdout.write("  Waiting for confirmation");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const tx = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (tx.tx_status === "success") {
      console.log(" confirmed.");
      console.log();
      console.log("=======================================================");
      console.log("  FLASH LOAN COMPLETE");
      console.log("=======================================================");
      console.log(`  Result: ${tx.tx_result?.repr}`);
      console.log(`  Block:  ${tx.block_height}`);
      console.log(`  Tx:     ${EXPLORER}/0x${txid}?chain=mainnet`);
      console.log();
      console.log("  Send Matt the transaction ID above to complete verification.");
      return;
    }
    if (tx.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${tx.tx_result?.repr}`);
      if (tx.vm_error) console.log(`  vm_error: ${tx.vm_error}`);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check explorer manually");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
