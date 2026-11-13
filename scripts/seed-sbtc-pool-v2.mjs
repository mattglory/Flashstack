/**
 * seed-sbtc-pool-v2.mjs
 * Seeds the HARDENED v2 sBTC LP pool (flashstack-sbtc-pool-v2) under the secure
 * post-rotation wallet SPR9PQ. Replaces the stale seed-sbtc-pool.mjs, which
 * targeted the paused v1 pool under the compromised SP20XD46 namespace.
 *
 * The v2 pool uses virtual shares/assets (F-1 fix), so the FIRST deposit is safe:
 * seeding it as the admin bootstraps the pool with no inflation exposure.
 *
 * Usage:
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC   # hidden input; never type it inline
 *   AMOUNT_SATS=100000 node scripts/seed-sbtc-pool-v2.mjs                              # preview (default)
 *   AMOUNT_SATS=100000 EXECUTE=true node scripts/seed-sbtc-pool-v2.mjs --yes-mainnet   # broadcast
 *
 * Env:
 *   DEPLOYER_MNEMONIC  required -- 24-word mnemonic of the admin wallet (SPR9PQ...)
 *   AMOUNT_SATS        sats to deposit (default: 100000 = 0.001 BTC)
 *   EXECUTE            "true" (plus --yes-mainnet) to broadcast; default is a preview
 */

import { makeContractCall, PostConditionMode, Pc, Cl, privateKeyToAddress } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, describeGate } from "./lib/safe-signer.mjs";

const MNEMONIC    = await loadMnemonic("DEPLOYER_MNEMONIC"); // SPR9PQ admin wallet
const AMOUNT_SATS = BigInt(process.env.AMOUNT_SATS ?? "100000");
const GATE        = broadcastGate({ network: "mainnet" }); // mainnet-only script
const DRY_RUN     = !GATE.broadcast;

// v2 pool under the secure wallet (NOT the paused v1 under SP20XD46).
const POOL        = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG";
const POOL_NAME   = "flashstack-sbtc-pool-v2";
const SBTC_ID     = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const SBTC_ASSET  = "sbtc-token"; // define-fungible-token name inside the sBTC contract
const API         = "https://api.mainnet.hiro.so";
const EXPLORER    = "https://explorer.hiro.so/txid";

if (AMOUNT_SATS <= 0n) {
  console.error("ERROR: AMOUNT_SATS must be a positive integer.");
  process.exit(1);
}

async function getSbtcBalance(addr) {
  const data = await fetch(`${API}/extended/v1/address/${addr}/balances`).then(r => r.json());
  const ft   = data.fungible_tokens ?? {};
  const key  = Object.keys(ft).find(k => k.toLowerCase().includes("sbtc-token"));
  return key ? BigInt(ft[key].balance) : 0n;
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const signer = privateKeyToAddress(pk, "mainnet");

  const acct    = await fetch(`${API}/v2/accounts/${signer}?proof=0`).then(r => r.json());
  const stxBal  = parseInt(acct.balance, 16) / 1e6;
  const nonce   = acct.nonce;
  const sbtcBal = await getSbtcBalance(signer);

  console.log("=======================================================");
  console.log("  FlashStack -- Seed sBTC Pool v2" + (DRY_RUN ? "  [DRY RUN]" : ""));
  console.log("=======================================================");
  console.log(`  Mode:            ${describeGate(GATE)}`);
  console.log(`  Signer:          ${signer}`);
  console.log(`  Target pool:     ${POOL}.${POOL_NAME}`);
  console.log(`  STX balance:     ${stxBal.toFixed(3)} STX`);
  console.log(`  sBTC balance:    ${sbtcBal} sats (${(Number(sbtcBal) / 1e8).toFixed(8)} BTC)`);
  console.log(`  Deposit amount:  ${AMOUNT_SATS} sats (${(Number(AMOUNT_SATS) / 1e8).toFixed(8)} BTC)`);
  console.log();

  // Guardrail: the deployer wallet is the admin; confirm we're seeding as admin.
  if (signer !== POOL) {
    console.warn(`  WARNING: signer ${signer} is not the pool deployer ${POOL}.`);
    console.warn("  You can still deposit as any LP, but bootstrapping is usually done by admin.\n");
  }
  if (sbtcBal < AMOUNT_SATS) {
    console.error(`  ERROR: not enough sBTC. Have ${sbtcBal} sats, need ${AMOUNT_SATS}.`);
    console.error("  Acquire sBTC: swap STX->sBTC on a DEX, or bridge BTC at app.stacks.co.");
    process.exit(1);
  }
  if (stxBal < 0.3) {
    console.error("  ERROR: need at least 0.3 STX for the transaction fee.");
    process.exit(1);
  }

  // Exact post-condition: the signer sends EXACTLY AMOUNT_SATS of sBTC, nothing more.
  const postCondition = Pc.principal(signer).willSendEq(AMOUNT_SATS).ft(SBTC_ID, SBTC_ASSET);

  if (DRY_RUN) {
    console.log("  DRY RUN -- would call:");
    console.log(`    ${POOL}.${POOL_NAME}::deposit(u${AMOUNT_SATS})`);
    console.log(`    post-condition: signer sends == ${AMOUNT_SATS} sats sBTC (deny mode)`);
    console.log(`    nonce ${nonce}, fee 0.2 STX`);
    console.log("\n  Re-run with EXECUTE=true --yes-mainnet to broadcast.");
    return;
  }

  console.log("  Broadcasting deposit...");
  const tx = await makeContractCall({
    contractAddress:   POOL,
    contractName:      POOL_NAME,
    functionName:      "deposit",
    functionArgs:      [Cl.uint(AMOUNT_SATS)],
    senderKey:         pk,
    network:           STACKS_MAINNET,
    postConditions:    [postCondition],
    postConditionMode: PostConditionMode.Deny,
    nonce,
    fee:               200_000,
  });

  const raw  = tx.serialize();
  const body = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`Deposit failed: ${data.error} -- ${data.reason ?? ""}`);

  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);

  process.stdout.write("  Waiting for confirmation (1-5 min)");
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const status = await fetch(`${API}/extended/v1/tx/0x${txid}`).then(r => r.json());
    if (status.tx_status === "success") {
      const newBal = await getSbtcBalance(`${POOL}.${POOL_NAME}`);
      console.log(" confirmed.");
      console.log(`\n  POOL SEEDED -- pool sBTC balance: ${newBal} sats (${(Number(newBal) / 1e8).toFixed(8)} BTC)`);
      console.log("  sBTC flash loans against the v2 pool are now active.");
      return;
    }
    if (status.tx_status?.startsWith("abort")) {
      console.log(` FAILED: ${status.tx_result?.repr}`);
      process.exit(1);
    }
    process.stdout.write(".");
  }
  console.log(" timed out -- check the explorer manually.");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
