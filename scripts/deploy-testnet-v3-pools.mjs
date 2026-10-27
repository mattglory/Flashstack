/**
 * FlashStack — Testnet stage for flashstack-stx-pool-v3 / flashstack-sbtc-pool-v3
 * (docs/TESTNET_STAGING.md section 6e, Flashstack-ajv.6.9)
 *
 * Executes deployments/testnet-v3-pools-plan.yaml, one line at a time. Every
 * step id below (P1, A1-A37, B1-B37) is the plan's id, with the plan's signer,
 * fee and expected result. Approved by Matt 2026-10-19 (all five section 6e
 * questions: yes), to run against the rescaled sbtc-pool-v3 (ajv.3.4, #138).
 *
 * DRY RUN BY DEFAULT. Without --broadcast this signs nothing and sends nothing:
 * it runs the read-only preflight against the testnet API and prints the plan.
 *
 * Helpers are copied from deploy-testnet-pool-v3.mjs (section 6d) as they are:
 * deployIfNeeded (deployment scars), the explicit clarityVersion (Clarity 3 for
 * every contract here), waitForConfirm's polling, assertFullyLocalized. What is
 * new, per section 6e:
 *   - an expectation on every step, checked against tx_status / tx_result read
 *     back from /extended/v1/tx, not against this script's own bookkeeping;
 *     expected failures must abort_by_response with the exact error code
 *   - state read back before and after each expected failure, which must be
 *     unchanged (the section 6c lesson: intermediate assertions, not just the
 *     end state)
 *   - two signers: K2 signs only A35/A36/B35/B36
 *   - --line=a|b, and line B refuses to start unless line A finished cleanly
 *   - stop rules: on any mismatch the pool is paused (if K1 is still admin),
 *     the txid is printed, and the run stops. An expected failure that
 *     succeeds is reported as a security finding.
 *
 * A re-run republishes nothing that already exists (deployIfNeeded), but call
 * steps are not resumable: if a line's pool already holds state, the script
 * refuses to start that line. Amend the plan first (stop-rules).
 *
 * Setup — the same two keys as section 6b, neither ever written to a file:
 *   TESTNET_MNEMONIC   = K1, ST3XQ5DMH4BRXVZWAHKJFBNND17CPCSAYMV4T0NFT (deployer)
 *   TESTNET_MNEMONIC_2 = K2, ST2YZPFDGFZH37GTRG2RA7WME4QWTC3KNAP1SB96D
 * The script refuses to broadcast if either key derives a different address.
 *
 *   node scripts/deploy-testnet-v3-pools.mjs --line=a              # dry run
 *   read -rs TESTNET_MNEMONIC   && export TESTNET_MNEMONIC
 *   read -rs TESTNET_MNEMONIC_2 && export TESTNET_MNEMONIC_2
 *   node scripts/deploy-testnet-v3-pools.mjs --line=a --broadcast
 *   node scripts/deploy-testnet-v3-pools.mjs --line=b --broadcast   # after line A
 */

import {
  makeContractDeploy,
  makeContractCall,
  makeSTXTokenTransfer,
  PostConditionMode,
  ClarityVersion,
  Cl,
  cvToHex,
  cvToString,
  hexToCV,
  getAddressFromPrivateKey,
} from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_TESTNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { localize, assertFullyLocalized, TESTNET_EQUIVALENT } from "./lib/testnet-localize.mjs";
import { contractExists } from "./lib/testnet-preconditions.mjs";

// ── Config ────────────────────────────────────────────────────────────────────

const API      = "https://api.testnet.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_TESTNET;

// The plan's signers (deployments/testnet-v3-pools-plan.yaml signers:).
const K1 = "ST3XQ5DMH4BRXVZWAHKJFBNND17CPCSAYMV4T0NFT";
const K2 = "ST2YZPFDGFZH37GTRG2RA7WME4QWTC3KNAP1SB96D";

// Read off TESTNET_EQUIVALENT, same as deploy-testnet-pool-v3.mjs, so it can't drift.
const SBTC_ADDRESS = TESTNET_EQUIVALENT.SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.testnet;
const SBTC_NAME    = "sbtc-token";

// Fees from the plan header (read off the scripts that already ran).
const FEE = { deploy: 500_000, call: 100_000, deposit: 150_000, loan: 200_000, stx: 10_000, sbtc: 100_000 };

// sbtc-pool-v3's oracle scale after ajv.3.4 (#138): launch reads exactly 1e8.
const PRICE_PRECISION = 10n ** 16n;

const LINES = {
  a: {
    prefix: "A",
    unit: "microSTX",
    pool: "flashstack-stx-pool-v3",
    honest: "stx-pool-v3-test-receiver",
    adv: "stx-pool-v3-adversarial-receiver",
    rescue: "rescue-stx",
    virtualShares: 1_000_000n, // stx-pool-v3.clar VIRTUAL-SHARES
    defaultMaxLoan: 5_000_000_000,
    err: { repay: 402, limit: 404, paused: 405, notApproved: 406, notPending: 410, reentrant: 411 },
    amounts: { deposit: 50_000_000, seed: 1_000_000, loan: 10_000_000, advFund: 6_000_000, advSeed: 5_000_000, lowCap: 5_000_000, pausedDeposit: 1_000_000 },
    feeTotal: 5_520_000,
  },
  b: {
    prefix: "B",
    unit: "sats",
    pool: "flashstack-sbtc-pool-v3",
    honest: "sbtc-pool-v3-test-receiver",
    adv: "sbtc-pool-v3-adversarial-receiver",
    rescue: "rescue-sbtc",
    virtualShares: 100_000_000n, // sbtc-pool-v3.clar VIRTUAL-SHARES
    defaultMaxLoan: 10_000_000,
    err: { repay: 702, limit: 704, paused: 705, notApproved: 706, notPending: 711, reentrant: 712 },
    amounts: { deposit: 5_000, seed: 100, loan: 2_000, advFund: 1_100, advSeed: 1_000, lowCap: 1_000, pausedDeposit: 100 },
    feeTotal: 5_700_000,
  },
};

// ── Arguments (allow-list only, same reasoning as scripts/lib/parse-steps.mjs:
// a typo must never fall through to the expensive mode) ──────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  let line = null, broadcast = false;
  for (const a of args) {
    const m = a.match(/^--line=(a|b)$/);
    if (m && !line) line = m[1];
    else if (a === "--broadcast" && !broadcast) broadcast = true;
    else throw new Error(`refusing to run: unrecognised or repeated argument "${a}". Use --line=a|b [--broadcast].`);
  }
  if (!line) throw new Error("refusing to run: --line=a or --line=b is required.");
  return { line, broadcast };
}

// ── Helpers (copied from deploy-testnet-pool-v3.mjs) ─────────────────────────

async function keyAndAddress(mnemonic) {
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const privateKey = wallet.accounts[0].stxPrivateKey;
  return { privateKey, address: getAddressFromPrivateKey(privateKey, STACKS_TESTNET) };
}

function patchSource(source, deployerAddress, label = "contract") {
  const patched = localize(source, deployerAddress);
  assertFullyLocalized(patched, label);
  return patched;
}

async function getAccount(address) {
  const res = await fetch(`${API}/v2/accounts/${address}?proof=0`);
  return res.json();
}

async function getNonce(address) {
  const data = await getAccount(address);
  if (!data.nonce && data.nonce !== 0) throw new Error(`Could not fetch nonce for ${address}. Is the address funded?`);
  return data.nonce;
}

async function getStxBalance(principal) {
  const data = await getAccount(principal);
  return BigInt(data.balance ?? "0x0");
}

// Returns the read-only result as a ClarityValue, with a top-level (ok ...)
// unwrapped. An (err ...) throws.
async function readCV(contractName, fn, args = []) {
  const res = await fetch(`${API}/v2/contracts/call-read/${K1}/${contractName}/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: K1, arguments: args.map((a) => cvToHex(a)) }),
  });
  const data = await res.json();
  if (!data.okay) throw new Error(`read ${contractName}.${fn} failed: ${JSON.stringify(data)}`);
  const cv = hexToCV(data.result);
  if (cv.type === "err") throw new Error(`read ${contractName}.${fn} returned ${cvToString(cv)}`);
  return cv.type === "ok" ? cv.value : cv;
}

const readUint = async (contractName, fn, args = []) => BigInt((await readCV(contractName, fn, args)).value);
const readStr  = async (contractName, fn, args = []) => cvToString(await readCV(contractName, fn, args));

async function getSbtcBalance(principal) {
  const res = await fetch(`${API}/v2/contracts/call-read/${SBTC_ADDRESS}/${SBTC_NAME}/get-balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: K1, arguments: [cvToHex(Cl.principal(principal))] }),
  });
  const data = await res.json();
  if (!data.okay) throw new Error(`sbtc get-balance failed: ${JSON.stringify(data)}`);
  return BigInt(hexToCV(data.result).value.value);
}

function check(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    throw new Error(`ASSERTION FAILED — ${label}: expected "${expected}", got "${actual}"`);
  }
  console.log(`  OK: ${label} = ${actual}`);
}

// Polls until the tx leaves the mempool and returns it, success or abort.
async function waitForResult(txid, label) {
  process.stdout.write(`  Waiting for "${label}"`);
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    const res  = await fetch(`${API}/extended/v1/tx/0x${txid}`);
    const data = await res.json();
    if (data.tx_status === "success" || data.tx_status?.startsWith("abort")) {
      console.log(` ${data.tx_status}, block ${data.block_height}.`);
      return data;
    }
    process.stdout.write(".");
  }
  throw new Error(`Timeout waiting for "${label}" (${txid}). Check it by hand before doing anything else.`);
}

async function broadcast(tx) {
  const raw   = tx.serialize();
  const bytes = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res  = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body:    bytes,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Node response not JSON: ${text.slice(0, 200)}`); }
  if (typeof data === "object" && data.error) {
    throw new Error(`${data.error} — ${data.reason ?? ""} ${data.reason_data ? JSON.stringify(data.reason_data) : ""}`);
  }
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  console.log(`  Broadcast: ${txid}`);
  console.log(`  Explorer:  ${EXPLORER}/${txid}?chain=testnet`);
  return txid;
}

const txBase = (signer, fee) => ({
  senderKey: signer.privateKey, network, anchorMode: 1, fee, nonce: signer.nonce++,
});

async function sendDeploy(signer, name) {
  const source = patchSource(readFileSync(`contracts/${name}.clar`, "utf8"), K1, name);
  return broadcast(await makeContractDeploy({
    ...txBase(signer, FEE.deploy), contractName: name, codeBody: source,
    clarityVersion: ClarityVersion.Clarity3, postConditionMode: PostConditionMode.Allow,
  }));
}

async function sendCall(signer, contractAddress, contractName, fn, args, fee) {
  return broadcast(await makeContractCall({
    ...txBase(signer, fee), contractAddress, contractName, functionName: fn, functionArgs: args,
    postConditionMode: PostConditionMode.Allow,
  }));
}

async function sendStx(signer, recipient, amount) {
  return broadcast(await makeSTXTokenTransfer({ ...txBase(signer, FEE.stx), recipient, amount }));
}

// ── The plan, as steps ───────────────────────────────────────────────────────
//
// Each step: id, signer, desc (what the dry run prints), fee, send(ctx) ->
// txid, and either expectOk(ctx) -> the exact "(ok ...)" repr, or expectErr
// (the error code it must abort with). before/after read state back.

function lineSteps(L) {
  const id = (n) => `${L.prefix}${n}`;
  const P = (name) => `${K1}.${name}`;
  const a = L.amounts;
  const isSbtc = L.prefix === "B";
  const balanceOf = (principal) => (isSbtc ? getSbtcBalance(principal) : getStxBalance(principal));
  const fund = (ctx, to, amount) =>
    isSbtc
      ? sendCall(ctx.k1, SBTC_ADDRESS, SBTC_NAME, "transfer",
          [Cl.uint(amount), Cl.principal(K1), Cl.principal(P(to)), Cl.none()], FEE.sbtc)
      : sendStx(ctx.k1, P(to), amount);
  const pool = (ctx, fn, args, fee = FEE.call, signer = ctx.k1) => sendCall(signer, K1, L.pool, fn, args, fee);
  const rxCall = (ctx, rx, fn, args) => sendCall(ctx.k1, K1, rx, fn, args, FEE.call);
  const loan = (rx, amount = a.loan) => (ctx) => pool(ctx, "flash-loan", [Cl.uint(amount), Cl.principal(P(rx))], FEE.loan);

  const stats = async () => readStr(L.pool, "get-stats");
  const shares = async (who) => readUint(L.pool, "get-shares", [Cl.principal(who)]);
  const totalShares = async () => BigInt((await readCV(L.pool, "get-stats")).value["total-shares"].value);
  const poolBalance = async () => readUint(L.pool, "get-pool-balance");
  // shares = amount * (total + VS) / (balance + 1); assets = shares * (balance + 1) / (total + VS)
  const sharesFor = async (amount) => (BigInt(amount) * ((await totalShares()) + L.virtualShares)) / ((await poolBalance()) + 1n);
  const assetsFor = async (s) => (s * ((await poolBalance()) + 1n)) / ((await totalShares()) + L.virtualShares);
  const snapshot = async () => JSON.stringify({
    stats: await stats(), adv: String(await balanceOf(P(L.adv))), advShares: String(await shares(P(L.adv))),
    k1Shares: String(await shares(K1)),
  });
  const unchanged = { before: snapshot, after: async (_ctx, snap) => check("state unchanged by the rejected call", await snapshot(), snap) };
  const sharePrice = async (label) => {
    if (!isSbtc) return;
    const expected = ((await poolBalance()) + 1n) * PRICE_PRECISION / ((await totalShares()) + L.virtualShares);
    check(`get-share-price ${label} (rescaled oracle, #138)`, await readUint(L.pool, "get-share-price"), expected);
  };

  const deploy = (n, name) => ({
    id: id(n), signer: "K1", desc: `deployIfNeeded ${name} (Clarity 3)`, fee: FEE.deploy, deploy: name,
  });

  return [
    { ...deploy(1, L.pool),
      after: async () => {
        check("get-admin", await readStr(L.pool, "get-admin"), K1);
        check("get-pending-admin", await readStr(L.pool, "get-pending-admin"), "none");
        const s = (await readCV(L.pool, "get-stats")).value;
        check("paused", cvToString(s.paused), "false");
        check("fee-basis-points", s["fee-basis-points"].value, 5);
        check("max-single-loan", s["max-single-loan"].value, L.defaultMaxLoan);
        check("total-shares", s["total-shares"].value, 0);
        if (isSbtc) check("get-share-price at launch (rescaled oracle, #138)", await readUint(L.pool, "get-share-price"), 100_000_000n);
      } },
    deploy(2, L.honest),
    deploy(3, L.adv),
    { id: id(4), signer: "K1", desc: "source byte-diff of the three publishes vs localize(repo file), before any approval", verifyOnly: true,
      after: async () => {
        for (const name of [L.pool, L.honest, L.adv]) {
          const res = await fetch(`${API}/v2/contracts/source/${K1}/${name}?proof=0`);
          const { source } = await res.json();
          const sha = (s) => createHash("sha256").update(s).digest("hex");
          const local = patchSource(readFileSync(`contracts/${name}.clar`, "utf8"), K1, name);
          check(`${name} deployed sha256 == localized repo sha256`, sha(source ?? ""), sha(local));
        }
      } },
    { id: id(5), signer: "K1", desc: `flash-loan u${a.loan} ${L.honest} (not approved yet)`, fee: FEE.loan,
      send: loan(L.honest), expectErr: L.err.notApproved, ...unchanged },
    { id: id(6), signer: "K1", desc: `add-approved-receiver ${L.honest}`, fee: FEE.call,
      send: (ctx) => pool(ctx, "add-approved-receiver", [Cl.principal(P(L.honest))]), expectOk: () => "(ok true)",
      after: async () => check("is-approved-receiver", await readStr(L.pool, "is-approved-receiver", [Cl.principal(P(L.honest))]), "true") },
    { id: id(7), signer: "K1", desc: `deposit u${a.deposit}`, fee: FEE.deposit,
      send: (ctx) => pool(ctx, "deposit", [Cl.uint(a.deposit)], FEE.deposit),
      expectOk: async () => `(ok u${await sharesFor(a.deposit)})`,
      after: async () => sharePrice("after the first deposit") },
    { id: id(8), signer: "K1", desc: `transfer ${a.seed} ${L.unit} -> ${L.honest} (fee buffer)`, fee: isSbtc ? FEE.sbtc : FEE.stx,
      send: (ctx) => fund(ctx, L.honest, a.seed), expectOk: () => "(ok true)",
      after: async () => check(`${L.honest} balance`, await balanceOf(P(L.honest)), a.seed) },
    { id: id(9), signer: "K1", desc: `${L.honest}.arm u${a.loan}`, fee: FEE.call,
      send: (ctx) => rxCall(ctx, L.honest, "arm", [Cl.uint(a.loan)]), expectOk: () => "(ok true)" },
    { id: id(10), signer: "K1", desc: `flash-loan u${a.loan} ${L.honest} (honest)`, fee: FEE.loan, send: loan(L.honest),
      expectOk: () => "(ok true)",
      before: async () => ({ pool: await poolBalance(), rx: await balanceOf(P(L.honest)) }),
      after: async (_ctx, b) => {
        const fee = BigInt(Math.max(1, Math.floor((a.loan * 5) / 10000)));
        check("pool balance grew by exactly the fee", await poolBalance(), b.pool + fee);
        check(`${L.honest} balance fell by exactly the fee`, await balanceOf(P(L.honest)), b.rx - fee);
        check("arm cleared", await readStr(L.honest, "get-armed"), "none");
        const s = (await readCV(L.pool, "get-stats")).value;
        check("total-loans", s["total-loans"].value, 1);
        check("total-volume", s["total-volume"].value, a.loan);
        check("total-fees", s["total-fees"].value, fee);
        await sharePrice("after the honest loan (must exceed 1e8)");
      } },
    { id: id(11), signer: "K1", desc: `set-max-single-loan u${a.lowCap}`, fee: FEE.call,
      send: (ctx) => pool(ctx, "set-max-single-loan", [Cl.uint(a.lowCap)]), expectOk: () => "(ok true)" },
    { id: id(12), signer: "K1", desc: `flash-loan u${a.loan} ${L.honest} (over the cap)`, fee: FEE.loan,
      send: loan(L.honest), expectErr: L.err.limit, ...unchanged },
    { id: id(13), signer: "K1", desc: `set-max-single-loan u${L.defaultMaxLoan} (restore)`, fee: FEE.call,
      send: (ctx) => pool(ctx, "set-max-single-loan", [Cl.uint(L.defaultMaxLoan)]), expectOk: () => "(ok true)",
      after: async () => check("max-single-loan restored", (await readCV(L.pool, "get-stats")).value["max-single-loan"].value, L.defaultMaxLoan) },
    { id: id(14), signer: "K1", desc: `add-approved-receiver ${L.adv} (documented item-13 exception, removed at ${id(26)})`, fee: FEE.call,
      send: (ctx) => pool(ctx, "add-approved-receiver", [Cl.principal(P(L.adv))]), expectOk: () => "(ok true)" },
    { id: id(15), signer: "K1", desc: `transfer ${a.advFund} ${L.unit} -> ${L.adv}`, fee: isSbtc ? FEE.sbtc : FEE.stx,
      send: (ctx) => fund(ctx, L.adv, a.advFund), expectOk: () => "(ok true)",
      after: async () => check(`${L.adv} balance`, await balanceOf(P(L.adv)), a.advFund) },
    { id: id(16), signer: "K1", desc: `${L.adv}.seed-deposit u${a.advSeed}`, fee: FEE.call,
      send: (ctx) => rxCall(ctx, L.adv, "seed-deposit", [Cl.uint(a.advSeed)]),
      expectOk: async () => `(ok u${await sharesFor(a.advSeed)})`,
      after: async () => check(`${L.adv} holds shares`, (await shares(P(L.adv))) > 0n, true) },
    ...[[17, 1, L.err.reentrant, "deposit-as-repayment (F-9)"],
        [19, 2, L.err.reentrant, "withdraw reentry"],
        [21, 3, L.err.repay, "under-repay (principal only)"]].flatMap(([n, mode, code, what]) => [
      { id: id(n), signer: "K1", desc: `${L.adv}.arm u${mode} u${a.loan}`, fee: FEE.call,
        send: (ctx) => rxCall(ctx, L.adv, "arm", [Cl.uint(mode), Cl.uint(a.loan)]), expectOk: () => "(ok true)" },
      { id: id(n + 1), signer: "K1", desc: `flash-loan u${a.loan} ${L.adv}: ${what}`, fee: FEE.loan,
        send: loan(L.adv), expectErr: code, ...unchanged },
    ]),
    { id: id(23), signer: "K1", desc: `${L.adv}.arm u0 u${a.loan}`, fee: FEE.call,
      send: (ctx) => rxCall(ctx, L.adv, "arm", [Cl.uint(0), Cl.uint(a.loan)]), expectOk: () => "(ok true)" },
    { id: id(24), signer: "K1", desc: `flash-loan u${a.loan} ${L.adv}: honest mode, the lock was released`, fee: FEE.loan,
      send: loan(L.adv), expectOk: () => "(ok true)" },
    { id: id(25), signer: "K1", desc: `${L.adv}.exit (withdraw its shares outside a loan)`, fee: FEE.call,
      send: (ctx) => rxCall(ctx, L.adv, "exit", []),
      expectOk: async () => `(ok u${await assetsFor(await shares(P(L.adv)))})`,
      after: async () => check(`${L.adv} shares`, await shares(P(L.adv)), 0) },
    { id: id(26), signer: "K1", desc: `remove-approved-receiver ${L.adv}`, fee: FEE.call,
      send: (ctx) => pool(ctx, "remove-approved-receiver", [Cl.principal(P(L.adv))]), expectOk: () => "(ok true)",
      after: async () => check("is-approved-receiver", await readStr(L.pool, "is-approved-receiver", [Cl.principal(P(L.adv))]), "false") },
    { id: id(27), signer: "K1", desc: `${L.adv}.${L.rescue} <full balance>`, fee: FEE.call,
      send: async (ctx) => rxCall(ctx, L.adv, L.rescue, [Cl.uint(await balanceOf(P(L.adv)))]), expectOk: () => "(ok true)",
      after: async () => check(`${L.adv} balance`, await balanceOf(P(L.adv)), 0) },
    { id: id(28), signer: "K1", desc: "set-paused true", fee: FEE.call,
      send: (ctx) => pool(ctx, "set-paused", [Cl.bool(true)]), expectOk: () => "(ok true)" },
    { id: id(29), signer: "K1", desc: `deposit u${a.pausedDeposit} (paused)`, fee: FEE.deposit,
      send: (ctx) => pool(ctx, "deposit", [Cl.uint(a.pausedDeposit)], FEE.deposit), expectErr: L.err.paused, ...unchanged },
    { id: id(30), signer: "K1", desc: `flash-loan u${a.loan} ${L.honest} (paused)`, fee: FEE.loan,
      send: loan(L.honest), expectErr: L.err.paused, ...unchanged },
    { id: id(31), signer: "K1", desc: "withdraw 10% of K1's shares (paused: LPs can still exit, F-8)", fee: FEE.call,
      send: async (ctx) => pool(ctx, "withdraw", [Cl.uint((await shares(K1)) / 10n)]),
      expectOk: async () => `(ok u${await assetsFor((await shares(K1)) / 10n)})` },
    { id: id(32), signer: "K1", desc: "set-paused false", fee: FEE.call,
      send: (ctx) => pool(ctx, "set-paused", [Cl.bool(false)]), expectOk: () => "(ok true)" },
    { id: id(33), signer: "K1", desc: "transfer-admin K2", fee: FEE.call,
      send: (ctx) => pool(ctx, "transfer-admin", [Cl.principal(K2)]), expectOk: () => "(ok true)",
      after: async () => {
        check("get-admin still K1", await readStr(L.pool, "get-admin"), K1);
        check("get-pending-admin", await readStr(L.pool, "get-pending-admin"), `(some ${K2})`);
      } },
    { id: id(34), signer: "K1", desc: "accept-admin by K1 (not the pending admin)", fee: FEE.call,
      send: (ctx) => pool(ctx, "accept-admin", []), expectErr: L.err.notPending,
      after: async () => check("get-admin still K1", await readStr(L.pool, "get-admin"), K1) },
    { id: id(35), signer: "K2", desc: "accept-admin by K2", fee: FEE.call,
      send: (ctx) => pool(ctx, "accept-admin", [], FEE.call, ctx.k2), expectOk: () => "(ok true)",
      after: async () => {
        check("get-admin", await readStr(L.pool, "get-admin"), K2);
        check("get-pending-admin", await readStr(L.pool, "get-pending-admin"), "none");
      } },
    { id: id(36), signer: "K2", desc: "transfer-admin K1", fee: FEE.call,
      send: (ctx) => pool(ctx, "transfer-admin", [Cl.principal(K1)], FEE.call, ctx.k2), expectOk: () => "(ok true)" },
    { id: id(37), signer: "K1", desc: "accept-admin by K1 (restore)", fee: FEE.call,
      send: (ctx) => pool(ctx, "accept-admin", []), expectOk: () => "(ok true)",
      after: async () => {
        check("get-admin restored", await readStr(L.pool, "get-admin"), K1);
        check("get-pending-admin", await readStr(L.pool, "get-pending-admin"), "none");
      } },
  ];
}

const P1 = { id: "P1", signer: "K1", desc: "deployIfNeeded sbtc-flash-receiver-trait (Clarity 3)", fee: FEE.deploy, deploy: "sbtc-flash-receiver-trait" };

// ── Running a step ───────────────────────────────────────────────────────────

async function pauseAndStop(ctx, L, step, reason) {
  console.error(`\n  STOP at ${step.id}: ${reason}`);
  try {
    if (await contractExists(API, K1, L.pool) && (await readStr(L.pool, "get-admin")) === K1) {
      console.error("  Stop rule: pausing the pool before anything else.");
      const txid = await sendCall(ctx.k1, K1, L.pool, "set-paused", [Cl.bool(true)], FEE.call);
      const data = await waitForResult(txid, "set-paused true (stop rule)");
      console.error(`  set-paused: ${data.tx_status} ${data.tx_result?.repr}`);
    } else {
      console.error("  Pool not published, or K1 is not admin: not pausing. Check get-admin by hand.");
    }
  } catch (e) {
    console.error(`  Pausing failed too: ${e.message}. Pause by hand.`);
  }
  throw new Error(`${step.id}: ${reason}`);
}

async function runStep(ctx, L, step) {
  console.log(`\n${step.id} [${step.signer}] ${step.desc}`);

  if (step.deploy) {
    if (await contractExists(API, K1, step.deploy)) {
      console.log(`  Already deployed at ${K1}.${step.deploy} -- skipping (deployment scar). Nonce not consumed.`);
    } else {
      const txid = await sendDeploy(ctx.k1, step.deploy);
      ctx.evidence.push({ id: step.id, txid });
      const data = await waitForResult(txid, `deploy ${step.deploy}`);
      if (data.tx_status !== "success") {
        await pauseAndStop(ctx, L, step, `publish ${data.tx_status} ${data.tx_result?.repr}; the name is now consumed at K1 (stop-rules)`);
      }
    }
    if (step.after) await step.after(ctx);
    return;
  }
  if (step.verifyOnly) {
    try { await step.after(ctx); } catch (e) { await pauseAndStop(ctx, L, step, e.message); }
    return;
  }

  const snap = step.before ? await step.before(ctx) : undefined;
  // Computed from live state immediately before the broadcast, so it can't be stale.
  const expected = step.expectErr !== undefined
    ? { status: "abort_by_response", repr: `(err u${step.expectErr})` }
    : { status: "success", repr: await step.expectOk(ctx) };
  console.log(`  expect: ${expected.status} ${expected.repr}`);

  const txid = await step.send(ctx);
  ctx.evidence.push({ id: step.id, txid });
  const data = await waitForResult(txid, step.id);
  const got = { status: data.tx_status, repr: data.tx_result?.repr };
  const signer = step.signer === "K1" ? K1 : K2;
  if (data.sender_address !== signer) {
    await pauseAndStop(ctx, L, step, `sender is ${data.sender_address}, the plan says ${signer}`);
  }
  if (got.status !== expected.status || got.repr !== expected.repr) {
    const security = step.expectErr !== undefined && got.status === "success";
    await pauseAndStop(ctx, L, step,
      (security ? "SECURITY FINDING — an expected failure SUCCEEDED. Report to the Security & Contract Lead before anything else. " : "") +
      `expected ${expected.status} ${expected.repr}, got ${got.status} ${got.repr}`);
  }
  console.log(`  OK: ${got.status} ${got.repr}`);
  if (step.after) {
    try { await step.after(ctx, snap); } catch (e) { await pauseAndStop(ctx, L, step, e.message); }
  }
}

// ── Preflight ────────────────────────────────────────────────────────────────

async function preflight(lineKey, L, steps) {
  console.log("Preflight (read-only)");
  const fees = steps.reduce((s, st) => s + (st.fee ?? 0), 0);
  const lineFees = steps.filter((st) => st.id !== "P1").reduce((s, st) => s + (st.fee ?? 0), 0);
  check(`line ${lineKey.toUpperCase()} fees match the plan's totals`, lineFees, L.feeTotal);
  const k2Fees = steps.filter((st) => st.signer === "K2").reduce((s, st) => s + st.fee, 0);
  check("K2 fees match the plan (of-which-K2, per line)", k2Fees, 200_000);

  const a = L.amounts;
  const principalStx = lineKey === "a" ? a.deposit + a.seed + a.advFund : 0;
  const needK1 = BigInt(fees - k2Fees + principalStx);
  const k1Stx = await getStxBalance(K1);
  const k2Stx = await getStxBalance(K2);
  console.log(`  K1 ${K1}: ${k1Stx} microSTX (needs ${needK1}), nonce ${await getNonce(K1)}`);
  console.log(`  K2 ${K2}: ${k2Stx} microSTX (needs ${k2Fees}), nonce ${await getNonce(K2)}`);
  const problems = [];
  if (k1Stx < needK1) problems.push(`K1 has ${k1Stx} microSTX, needs ${needK1}`);
  if (k2Stx < BigInt(k2Fees)) problems.push(`K2 has ${k2Stx} microSTX, needs ${k2Fees}`);

  if (lineKey === "b") {
    const sbtc = await getSbtcBalance(K1);
    const need = BigInt(a.deposit + a.seed + a.advFund);
    console.log(`  K1 sBTC (${SBTC_ADDRESS}.${SBTC_NAME}): ${sbtc} sats (needs ${need})`);
    if (sbtc < need) problems.push(`K1 has ${sbtc} sats, needs ${need}; stop before B1 (stop-rules)`);

    // Line B can't run on a partial line A.
    const A = LINES.a;
    if (!(await contractExists(API, K1, A.pool))) problems.push("line A has not run (flashstack-stx-pool-v3 not published)");
    else {
      if ((await readStr(A.pool, "get-admin")) !== K1) problems.push("line A did not finish: stx-pool-v3 admin is not K1");
      if ((await readStr(A.pool, "get-pending-admin")) !== "none") problems.push("line A did not finish: stx-pool-v3 has a pending admin");
      if ((await readStr(A.pool, "is-approved-receiver", [Cl.principal(`${K1}.${A.adv}`)])) !== "false")
        problems.push("line A did not finish: its adversarial receiver is still approved");
    }
  }

  // Call steps are not resumable: a pool that already holds state means a
  // partial earlier run. Publishes alone are fine (deployIfNeeded).
  for (const name of [L.pool, L.honest, L.adv]) {
    console.log(`  ${K1}.${name}: ${(await contractExists(API, K1, name)) ? "published" : "not published"}`);
  }
  if (await contractExists(API, K1, L.pool)) {
    const s = (await readCV(L.pool, "get-stats")).value;
    if (BigInt(s["total-shares"].value) > 0n || BigInt(s["total-loans"].value) > 0n ||
        (await readStr(L.pool, "is-approved-receiver", [Cl.principal(`${K1}.${L.honest}`)])) === "true") {
      problems.push(`${L.pool} already holds state from an earlier run; call steps are not resumable, amend the plan first (stop-rules)`);
    }
  }
  return problems;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { line, broadcast: live } = parseArgs(process.argv);
  const L = LINES[line];
  const steps = line === "b" ? [P1, ...lineSteps(L)] : lineSteps(L);

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  FlashStack — Testnet stage, v3 pools (section 6e)   ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Line:     ${line.toUpperCase()} (${L.pool})`);
  console.log(`  Mode:     ${live ? "BROADCAST" : "DRY RUN (nothing is signed or sent; add --broadcast to run)"}`);
  console.log(`  Network:  testnet (${API})`);
  console.log(`  Signers:  K1 ${K1}, K2 ${K2}`);
  console.log();

  let problems = [];
  try {
    problems = await preflight(line, L, steps);
  } catch (e) {
    problems = [`preflight could not read the testnet API: ${e.message}`];
  }

  console.log(`\nPlan (${steps.length} steps, deployments/testnet-v3-pools-plan.yaml):`);
  for (const st of steps) {
    const expect = st.deploy ? "publish succeeds, or skipped if already there"
      : st.verifyOnly ? "hashes equal"
      : st.expectErr !== undefined ? `abort_by_response (err u${st.expectErr})`
      : "success, exact (ok ...) computed from live state";
    console.log(`  ${st.id.padEnd(4)} ${st.signer}  fee ${String(st.fee ?? 0).padStart(6)}  ${st.desc}\n${" ".repeat(22)}-> ${expect}`);
  }

  if (problems.length) {
    console.log("\nPreflight problems:");
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log("\nPreflight: clear.");
  }

  if (!live) {
    console.log("\nDry run only. Nothing was signed or broadcast.");
    return;
  }
  if (problems.length) throw new Error("refusing to broadcast with preflight problems (see above)");

  const m1 = process.env.TESTNET_MNEMONIC, m2 = process.env.TESTNET_MNEMONIC_2;
  if (!m1 || !m2) throw new Error("--broadcast needs TESTNET_MNEMONIC (K1) and TESTNET_MNEMONIC_2 (K2); see the header");
  const k1 = await keyAndAddress(m1), k2 = await keyAndAddress(m2);
  if (k1.address !== K1) throw new Error(`TESTNET_MNEMONIC derives ${k1.address}, not K1 ${K1}`);
  if (k2.address !== K2) throw new Error(`TESTNET_MNEMONIC_2 derives ${k2.address}, not K2 ${K2}`);
  k1.nonce = await getNonce(K1);
  k2.nonce = await getNonce(K2);

  const ctx = { k1, k2, evidence: [] };
  try {
    for (const step of steps) await runStep(ctx, L, step);
  } finally {
    console.log("\nEvidence (re-verify every txid against /extended/v1/tx/0x<txid> before recording it):");
    for (const { id, txid } of ctx.evidence) console.log(`  ${id.padEnd(4)} ${EXPLORER}/${txid}?chain=testnet`);
  }
  console.log(`\nLine ${line.toUpperCase()} complete. Record the evidence in docs/TESTNET_STAGING.md section 6e.`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
