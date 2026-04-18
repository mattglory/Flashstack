/**
 * test5: Deploy minimal contract with stx-transfer? only (no trait)
 * Determines if stx-transfer? alone causes the (err none) failure.
 */
import { makeContractDeploy, broadcastTransaction, PostConditionMode } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const MNEMONIC = process.env.DEPLOYER_MNEMONIC;
if (!MNEMONIC) { console.error("Set DEPLOYER_MNEMONIC"); process.exit(1); }

const network = STACKS_MAINNET;
const API = "https://api.hiro.so";

const TEST5_SOURCE = `
;; test5: stx-transfer? in isolation (no trait)
(define-public (send-stx (amount uint) (to principal))
  (as-contract (stx-transfer? amount tx-sender to))
)
`;

const TEST6_SOURCE = `
;; test6: stx-get-balance + stx-transfer? + nested let (no trait)
(define-public (flash-simple (amount uint) (to principal))
  (let (
    (balance-before (stx-get-balance (as-contract tx-sender)))
  )
    (asserts! (>= balance-before amount) (err u1))
    (try! (as-contract (stx-transfer? amount tx-sender to)))
    (let ((balance-after (stx-get-balance (as-contract tx-sender))))
      (asserts! (>= balance-after u0) (err u2))
      (ok true)
    )
  )
)
`;

async function waitForConfirm(txid, label) {
  process.stdout.write(`  Waiting for ${label}`);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 15000));
    const res = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success") { console.log(` SUCCESS`); return "success"; }
    if (data.tx_status?.startsWith("abort")) {
      const reason = data.tx_result?.repr ?? "";
      console.log(` FAILED: ${reason}`);
      return "fail";
    }
    process.stdout.write(".");
  }
  return "timeout";
}

async function deploy(pk, nonce, name, source) {
  const tx = await makeContractDeploy({
    contractName: name,
    codeBody: source,
    senderKey: pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode: 1,
    nonce,
    fee: 5_000_000,
  });
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(`Deploy ${name}: ${result.error} - ${result.reason}`);
  return result.txid;
}

async function main() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk = wallet.accounts[0].stxPrivateKey;
  const res = await fetch(`${API}/v2/accounts/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ?proof=0`).then(r => r.json());
  let nonce = res.nonce;
  console.log(`Nonce: ${nonce}, Balance: ${parseInt(res.balance,16)/1e6} STX\n`);

  // Test 5: stx-transfer? alone
  console.log("=== test5: stx-transfer? alone (no trait) ===");
  const t5 = await deploy(pk, nonce++, "test5-stxtransfer", TEST5_SOURCE);
  console.log(`  txid: ${t5}`);
  const r5 = await waitForConfirm(t5, "test5");

  if (r5 === "fail") {
    console.log("\nCONCLUSION: stx-transfer? alone causes (err none)");
    console.log("This is a Clarity 4 / epoch 3.0 restriction on STX operations.");
    return;
  }

  // Test 6: stx-get-balance + stx-transfer? + nested let (no trait)
  console.log("\n=== test6: stx-get-balance + stx-transfer? + nested let (no trait) ===");
  const t6 = await deploy(pk, nonce++, "test6-flash-simple", TEST6_SOURCE);
  console.log(`  txid: ${t6}`);
  const r6 = await waitForConfirm(t6, "test6");

  if (r6 === "fail") {
    console.log("\nCONCLUSION: nested let + stx operations cause failure (no trait involved)");
  } else {
    console.log("\nCONCLUSION: stx ops + nested let work fine WITHOUT trait");
    console.log("The issue is SPECIFICALLY the combination with trait contract-call?");
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
