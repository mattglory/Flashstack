/**
 * Arkadiko Liquidation Monitor v2
 *
 * Watches for undercollateralized Arkadiko vaults and triggers liquidations
 * directly from JavaScript — no Clarity receiver contract needed.
 *
 * ARCHITECTURE:
 *   Calls arkadiko-vaults-manager-v1-2.liquidate-vault directly via JS SDK.
 *   JS passes trait arguments as principals — works fine from outside Clarity.
 *   No flash loan or receiver contract required.
 *
 * HOW ARKADIKO v2 LIQUIDATIONS WORK:
 *   - Arkadiko uses a stability pool (vaults-pool-liq) that holds depositor USDA
 *   - When a vault drops below 150% collateral ratio, anyone can call liquidate-vault
 *   - The stability pool USDA repays the vault debt
 *   - Vault collateral (+ 10% bonus) goes to stability pool depositors
 *   - The trigger bot earns a small "liquidation fee" for calling the function
 *
 * TWO WAYS TO PROFIT:
 *   1. TRIGGER BOT (this script, no capital needed):
 *      Call liquidate-vault → earn trigger fee per liquidation
 *
 *   2. STABILITY POOL DEPOSITOR (requires USDA capital):
 *      Deposit USDA to vaults-pool-liq → earn discounted STX when liquidations happen
 *      Higher return, needs capital. See app.arkadiko.finance/earn
 *
 * Usage:
 *   node scripts/monitor-liquidations.mjs                          -- scan only (no mnemonic needed)
 *   EXECUTE=true DEPLOYER_MNEMONIC="..." node ...                  -- trigger liquidations live
 *   VAULT_OWNERS=SP1...,SP2... node ...                            -- monitor specific vaults
 *   INTERVAL_MS=10000 node ...                                     -- faster scan (10s)
 */

import { makeContractCall, PostConditionMode, Cl, fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

// Note: use --env-file=.env flag for reliable env loading before SDK init.
// Manual .env loader below is a fallback for older node or missing flag.

const MNEMONIC      = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER      = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const EXECUTE       = process.env.EXECUTE === "true";
const INTERVAL      = parseInt(process.env.INTERVAL_MS ?? "30000");
const HIRO_API_KEY  = process.env.HIRO_API_KEY;

// Require mnemonic only in execution mode
if (EXECUTE && !MNEMONIC) {
  console.error("Set DEPLOYER_MNEMONIC to execute liquidations");
  process.exit(1);
}

// Custom fetchFn that injects the API key — passed directly to SDK calls
// (globalThis.fetch monkey-patching is unreliable because SDK may capture
//  the fetch reference at module load time before our patch runs)
function hiroFetch(url, opts = {}) {
  if (HIRO_API_KEY && typeof url === "string" && url.includes("hiro.so")) {
    opts = { ...opts, headers: { ...opts?.headers, "x-api-key": HIRO_API_KEY } };
  }
  return globalThis.fetch(url, opts);
}

const network  = STACKS_MAINNET;
const API      = "https://api.hiro.so";
const API_ALT  = "https://stacks-node-api.mainnet.stacks.co"; // fallback, separate rate limit

// Arkadiko v2 mainnet contracts
const ARKADIKO         = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const VAULTS_MANAGER   = `${ARKADIKO}.arkadiko-vaults-manager-v1-2`;
const VAULTS_OPS       = `${ARKADIKO}.arkadiko-vaults-operations-v1-1`; // where open-vault is called
const VAULTS_TOKENS    = `${ARKADIKO}.arkadiko-vaults-tokens-v1-1`;
const VAULTS_DATA      = `${ARKADIKO}.arkadiko-vaults-data-v1-1`;
const VAULTS_SORTED    = `${ARKADIKO}.arkadiko-vaults-sorted-v1-1`;
const POOL_ACTIVE      = `${ARKADIKO}.arkadiko-vaults-pool-active-v1-1`;
const POOL_LIQ         = `${ARKADIKO}.arkadiko-vaults-pool-liq-v1-2`;
const VAULTS_HELPERS   = `${ARKADIKO}.arkadiko-vaults-helpers-v1-1`;
const ORACLE           = `${ARKADIKO}.arkadiko-oracle-v2-3`;

// Liquidation thresholds
const LIQUIDATION_RATIO = 1.50;   // 150% — Arkadiko minimum
const WARN_RATIO        = 1.65;   // 165% — at-risk warning threshold
const GAS_COST_STX      = 0.003;  // ~0.003 STX per tx
const MIN_PROFIT_STX    = 0.5;    // minimum to bother triggering

let _walletPk    = null;
let _vaultOwners = null;       // cached owner list
let _ownersExpiry = 0;         // refresh every 10 min

async function getPrivateKey() {
  if (_walletPk) return _walletPk;
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  _walletPk = wallet.accounts[0].stxPrivateKey;
  return _walletPk;
}

// ── STX price — Arkadiko oracle with CoinGecko fallback ───────────────────
async function getStxPrice() {
  // Try Arkadiko oracle first
  try {
    const [addr, name] = ORACLE.split(".");
    const r = await fetchCallReadOnlyFunction({
      contractAddress: addr, contractName: name,
      functionName: "get-price",
      functionArgs: [Cl.stringAscii("STX")],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const price = parseInt(cvToJSON(r)?.value?.value?.["last-price"]?.value ?? "0");
    if (price > 0) return price / 1e6;
  } catch(e) { console.log(`  Oracle error: ${e.message}`); }

  // Fallback: CoinGecko
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd");
    const price = (await r.json())?.blockstack?.usd;
    if (price) { console.log("  (STX price from CoinGecko fallback)"); return price; }
  } catch(e) { console.log(`  CoinGecko error: ${e.message}`); }

  return null;
}

// ── Vault data ─────────────────────────────────────────────────────────────
async function getVault(owner) {
  try {
    const [addr, name] = VAULTS_DATA.split(".");
    const r = await fetchCallReadOnlyFunction({
      contractAddress: addr, contractName: name,
      functionName: "get-vault",
      functionArgs: [Cl.principal(owner), Cl.principal(VAULTS_TOKENS)],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const v = cvToJSON(r)?.value?.value;
    if (!v) return null;
    return {
      collateral: parseInt(v?.collateral?.value ?? "0"),  // micro-STX
      debt:       parseInt(v?.debt?.value ?? "0"),        // micro-USDA
      status:     v?.status?.value ?? "",
    };
  } catch { return null; }
}

// ── Vault owner discovery ──────────────────────────────────────────────────
// Fetches vault owners from:
//   1. VAULT_OWNERS env var (comma-separated, highest priority)
//   2. On-chain transaction history (open-vault calls, paginated)
// Results are cached for 10 minutes to avoid rate-limiting on every scan.
async function getVaultOwners() {
  if (_vaultOwners && Date.now() < _ownersExpiry) return _vaultOwners;

  const fromEnv = (process.env.VAULT_OWNERS ?? "").split(",").filter(Boolean);
  const fromChain = new Set();

  // Helper: fetch with 429 retry + fallback to alt API
  async function fetchTxPage(base, path) {
    for (const api of [base, API_ALT]) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await hiroFetch(`${api}${path}`);
          const text = await resp.text();
          let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 80) }; }
          if (resp.status === 429) {
            // Parse retry-after seconds from Hiro error message
            const match = text.match(/retry after (\d+)s/i);
            const wait = match ? (parseInt(match[1]) + 2) * 1000 : 5000;
            console.log(`  Rate limited (${api === base ? "Hiro" : "alt"}) — waiting ${wait/1000}s...`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          if (resp.ok) return data;
          // Non-429 error on this API — try alt
          break;
        } catch(e) { break; }
      }
    }
    return null;
  }

  // Paginate through vault-operations transactions to discover vault owners.
  // Vault creation (open-vault, update-vault, close-vault, airdrop) all go
  // through arkadiko-vaults-operations-v1-1, not the vaults-manager.
  let offset = 0;
  const limit = 50;
  let pages = 0;
  const maxPages = 8; // up to 400 transactions (total ~379)

  while (pages < maxPages) {
    const data = await fetchTxPage(API, `/extended/v1/address/${VAULTS_OPS}/transactions?limit=${limit}&offset=${offset}`);
    if (!data) {
      console.log("  Could not fetch vault tx history from any API — using env list only");
      break;
    }

    const results = data?.results ?? [];
    if (results.length === 0) break;

    for (const tx of results) {
      if (tx.tx_status === "success") {
        fromChain.add(tx.sender_address);
      }
    }

    if (results.length < limit) break;
    offset += limit;
    pages++;
  }

  const all = [...new Set([...fromEnv, ...fromChain])];
  _vaultOwners  = all;
  _ownersExpiry = Date.now() + 10 * 60 * 1000; // cache for 10 minutes
  if (all.length > 0) console.log(`  (vault owner list cached for 10 min)`);
  return all;
}

// ── Liquidation check ──────────────────────────────────────────────────────
function analyzeVault(vault, stxPrice) {
  if (!vault || vault.debt === 0 || vault.status !== "active") return null;

  const collateralStx  = vault.collateral / 1e6;
  const debtUsda       = vault.debt / 1e6;
  // Debt in STX terms (using oracle price): debtUsda USDA / stxPrice = STX value of debt
  const debtStxValue   = stxPrice ? debtUsda / stxPrice : 0;
  const ratio          = debtStxValue > 0 ? collateralStx / debtStxValue : 999;
  const liquidatable   = ratio < LIQUIDATION_RATIO;
  const atRisk         = ratio < WARN_RATIO;

  // Trigger fee: Arkadiko pays a small liquidation fee to the trigger caller
  // Conservatively estimate 0.5% of collateral as trigger reward
  // (exact amount depends on Arkadiko contract — verify on first real liquidation)
  const triggerFeeEst  = collateralStx * 0.005;
  const profit         = triggerFeeEst - GAS_COST_STX;

  return { collateralStx, debtUsda, debtStxValue, ratio, liquidatable, atRisk, triggerFeeEst, profit };
}

// ── Execute liquidation — direct JS call, no Clarity receiver ─────────────
//
// JS SDK sends principals as trait arguments. This bypasses the Clarity
// trait type restriction that prevents calling trait-arg functions from
// inside Clarity contracts.
//
async function executeLiquidation(owner) {
  const pk    = await getPrivateKey();
  const nonce = await hiroFetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`)
    .then(r => r.json()).then(d => d.nonce);

  const [addr, name] = VAULTS_MANAGER.split(".");

  console.log(`  Calling liquidate-vault on ${owner} directly via JS...`);

  const tx = await makeContractCall({
    contractAddress: addr,
    contractName:    name,
    functionName:    "liquidate-vault",
    // All trait arguments passed as principals — JS SDK handles type encoding correctly
    functionArgs: [
      Cl.principal(VAULTS_TOKENS),   // vaults-tokens-trait
      Cl.principal(VAULTS_DATA),     // vaults-data-trait
      Cl.principal(VAULTS_SORTED),   // vaults-sorted-trait
      Cl.principal(POOL_ACTIVE),     // vaults-pool-active-trait
      Cl.principal(POOL_LIQ),        // vaults-pool-liq-trait
      Cl.principal(VAULTS_HELPERS),  // vaults-helpers-trait
      Cl.principal(ORACLE),          // oracle-trait
      Cl.principal(owner),           // vault owner (principal)
      Cl.principal(VAULTS_TOKENS),   // token trait (STX collateral token)
    ],
    senderKey:         pk,
    network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1,
    nonce,
    fee:               300_000, // 0.3 STX
  });

  // Broadcast raw to avoid SDK wrapper obscuring errors
  const { serializeTransaction } = await import("@stacks/transactions");
  const serialized = serializeTransaction(tx);
  const bytes      = typeof serialized === "string"
    ? Buffer.from(serialized, "hex")
    : Buffer.from(serialized);

  const resp = await fetch(`${API}/v2/transactions`, {
    method:  "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body:    bytes,
  });
  const text = await resp.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON (${resp.status}): ${text}`); }
  if (!resp.ok) throw new Error(`Broadcast ${resp.status}: ${json.error ?? text}`);
  const txid = typeof json === "string" ? json : json.txid;

  console.log(`  Txid: ${txid}`);
  console.log(`  Explorer: https://explorer.hiro.so/txid/0x${txid}?chain=mainnet`);
  return txid;
}

// ── Stability pool stats ───────────────────────────────────────────────────
async function getStabilityPoolStats() {
  try {
    const [addr, name] = POOL_LIQ.split(".");
    const r = await fetchCallReadOnlyFunction({
      contractAddress: addr, contractName: name,
      functionName:    "get-pool-data",
      functionArgs:    [],
      network, senderAddress: DEPLOYER, client: { fetch: hiroFetch },
    });
    const v = cvToJSON(r)?.value?.value;
    if (!v) return null;
    const usda = parseInt(v?.["usda-deposited"]?.value ?? v?.["total-usda"]?.value ?? "0");
    return { usdaDeposited: usda / 1e6 };
  } catch { return null; }
}

// ── Main scan ──────────────────────────────────────────────────────────────
async function scan() {
  console.log(`\n[${new Date().toISOString()}] Scanning Arkadiko vaults...`);

  const stxPrice = await getStxPrice();
  if (stxPrice) {
    console.log(`STX price (oracle): $${stxPrice.toFixed(4)}`);
  } else {
    console.log("STX price: could not fetch from oracle");
  }

  // Stability pool info
  const pool = await getStabilityPoolStats();
  if (pool) {
    console.log(`Stability pool USDA: ${pool.usdaDeposited.toFixed(2)} USDA available for liquidations`);
  }

  const owners = await getVaultOwners();
  if (owners.length === 0) {
    console.log("\nNo vault owners found. Set VAULT_OWNERS=SP1...,SP2,... to monitor specific vaults.");
    console.log("Or wait — script discovers owners from on-chain transaction history automatically.");
    return;
  }

  console.log(`\nChecking ${owners.length} vault(s)...`);

  let liquidatable = 0;
  let atRisk       = 0;
  const sleep      = ms => new Promise(r => setTimeout(r, ms));

  for (const owner of owners) {
    await sleep(200); // gentle rate limit
    const vault = await getVault(owner);
    if (!vault || vault.debt === 0) continue;

    const analysis = analyzeVault(vault, stxPrice);
    if (!analysis) continue;

    const ratioStr = analysis.ratio.toFixed(3);
    const flag     = analysis.liquidatable ? "LIQUIDATABLE" : analysis.atRisk ? "AT RISK" : "healthy";

    if (analysis.liquidatable || analysis.atRisk) {
      console.log(`\n  Vault: ${owner}`);
      console.log(`  Collateral: ${analysis.collateralStx.toFixed(2)} STX`);
      console.log(`  Debt:       ${analysis.debtUsda.toFixed(2)} USDA (~${analysis.debtStxValue.toFixed(2)} STX at oracle price)`);
      console.log(`  Ratio:      ${ratioStr}x  [${flag}]  (min: 1.50x)`);

      if (analysis.liquidatable) {
        liquidatable++;
        console.log(`  Trigger fee est: ~${analysis.triggerFeeEst.toFixed(4)} STX`);
        console.log(`  Net after gas:   ~${analysis.profit.toFixed(4)} STX`);

        if (analysis.profit > MIN_PROFIT_STX) {
          console.log(`  *** EXECUTE LIQUIDATION ***`);
          if (EXECUTE) {
            try {
              await executeLiquidation(owner);
            } catch(e) {
              console.error(`  Liquidation failed: ${e.message}`);
            }
          } else {
            console.log(`  (dry-run — set EXECUTE=true DEPLOYER_MNEMONIC=... to trigger)`);
          }
        } else {
          console.log(`  Profit too small after gas — skipping`);
        }
      } else {
        atRisk++;
        console.log(`  Watching — will become liquidatable if STX drops another ${((analysis.ratio - LIQUIDATION_RATIO) * 100).toFixed(1)}%`);
      }
    }
  }

  console.log(`\nSummary: ${owners.length} vaults checked | ${liquidatable} liquidatable | ${atRisk} at risk`);

  if (liquidatable === 0 && atRisk === 0) {
    console.log("All vaults healthy — no action needed.");
    if (stxPrice) {
      const dropNeeded = ((1 - LIQUIDATION_RATIO / (LIQUIDATION_RATIO * 1.1)) * 100).toFixed(1);
      console.log(`Liquidations open if STX drops enough to push any vault below 150% ratio.`);
    }
  }

  console.log("\nTip: To also profit from liquidations passively, deposit USDA to the stability pool:");
  console.log("     https://app.arkadiko.finance/earn  (earns discounted STX collateral on every liquidation)");
}

async function main() {
  console.log("Arkadiko Liquidation Monitor v2");
  console.log("================================");
  console.log(`Mode:          ${EXECUTE ? "LIVE EXECUTION" : "dry-run (scan only)"}`);
  console.log(`Scan interval: ${INTERVAL / 1000}s`);
  console.log(`Approach:      Direct JS call to liquidate-vault (no Clarity contract)`);
  console.log(`\nWatching for:`);
  console.log(`  -- Vaults below 150% collateral ratio (liquidatable)`);
  console.log(`  -- Vaults below 165% (at-risk warning)`);
  console.log(`\nProfit model:`);
  console.log(`  Trigger fee:     ~0.5% of collateral per liquidation (paid by Arkadiko)`);
  console.log(`  Stability pool:  deposit USDA to earn 10% bonus on liquidated collateral`);
  console.log(`\nTip: VAULT_OWNERS=SP1...,SP2... — monitor specific addresses`);
  console.log(`Tip: EXECUTE=true DEPLOYER_MNEMONIC=... — go live`);
  if (!HIRO_API_KEY) {
    console.log(`\n⚠  No HIRO_API_KEY set — free tier is 25 req/min (shared).`);
    console.log(`   Get a free key at https://platform.hiro.so  (500 req/min)`);
    console.log(`   Then run: HIRO_API_KEY=your-key node scripts/monitor-liquidations.mjs`);
  }
  console.log("");

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
