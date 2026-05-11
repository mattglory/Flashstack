/**
 * FlashStack Profit Tracker
 *
 * Scans your wallet's transaction history across Arbitrum, Ethereum, and Base
 * for incoming transfers from your flash loan contracts (= liquidation profits).
 *
 * Usage:
 *   node --env-file=.env scripts/profit-tracker.mjs
 */

import { ethers } from "ethers";

const WALLET = "0x7Dff50b9F4f60dB5042bc01a26f39fB1266486d6";

const CHAINS = [
  {
    name:      "Arbitrum",
    rpc:       process.env.ARB_RPC  ?? "https://arb1.arbitrum.io/rpc",
    contract:  (process.env.FLASH_CONTRACT_ARB ?? process.env.FLASH_CONTRACT ?? "").toLowerCase(),
    symbol:    "ETH",
    ethPrice:  null,
    explorer:  "https://arbiscan.io/tx/",
  },
  {
    name:      "Ethereum",
    rpc:       process.env.ETH_RPC  ?? "https://ethereum.publicnode.com",
    contract:  (process.env.FLASH_CONTRACT_ETH ?? "").toLowerCase(),
    symbol:    "ETH",
    ethPrice:  null,
    explorer:  "https://etherscan.io/tx/",
  },
  {
    name:      "Base",
    rpc:       process.env.BASE_RPC ?? "https://mainnet.base.org",
    contract:  (process.env.FLASH_CONTRACT_BASE ?? "").toLowerCase(),
    symbol:    "ETH",
    ethPrice:  null,
    explorer:  "https://basescan.org/tx/",
  },
];

const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function getEthPrice() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT");
    const j = await res.json();
    return parseFloat(j.price);
  } catch { return 2300; }
}

async function scanChain(chain, ethPrice) {
  if (!chain.contract) {
    console.log(`  ${chain.name}: no contract configured — skipping`);
    return { count: 0, usd: 0 };
  }

  const provider = new ethers.JsonRpcProvider(chain.rpc);

  // Get all ERC20 Transfer events TO our wallet FROM our flash contract
  // This captures profit sweeps: contract → owner after each liquidation
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  const fromTopic = ethers.zeroPadValue(chain.contract, 32);
  const toTopic   = ethers.zeroPadValue(WALLET.toLowerCase(), 32);

  let totalUsd = 0;
  let txCount  = 0;
  const txMap  = new Map(); // deduplicate by txHash

  try {
    const currentBlock = await provider.getBlockNumber();
    // Scan last 90 days worth of blocks
    const blocksPerDay = chain.name === "Ethereum" ? 7200 : chain.name === "Arbitrum" ? 345600 : 43200;
    const fromBlock = currentBlock - blocksPerDay * 90;

    const logs = await provider.getLogs({
      topics: [transferTopic, fromTopic, toTopic],
      fromBlock: Math.max(0, fromBlock),
      toBlock:   "latest",
    });

    // Group by token, decode amounts
    const tokenCache = new Map();
    for (const log of logs) {
      if (txMap.has(log.transactionHash + log.address)) continue;
      txMap.set(log.transactionHash + log.address, true);

      let symbol = "?", decimals = 18;
      if (tokenCache.has(log.address)) {
        ({ symbol, decimals } = tokenCache.get(log.address));
      } else {
        try {
          const tok = new ethers.Contract(log.address, ERC20_ABI, provider);
          [symbol, decimals] = await Promise.all([tok.symbol(), tok.decimals()]);
          tokenCache.set(log.address, { symbol, decimals });
        } catch { tokenCache.set(log.address, { symbol: "?", decimals: 18 }); }
      }

      const amount = parseFloat(ethers.formatUnits(log.data, decimals));

      // Rough USD value — stablecoins ~$1, WETH/WBTC use ETH price
      let usdVal = 0;
      const sym = symbol.toUpperCase();
      if (sym.includes("USD") || sym.includes("DAI") || sym.includes("FRAX")) {
        usdVal = amount;
      } else if (sym.includes("WETH") || sym.includes("ETH")) {
        usdVal = amount * ethPrice;
      } else if (sym.includes("WBTC") || sym.includes("BTC")) {
        usdVal = amount * ethPrice * 15; // rough BTC/ETH ratio
      } else {
        usdVal = amount * ethPrice * 0.1; // conservative estimate for unknowns
      }

      totalUsd += usdVal;
      txCount++;

      console.log(`    ${chain.explorer}${log.transactionHash}`);
      console.log(`      +${amount.toFixed(6)} ${symbol} ≈ $${usdVal.toFixed(2)}`);
    }
  } catch (e) {
    // getLogs range too large — try chunked
    if (e.message?.includes("range") || e.message?.includes("limit") || e.message?.includes("10000")) {
      console.log(`    (RPC range limited — showing recent 7 days only)`);
      try {
        const currentBlock = await provider.getBlockNumber();
        const blocksPerDay = chain.name === "Ethereum" ? 7200 : chain.name === "Arbitrum" ? 345600 : 43200;
        const fromBlock = currentBlock - blocksPerDay * 7;
        const logs = await provider.getLogs({
          topics: [transferTopic, fromTopic, toTopic],
          fromBlock,
          toBlock: "latest",
        });
        for (const log of logs) {
          txCount++;
          const amount = parseFloat(ethers.formatUnits(log.data, 18));
          totalUsd += amount * ethPrice;
        }
      } catch { /* ignore */ }
    } else {
      console.log(`    Error: ${e.message}`);
    }
  }

  return { count: txCount, usd: totalUsd };
}

async function main() {
  console.log("╔═══════════════════════════════════════╗");
  console.log("║      FlashStack Profit Tracker        ║");
  console.log("╚═══════════════════════════════════════╝");
  console.log(`  Wallet: ${WALLET}`);
  console.log(`  Time:   ${new Date().toUTCString()}\n`);

  const ethPrice = await getEthPrice();
  console.log(`  ETH price: $${ethPrice.toFixed(2)}\n`);

  let grandTotal = 0;
  let grandCount = 0;

  for (const chain of CHAINS) {
    console.log(`── ${chain.name} (contract: ${chain.contract || "not set"}) ──`);
    const { count, usd } = await scanChain(chain, ethPrice);
    if (count === 0) {
      console.log("    No liquidation profits found yet.");
    }
    console.log(`  Subtotal: ${count} liquidation(s) | $${usd.toFixed(2)}\n`);
    grandTotal += usd;
    grandCount += count;
  }

  console.log("═══════════════════════════════════════");
  console.log(`  TOTAL PROFIT: $${grandTotal.toFixed(2)} across ${grandCount} liquidation(s)`);
  console.log("═══════════════════════════════════════");
}

main().catch(console.error);
