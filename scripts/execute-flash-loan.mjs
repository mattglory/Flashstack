/**
 * Execute a FlashStack STX flash loan through your deployed receiver.
 *
 * Usage (Mac/Linux):
 *   RECEIVER=SP....yourname-flash-receiver-v1 DEPLOYER_MNEMONIC="word1 ... word24" node scripts/execute-flash-loan.mjs
 *
 * Usage (Windows PowerShell):
 *   $env:RECEIVER="SP....yourname-flash-receiver-v1"; $env:DEPLOYER_MNEMONIC="word1 ... word24"; node scripts/execute-flash-loan.mjs
 *
 * Environment variables:
 *   DEPLOYER_MNEMONIC  required -- your wallet's 24 words
 *   RECEIVER           required -- your full contract ID (SP...ADDRESS.contract-name)
 *   LOAN_STX           loan size in whole STX (default: 1)
 *
 * Before running: your receiver contract needs a little STX to cover the
 * flash fee (0.05%). Send it 0.1 STX from your wallet first. You can get it
 * back later with the contract's withdraw function.
 */

import { makeContractCall, PostConditionMode, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC   = process.env.DEPLOYER_MNEMONIC;
const RECEIVER   = process.env.RECEIVER;
const LOAN_STX   = parseFloat(process.env.LOAN_STX ?? "1");
const LOAN_MICRO = Math.round(LOAN_STX * 1_000_000);
const API        = "https://api.hiro.so";
const EXPLORER   = "https://explorer.hiro.so/txid";
const FLASH_CORE = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";

if (!MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC to your wallet's 24 words.");
  process.exit(1);
}
if (!RECEIVER || !RECEIVER.includes(".")) {
  console.error("ERROR: Set RECEIVER to your full contract ID, e.g.");
  console.error("  RECEIVER=SP2ABC...XYZ.yourname-flash-receiver-v1");
  process.exit(1);
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const sender = privateKeyToAddress(pk, "mainnet");

  const acct  = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then(r => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  const nonce = acct.nonce;

  const recv    = await fetch(`${API}/v2/accounts/${RECEIVER}?proof=0`).then(r => r.json());
  const recvBal = parseInt(recv.balance, 16) / 1e6;

  console.log("=======================================================");
  console.log("  FlashStack -- STX Flash Loan Execution");
  console.log("=======================================================");
  console.log(`  Your wallet:      ${sender}`);
  console.log(`  Wallet balance:   ${bal.toFixed(3)} STX`);
  console.log(`  Receiver:         ${RECEIVER}`);
  console.log(`  Receiver balance: ${recvBal.toFixed(6)} STX`);
  console.log(`  Loan amount:      ${LOAN_MICRO / 1e6} STX`);
  console.log(`  Flash fee (0.05%): ${Math.max(LOAN_MICRO * 5 / 10000, 1) / 1e6} STX`);
  console.log();

  const feeNeeded = Math.max(LOAN_MICRO * 5 / 10000, 1) / 1e6;
  if (recvBal < feeNeeded) {
    console.error(`  ERROR: Receiver needs at least ${feeNeeded} STX to cover the flash fee.`);
    console.error(`  Send 0.1 STX from your wallet to: ${RECEIVER}`);
    process.exit(1);
  }
  if (bal < 0.5) {
    console.error("  ERROR: Your wallet needs at least 0.5 STX for the transaction fee.");
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

  process.stdout.write("  Waiting for confirmation (1-5 minutes)");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const status = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (status.tx_status === "success") {
      console.log(" confirmed.");
      console.log();
      console.log("=======================================================");
      console.log("  FLASH LOAN COMPLETE -- you just borrowed and repaid");
      console.log(`  ${LOAN_MICRO / 1e6} STX with zero collateral, atomically.`);
      console.log("=======================================================");
      console.log(`  Result: ${status.tx_result?.repr}`);
      console.log(`  Block:  ${status.block_height}`);
      console.log(`  Tx:     ${EXPLORER}/0x${txid}?chain=mainnet`);
      console.log();
      console.log("  Send Matt the transaction link above.");
      return;
    }
    if (status.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${status.tx_result?.repr}`);
      console.log("  Common causes:");
      console.log("  - Receiver not whitelisted yet (ask Matt)");
      console.log("  - Receiver has no STX to pay the fee (send it 0.1 STX)");
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check the explorer link above manually.");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
