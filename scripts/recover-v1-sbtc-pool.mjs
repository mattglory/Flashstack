/**
 * recover-v1-sbtc-pool.mjs
 * Withdraws the LP position held by SPR9PQ in the deprecated/paused v1 sBTC pool
 * (SP20XD46.flashstack-sbtc-pool) back to SPR9PQ. Clean recovery: the shares are
 * owned by the secure wallet, and the v1 withdraw path is NOT gated by `paused`.
 * Pair with seed-sbtc-pool-v2.mjs to consolidate the recovered sats into the
 * hardened v2 pool.
 *
 * Usage:
 *   read -rs DEPLOYER_MNEMONIC && export DEPLOYER_MNEMONIC   # hidden input; never type it inline
 *   node scripts/recover-v1-sbtc-pool.mjs                              # preview (default)
 *   EXECUTE=true node scripts/recover-v1-sbtc-pool.mjs --yes-mainnet   # broadcast
 *
 * Env:
 *   DEPLOYER_MNEMONIC  required -- 24-word mnemonic of SPR9PQ (holds the v1 shares)
 *   SHARES             optional -- shares to withdraw (default: all shares held)
 *   EXECUTE            "true" (plus --yes-mainnet) to broadcast; default is a preview
 */

import {
  makeContractCall, PostConditionMode, Pc, Cl,
  privateKeyToAddress, serializeCV, deserializeCV, cvToValue,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { loadMnemonic, broadcastGate, describeGate, assertSigner } from "./lib/safe-signer.mjs";

const MNEMONIC = await loadMnemonic("DEPLOYER_MNEMONIC"); // SPR9PQ, holds the v1 shares
const GATE     = broadcastGate({ network: "mainnet" }); // mainnet-only script
const DRY_RUN  = !GATE.broadcast;
const SECURE   = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG"; // expected signer

const POOL_ADDR = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const POOL_NAME = "flashstack-sbtc-pool"; // v1 (paused/deprecated)
const SBTC_ID   = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const SBTC_ASSET = "sbtc-token";
const API       = "https://api.mainnet.hiro.so";
const EXPLORER  = "https://explorer.hiro.so/txid";

const hex = (cv) => "0x" + serializeCV(cv);
async function callRead(fn, args) {
  const r = await fetch(`${API}/v2/contracts/call-read/${POOL_ADDR}/${POOL_NAME}/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: POOL_ADDR, arguments: args.map(hex) }),
  });
  const j = await r.json();
  if (!j.okay) throw new Error(`${fn}: ${JSON.stringify(j).slice(0, 120)}`);
  return cvToValue(deserializeCV(j.result), true);
}
const V = (x) => (x && typeof x === "object" && "value" in x) ? x.value : x;

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const signer = privateKeyToAddress(pk, "mainnet");

  const myShares    = BigInt(V(await callRead("get-shares", [Cl.principal(signer)])));
  const stats       = V(await callRead("get-stats", []));
  const totalShares = BigInt(V(stats["total-shares"]));
  const poolBalance = BigInt(V(stats["pool-balance"]));

  const shares   = process.env.SHARES ? BigInt(process.env.SHARES) : myShares;
  // v1 (no virtual offset): sats = shares * pool_balance / total_shares
  const expected = totalShares > 0n ? (shares * poolBalance) / totalShares : 0n;
  const minRecv  = expected * 99n / 100n; // 1% slippage floor for the post-condition

  const acct   = await fetch(`${API}/v2/accounts/${signer}?proof=0`).then(r => r.json());
  const stxBal = parseInt(acct.balance, 16) / 1e6;
  const nonce  = acct.nonce;

  console.log("=======================================================");
  console.log("  FlashStack -- Recover v1 sBTC Pool" + (DRY_RUN ? "  [DRY RUN]" : ""));
  console.log("=======================================================");
  console.log(`  Mode:           ${describeGate(GATE)}`);
  console.log(`  Signer:         ${signer}`);
  console.log(`  v1 pool:        ${POOL_ADDR}.${POOL_NAME}`);
  console.log(`  Your shares:    ${myShares}${process.env.SHARES ? ` (withdrawing ${shares})` : " (withdrawing all)"}`);
  console.log(`  Pool balance:   ${poolBalance} sats  | total shares: ${totalShares}`);
  console.log(`  Expected out:   ~${expected} sats (min ${minRecv})`);
  console.log(`  STX for fee:    ${stxBal.toFixed(3)}`);
  console.log();

  if (myShares === 0n)        { console.error("  Nothing to recover: signer holds 0 shares."); process.exit(1); }
  if (shares > myShares)      { console.error("  SHARES exceeds shares held."); process.exit(1); }
  if (expected === 0n)        { console.error("  Expected withdrawal is 0 sats -- aborting."); process.exit(1); }
  if (stxBal < 0.3)           { console.error("  Need >= 0.3 STX for the fee."); process.exit(1); }

  // Deny mode: the pool contract must send >= minRecv sats of sBTC back to us.
  const pc = Pc.principal(`${POOL_ADDR}.${POOL_NAME}`).willSendGte(minRecv).ft(SBTC_ID, SBTC_ASSET);

  if (DRY_RUN) {
    console.log("  DRY RUN -- would call:");
    console.log(`    ${POOL_ADDR}.${POOL_NAME}::withdraw(u${shares})`);
    console.log(`    post-condition: pool sends >= ${minRecv} sats sBTC (deny mode)`);
    console.log("\n  Re-run with EXECUTE=true --yes-mainnet to broadcast, then seed v2 with the recovered sats.");
    return;
  }

  assertSigner(signer, SECURE); // throws: never broadcast from the wrong key
  console.log("  Broadcasting withdraw...");
  const tx = await makeContractCall({
    contractAddress:   POOL_ADDR,
    contractName:      POOL_NAME,
    functionName:      "withdraw",
    functionArgs:      [Cl.uint(shares)],
    senderKey:         pk,
    network:           STACKS_MAINNET,
    postConditions:    [pc],
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
  if (data?.error) throw new Error(`Withdraw failed: ${data.error} -- ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/0x${txid}?chain=mainnet`);
  console.log("\n  Once confirmed, run seed-sbtc-pool-v2.mjs to move the sats into the hardened v2 pool.");
}

main().catch(e => { console.error("\nFATAL:", e.message); process.exit(1); });
