/**
 * FlashStack — Zest Liquidation Monitor
 *
 * Scans all Zest Protocol borrowers for undercollateralised positions
 * (health factor < 1.0) and triggers zero-capital flash liquidations
 * via FlashStack's zest-liquidation-receiver.
 *
 * HOW IT WORKS:
 *   1. Enumerate every Zest user via get-last-user-id + get-user(id)
 *   2. For each user, check health factor via calculate-user-global-data
 *   3. If health factor < 1.0, determine best mode + debt asset
 *   4. Call simulate() on receiver to confirm profitability
 *   5. In EXECUTE mode: set-liquidation-target → flash-loan → profit
 *
 * LIQUIDATION MODES:
 *   1 — STX flash → wSTX debt + wSTX collateral  (no swap)
 *   2 — STX flash → wSTX debt + sBTC collateral  (Velar swap)
 *   3 — sBTC flash → sBTC debt + sBTC collateral (no swap)
 *   4 — sBTC flash → sBTC debt + wSTX collateral (Velar swap)
 *
 * NOTE: EXECUTE mode requires zest-liquidation-receiver to be
 *       whitelisted in Zest's is-approved-contract list.
 *       Contact Zest team to enable live liquidations.
 *
 * Usage:
 *   node scripts/monitor-zest-liquidations.mjs              -- scan only
 *   EXECUTE=true DEPLOYER_MNEMONIC="..." node ...           -- live mode
 *   INTERVAL_MS=15000 node ...                              -- 15s scan
 *   USER_IDS=0,1,2,3 node ...                              -- specific users
 */

import { makeContractCall, fetchCallReadOnlyFunction, cvToJSON, PostConditionMode, Cl } from "@stacks/transactions";
import networkPkg from "@stacks/network";
const { STACKS_MAINNET } = networkPkg;
import walletPkg from "@stacks/wallet-sdk";
const { generateWallet } = walletPkg;

// ── Config ────────────────────────────────────────────────────────────────────

const MNEMONIC     = process.env.DEPLOYER_MNEMONIC;
const DEPLOYER     = "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5";
const EXECUTE      = process.env.EXECUTE === "true";
const INTERVAL     = parseInt(process.env.INTERVAL_MS ?? "30000");
const HIRO_API_KEY = process.env.HIRO_API_KEY ?? "80b1967c5313294ebd47a94463c91d0c";
const USER_IDS     = process.env.USER_IDS?.split(",").map(Number).filter(n => !isNaN(n));

const API      = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const network  = STACKS_MAINNET;

if (EXECUTE && !MNEMONIC) {
  console.error("ERROR: Set DEPLOYER_MNEMONIC to execute liquidations.");
  process.exit(1);
}

// ── Contract addresses ────────────────────────────────────────────────────────

const ZEST        = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_POOL   = `${ZEST}.pool-borrow-v2-3`;
const RECEIVER    = `${DEPLOYER}.zest-liquidation-receiver`;
const STX_CORE    = `${DEPLOYER}.flashstack-stx-core`;
const SBTC_CORE   = `${DEPLOYER}.flashstack-sbtc-core`;

// Zest full asset registry — verified from mainnet transactions 2026-05-12
// Must be passed to every calculate-user-global-data call.
const ZEST_ASSETS = [
  { asset: `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token`,      lpToken: `${ZEST}.zststx-v2-0`,         oracle: `${ZEST}.stx-btc-oracle-v1-4`  },
  { asset: `SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc`,    lpToken: `${ZEST}.zaeusdc-v2-0`,         oracle: `${ZEST}.aeusdc-oracle-v1-0`    },
  { asset: `${ZEST}.wstx`,                                                lpToken: `${ZEST}.zwstx-v2-0`,          oracle: `${ZEST}.stx-btc-oracle-v1-4`  },
  { asset: `SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.arkadiko-token`,  lpToken: `${ZEST}.zdiko-v2-0`,           oracle: `${ZEST}.diko-oracle-v1-1`     },
  { asset: `SPN5AKG35QZSK2M8GAMR4AFX45659RJHDW353HSG.usdh-token-v1`,    lpToken: `${ZEST}.zusdh-v2-0`,           oracle: `${ZEST}.usdh-oracle-v1-0`     },
  { asset: `SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-susdt`,      lpToken: `${ZEST}.zsusdt-v2-0`,         oracle: `${ZEST}.susdt-oracle-v1-0`    },
  { asset: `SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.usda-token`,      lpToken: `${ZEST}.zusda-v2-0`,          oracle: `${ZEST}.usda-oracle-v1-1`     },
  { asset: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`,      lpToken: `${ZEST}.zsbtc-v2-0`,          oracle: `${ZEST}.stx-btc-oracle-v1-4`  },
  { asset: `SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex`,       lpToken: `${ZEST}.zalex-v2-0`,          oracle: `${ZEST}.alex-oracle-v1-1`     },
  { asset: `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2`,lpToken: `${ZEST}.zststxbtc-v2_v2-0`,  oracle: `${ZEST}.stx-btc-oracle-v1-4`  },
];

// Assets FlashStack can flash-loan (determines which modes are available)
const WSTX_ASSET  = `${ZEST}.wstx`;
const SBTC_ASSET  = `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hiroFetch(url, opts = {}) {
  if (typeof url === "string" && url.includes("hiro.so")) {
    opts = { ...opts, headers: { ...opts?.headers, "x-api-key": HIRO_API_KEY } };
  }
  return globalThis.fetch(url, opts);
}

async function readOnly(contractId, fn, args) {
  const [addr, name] = contractId.split(".");
  try {
    const r = await fetchCallReadOnlyFunction({
      contractAddress: addr, contractName: name,
      functionName: fn, functionArgs: args,
      network, senderAddress: DEPLOYER,
      client: { fetch: hiroFetch },
    });
    return cvToJSON(r);
  } catch (e) {
    return null;
  }
}

async function getNonce() {
  const r = await hiroFetch(`${API}/v2/accounts/${DEPLOYER}?proof=0`);
  return (await r.json()).nonce;
}

async function getPrivateKey() {
  const wallet = await generateWallet({ secretKey: MNEMONIC, password: "" });
  return wallet.accounts[0].stxPrivateKey;
}

async function broadcast(tx) {
  const raw   = tx.serialize();
  const bytes = typeof raw === "string" ? Buffer.from(raw.replace(/^0x/, ""), "hex") : raw;
  const res   = await hiroFetch(`${API}/v2/transactions`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON: ${text.slice(0, 200)}`); }
  if (data?.error) throw new Error(`${data.error} — ${data.reason ?? ""}`);
  const txid = typeof data === "string" ? data : data.txid;
  if (!txid) throw new Error(`No txid: ${text.slice(0, 200)}`);
  return txid;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Zest user discovery ───────────────────────────────────────────────────────

async function getLastUserId() {
  const r = await readOnly(ZEST_POOL, "get-last-user-id", []);
  return parseInt(r?.value ?? "0");
}

async function getUserPrincipal(id) {
  const r = await readOnly(ZEST_POOL, "get-user", [Cl.uint(id)]);
  const val = r?.value;
  if (!val || val === "none") return null;
  return val?.value ?? val;
}

// ── Health factor check ───────────────────────────────────────────────────────

async function getUserGlobalData(userPrincipal) {
  const assetArgs = ZEST_ASSETS.map(a =>
    Cl.tuple({
      asset:      Cl.principal(a.asset),
      "lp-token": Cl.principal(a.lpToken),
      oracle:     Cl.principal(a.oracle),
    })
  );

  const r = await readOnly(ZEST_POOL, "calculate-user-global-data", [
    Cl.principal(userPrincipal),
    Cl.list(assetArgs),
  ]);

  if (!r?.value?.value) return null;
  const v = r.value.value;

  return {
    totalCollateralUSD:  parseFloat(v["total-collateral-balanceUSD"]?.value ?? "0"),
    totalBorrowUSD:      parseFloat(v["total-borrow-balanceUSD"]?.value ?? "0"),
    healthFactor:        parseFloat(v["health-factor"]?.value ?? "999"),
    isLiquidatable:      v["is-health-factor-below-treshold"]?.value === true ||
                         v["is-health-factor-below-treshold"]?.type === "true",
    currentLtv:          parseFloat(v["current-ltv"]?.value ?? "0"),
  };
}

// ── Find liquidatable debt position ──────────────────────────────────────────
// Determines which debt asset and collateral asset to use + which mode

async function getUserBorrowBalance(userPrincipal, assetPrincipal) {
  const r = await readOnly(ZEST_POOL, "get-user-reserve-data", [
    Cl.principal(userPrincipal),
    Cl.principal(assetPrincipal),
  ]);
  if (!r?.value?.value) return 0;
  const v = r.value.value;
  return parseInt(v["current-borrow-balance"]?.value ?? v["principal-borrow-balance"]?.value ?? "0");
}

async function determineBestMode(userPrincipal) {
  // Check wSTX debt (mode 1 or 2)
  const wstxDebt  = await getUserBorrowBalance(userPrincipal, WSTX_ASSET);
  // Check sBTC debt (mode 3 or 4)
  const sbtcDebt  = await getUserBorrowBalance(userPrincipal, SBTC_ASSET);

  // Check what collateral user has (determines mode variant)
  let wstxCollateral = false;
  let sbtcCollateral = false;

  const wstxReserve = await readOnly(ZEST_POOL, "get-user-reserve-data", [
    Cl.principal(userPrincipal), Cl.principal(WSTX_ASSET),
  ]);
  const sbtcReserve = await readOnly(ZEST_POOL, "get-user-reserve-data", [
    Cl.principal(userPrincipal), Cl.principal(SBTC_ASSET),
  ]);

  const wstxCollBal = parseInt(wstxReserve?.value?.value?.["current-atoken-balance"]?.value ?? "0");
  const sbtcCollBal = parseInt(sbtcReserve?.value?.value?.["current-atoken-balance"]?.value ?? "0");

  wstxCollateral = wstxCollBal > 0;
  sbtcCollateral = sbtcCollBal > 0;

  // Pick the best liquidation mode
  // Prefer same-asset modes (no swap, lower slippage risk)
  if (wstxDebt > 0 && wstxCollateral) return { mode: 1, debtAmount: wstxDebt, debtAsset: "wSTX", collAsset: "wSTX" };
  if (sbtcDebt > 0 && sbtcCollateral) return { mode: 3, debtAmount: sbtcDebt,  debtAsset: "sBTC", collAsset: "sBTC" };
  // Cross-asset modes (need Velar swap)
  if (wstxDebt > 0 && sbtcCollateral) return { mode: 2, debtAmount: wstxDebt, debtAsset: "wSTX", collAsset: "sBTC" };
  if (sbtcDebt > 0 && wstxCollateral) return { mode: 4, debtAmount: sbtcDebt,  debtAsset: "sBTC", collAsset: "wSTX" };

  return null;
}

// ── Profitability check ───────────────────────────────────────────────────────

async function simulate(debtAmount, bonusBp) {
  const r = await readOnly(RECEIVER, "simulate", [
    Cl.uint(debtAmount),
    Cl.uint(bonusBp),
  ]);
  if (!r?.value) return null;
  const v = r.value;
  return {
    profitable:  v.profitable?.value === true || v.profitable?.type === "true",
    netProfit:   parseInt(v["net-profit"]?.value ?? "0"),
    flashFee:    parseInt(v["flash-fee"]?.value ?? "0"),
    bonus:       parseInt(v["bonus"]?.value ?? "0"),
  };
}

// ── Execute liquidation ───────────────────────────────────────────────────────

async function executeLiquidation(userPrincipal, position) {
  const pk    = await getPrivateKey();
  let nonce   = await getNonce();

  const { mode, debtAmount } = position;
  const coreContract = (mode <= 2) ? STX_CORE : SBTC_CORE;
  const [coreAddr, coreName] = coreContract.split(".");

  console.log(`\n  → Setting liquidation target...`);
  const tx1 = await makeContractCall({
    contractAddress:   DEPLOYER,
    contractName:      "zest-liquidation-receiver",
    functionName:      "set-liquidation-target",
    functionArgs:      [Cl.principal(userPrincipal), Cl.uint(debtAmount), Cl.uint(mode)],
    senderKey:         pk, network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1, fee: 100_000, nonce: nonce++,
  });
  const txid1 = await broadcast(tx1);
  console.log(`  set-liquidation-target: ${EXPLORER}/${txid1}?chain=mainnet`);

  // Wait for set-liquidation-target to confirm
  await sleep(10000);

  console.log(`  → Triggering flash loan (mode ${mode}: ${position.debtAsset} debt + ${position.collAsset} collateral)...`);
  const tx2 = await makeContractCall({
    contractAddress:   coreAddr,
    contractName:      coreName,
    functionName:      "flash-loan",
    functionArgs:      [Cl.uint(debtAmount), Cl.principal(RECEIVER)],
    senderKey:         pk, network,
    postConditionMode: PostConditionMode.Allow,
    anchorMode:        1, fee: 500_000, nonce: nonce++,
  });
  const txid2 = await broadcast(tx2);
  console.log(`  flash-loan: ${EXPLORER}/${txid2}?chain=mainnet`);
  return txid2;
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function scan() {
  console.log(`\n[${new Date().toISOString()}] Scanning Zest borrowers...`);

  // Get total user count
  const lastId = await getLastUserId();
  if (lastId === 0) {
    console.log("  No Zest users found yet.");
    return;
  }

  const idsToScan = USER_IDS?.length
    ? USER_IDS
    : Array.from({ length: lastId }, (_, i) => i);

  console.log(`  Total users: ${lastId} | Scanning: ${idsToScan.length}`);

  let liquidatable = 0;
  let atRisk = 0;
  let checked = 0;

  for (const id of idsToScan) {
    await sleep(300); // rate limit

    const principal = await getUserPrincipal(id);
    if (!principal) continue;

    const data = await getUserGlobalData(principal);
    if (!data) continue;
    if (data.totalBorrowUSD === 0) continue;

    checked++;

    const hf = data.healthFactor;
    const isLiq = data.isLiquidatable || hf < 1.0;
    const isRisk = hf < 1.1;

    if (!isLiq && !isRisk) continue;

    console.log(`\n  User #${id}: ${principal}`);
    console.log(`  Collateral: $${data.totalCollateralUSD.toFixed(2)} | Debt: $${data.totalBorrowUSD.toFixed(2)}`);
    console.log(`  Health factor: ${hf.toFixed(4)} ${isLiq ? "⚡ LIQUIDATABLE" : "⚠ AT RISK"}`);

    if (isLiq) {
      liquidatable++;

      const position = await determineBestMode(principal);
      if (!position) {
        console.log(`  No FlashStack-compatible debt/collateral pair found (may be stablecoin debt)`);
        continue;
      }

      console.log(`  Best mode: ${position.mode} | Debt: ${position.debtAmount} ${position.debtAsset} | Coll: ${position.collAsset}`);

      // Zest liquidation bonus is typically 500bp (5%) — check reserve config for exact value
      const ZEST_BONUS_BP = 500;
      const sim = await simulate(position.debtAmount, ZEST_BONUS_BP);

      if (sim) {
        const profitLabel = position.mode <= 2
          ? `${sim.netProfit} microSTX (~${(sim.netProfit / 1e6).toFixed(4)} STX)`
          : `${sim.netProfit} sats (~${(sim.netProfit / 1e8).toFixed(6)} sBTC)`;
        console.log(`  Flash fee: ${sim.flashFee} | Bonus: ${sim.bonus} | Net profit: ${profitLabel}`);
        console.log(`  Profitable: ${sim.profitable ? "YES ✓" : "NO ✗"}`);
      }

      if (sim?.profitable) {
        console.log(`  *** EXECUTE? ${EXECUTE ? "YES — firing now" : "No (dry-run). Set EXECUTE=true to go live."} ***`);

        if (EXECUTE) {
          try {
            const txid = await executeLiquidation(principal, position);
            console.log(`  Liquidation submitted: ${txid}`);
            console.log(`  ⚠  NOTE: Requires zest-liquidation-receiver to be whitelisted by Zest.`);
          } catch (e) {
            console.error(`  Liquidation failed: ${e.message}`);
          }
        }
      } else {
        console.log(`  Not profitable at current bonus — skipping.`);
      }
    } else {
      atRisk++;
      console.log(`  At risk — watching. HF needs to drop to <1.0 to liquidate.`);
    }
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`Scan complete | ${checked} active borrowers | ${liquidatable} liquidatable | ${atRisk} at risk`);
  if (liquidatable === 0) console.log(`All positions healthy.`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║        FlashStack — Zest Liquidation Monitor         ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Mode:     ${EXECUTE ? "LIVE EXECUTION ⚡" : "dry-run (scan only)"}`);
  console.log(`  Interval: ${INTERVAL / 1000}s`);
  console.log(`  Receiver: ${RECEIVER}`);
  console.log(`\n  Profit per liquidation:`);
  console.log(`  Zest bonus (~5%) - FlashStack fee (0.05%) = ~4.95% of debt repaid`);
  console.log(`  Example: liquidate $10,000 position → ~$495 profit`);
  console.log(`\n  ⚠  EXECUTE mode requires receiver whitelisted by Zest.`);
  console.log(`     Contact Zest team with: ${RECEIVER}`);
  console.log(``);

  await scan();
  setInterval(scan, INTERVAL);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
