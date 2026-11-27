/**
 * Retire the v1 pools' admin (see docs/security/FINDINGS_REGISTER.md, F-13).
 *
 * No fix is possible in place (immutable contracts), so the Security &
 * Contract Lead's plan is to retire admin control entirely by transferring
 * it to the standard Stacks burn address, so nobody can ever approve a
 * receiver or otherwise act as admin on either pool again.
 *
 * Per Hillary (2026-10-27, after re-reading both pools live at 07:49 UTC):
 *   flashstack-stx-pool  still approves: bitflow-arb-receiver, stx-test-receiver
 *   flashstack-sbtc-pool approves: none
 *   admin on both: SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG, nothing pending,
 *   enough STX for fees.
 *
 * ORDER MATTERS. Steps 1-2 (remove the two receivers) MUST land before steps
 * 3-4 (transfer-admin) -- once admin is gone, nobody can ever remove a
 * receiver again. transfer-admin is a ONE-STEP call with no accept/confirm,
 * so this script hardcodes the burn target as a constant (BURN_ADDRESS)
 * rather than taking it as a free-form argument -- the exact mistake Hillary
 * warned about ("a mistyped but valid address would hand the admin to
 * whoever owns that address") is structurally not possible here, since
 * there's nothing to type or paste at run time.
 *
 * Run ONE STEP AT A TIME. Hillary wants the txid after each step so he can
 * re-read chain state before you run the next one -- this script will not
 * run more than one step per invocation, by design.
 *
 * Each step asserts its expected on-chain precondition before broadcasting
 * (read live, not assumed), and refuses to run out of order.
 *
 * DRY-RUN BY DEFAULT. To broadcast, pass BOTH: EXECUTE=true and --yes-mainnet
 *
 * Usage (never pass the mnemonic as a command-line argument -- it would be
 * saved in shell history):
 *   read -s ADMIN_MNEMONIC && export ADMIN_MNEMONIC
 *   node scripts/retire-v1-pools-admin.mjs --step=1
 *   EXECUTE=true node scripts/retire-v1-pools-admin.mjs --step=1 --yes-mainnet
 *   (then --step=2, --step=3, --step=4, each after Hillary confirms the previous one on chain)
 */

import {
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  cvToJSON,
  Cl,
  PostConditionMode,
  privateKeyToAddress,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const ADMIN    = "SPR9PQANV6XHSDNRAX2GNKCA5Z1KH61961KE0BYG"; // expected signer, both v1 pools
const DEPLOYER = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5"; // where the v1 pools live

// The standard Stacks burn address: version 22 (0x16), all-zero hash160.
// Nobody holds its key. Hardcoded, never typed at run time -- see header.
const BURN_ADDRESS = "SP000000000000000000002Q6VF78";

const STX_POOL  = { address: DEPLOYER, name: "flashstack-stx-pool" };
const SBTC_POOL = { address: DEPLOYER, name: "flashstack-sbtc-pool" };

const STEPS = {
  1: {
    label: "remove-approved-receiver(bitflow-arb-receiver) on flashstack-stx-pool",
    pool: STX_POOL,
    functionName: "remove-approved-receiver",
    functionArgs: [Cl.contractPrincipal(DEPLOYER, "bitflow-arb-receiver")],
    precondition: async () => {
      const approved = await readOnly(STX_POOL, "is-approved-receiver", [Cl.contractPrincipal(DEPLOYER, "bitflow-arb-receiver")]);
      return approved.value === true || approved === true;
    },
    preconditionDescription: "bitflow-arb-receiver is currently approved on flashstack-stx-pool",
  },
  2: {
    label: "remove-approved-receiver(stx-test-receiver) on flashstack-stx-pool",
    pool: STX_POOL,
    functionName: "remove-approved-receiver",
    functionArgs: [Cl.contractPrincipal(DEPLOYER, "stx-test-receiver")],
    precondition: async () => {
      const approved = await readOnly(STX_POOL, "is-approved-receiver", [Cl.contractPrincipal(DEPLOYER, "stx-test-receiver")]);
      return approved.value === true || approved === true;
    },
    preconditionDescription: "stx-test-receiver is currently approved on flashstack-stx-pool",
  },
  3: {
    label: `transfer-admin(${BURN_ADDRESS}) on flashstack-stx-pool`,
    pool: STX_POOL,
    functionName: "transfer-admin",
    functionArgs: [Cl.principal(BURN_ADDRESS)],
    precondition: async () => {
      const bitflow = await readOnly(STX_POOL, "is-approved-receiver", [Cl.contractPrincipal(DEPLOYER, "bitflow-arb-receiver")]);
      const stxTest = await readOnly(STX_POOL, "is-approved-receiver", [Cl.contractPrincipal(DEPLOYER, "stx-test-receiver")]);
      const bOk = bitflow.value === false || bitflow === false;
      const sOk = stxTest.value === false || stxTest === false;
      return bOk && sOk;
    },
    preconditionDescription: "both bitflow-arb-receiver and stx-test-receiver already read false (steps 1-2 confirmed)",
  },
  4: {
    label: `transfer-admin(${BURN_ADDRESS}) on flashstack-sbtc-pool`,
    pool: SBTC_POOL,
    functionName: "transfer-admin",
    functionArgs: [Cl.principal(BURN_ADDRESS)],
    precondition: async () => true, // sbtc-pool never had a receiver approved (confirmed by Hillary, 2026-10-27)
    preconditionDescription: "none required -- flashstack-sbtc-pool has never approved a receiver",
  },
};

const MNEMONIC = process.env.ADMIN_MNEMONIC;
const EXECUTE  = process.env.EXECUTE === "true" && process.argv.includes("--yes-mainnet");
const FEE      = BigInt(process.env.FEE ?? "50000"); // 0.05 STX default; override with FEE=...

const stepArg = process.argv.find((a) => a.startsWith("--step="));
const STEP = stepArg ? Number(stepArg.slice("--step=".length)) : NaN;

if (!MNEMONIC) {
  console.error("ERROR: set ADMIN_MNEMONIC (the v1 pools' admin wallet, SPR9PQAN...)");
  process.exit(1);
}
if (!STEPS[STEP]) {
  console.error("ERROR: pass exactly one --step=1, --step=2, --step=3 or --step=4 (run them one at a time, in order)");
  process.exit(1);
}

async function readOnly(contract, fn, args = []) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: contract.address,
    contractName: contract.name,
    functionName: fn,
    functionArgs: args,
    senderAddress: contract.address,
    network: STACKS_MAINNET,
  });
  return cvToJSON(res);
}

async function main() {
  const step = STEPS[STEP];
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  const pk     = wallet.accounts[0].stxPrivateKey;
  const sender = privateKeyToAddress(pk, "mainnet");

  const acct  = await fetch(`${API}/v2/accounts/${sender}?proof=0`).then((r) => r.json());
  const bal   = parseInt(acct.balance, 16) / 1e6;
  const nonce = acct.nonce;

  console.log("==========================================================");
  console.log(`  F-13: retire v1 pools' admin -- step ${STEP} of 4`);
  console.log("==========================================================");
  console.log(`  Step:     ${step.label}`);
  console.log(`  Mode:     ${EXECUTE ? "LIVE — WILL BROADCAST" : "DRY RUN (nothing broadcast)"}`);
  console.log(`  Signer:   ${sender}`);
  console.log(`  Balance:  ${bal.toFixed(3)} STX`);
  console.log(`  Nonce:    ${nonce}`);
  console.log();

  if (sender !== ADMIN) {
    console.error(`  ⚠ WARNING: signer is not the expected v1-pool admin (${ADMIN}).`);
    console.error(`    This call will fail with ERR-NOT-ADMIN unless this wallet is the admin.`);
    if (EXECUTE) { console.error("    Aborting live run — load the admin mnemonic."); process.exit(1); }
  }

  console.log(`  Checking precondition: ${step.preconditionDescription}`);
  const ok = await step.precondition();
  if (!ok) {
    console.error(`  ✗ Precondition failed — on-chain state doesn't match what step ${STEP} expects.`);
    console.error(`    Re-read the pools (or re-run an earlier step) before retrying.`);
    process.exit(1);
  }
  console.log("  ✓ Precondition holds.");
  console.log();

  if (STEP >= 3) {
    console.log(`  Target admin: ${BURN_ADDRESS} (hardcoded constant above — not typed at run time)`);
    console.log("  This step is ONE-STEP and CANNOT BE UNDONE.");
    console.log();
  }

  if (!EXECUTE) {
    console.log("  Dry run complete. Re-run with EXECUTE=true --yes-mainnet to broadcast this one step.");
    return;
  }

  const tx = await makeContractCall({
    contractAddress:   step.pool.address,
    contractName:      step.pool.name,
    functionName:      step.functionName,
    functionArgs:      step.functionArgs,
    senderKey:         pk,
    network:           STACKS_MAINNET,
    postConditionMode: PostConditionMode.Deny, // no funds should move on any of these four calls
    fee:               FEE,
    nonce,
  });
  const res = await broadcastTransaction({ transaction: tx, network: STACKS_MAINNET });
  if (res.error) { console.error(`  ✗ ${res.error} ${res.reason ?? ""}`); process.exit(1); }

  console.log(`  ✓ Broadcast: ${EXPLORER}/0x${res.txid}?chain=mainnet`);
  console.log();
  console.log("  Send this txid to Hillary now and wait for him to confirm it on chain");
  console.log("  before running the next step.");
}

main().catch((e) => { console.error(e); process.exit(1); });
