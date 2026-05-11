# FlashStack Bot — Complete Deployment Guide

## Overview

FlashStack runs three bots simultaneously:

| Bot | Script | Purpose | Capital Needed |
|-----|--------|---------|----------------|
| **Liquidation Bot** | `monitor-liquidations.mjs` | Trigger undercollateralized Arkadiko vaults | Zero |
| **Opportunity Scanner** | `monitor-opportunities.mjs` | Detect and execute arb across 4 DEXes | Optional |
| **USDA Peg Trader** | `usda-peg-trade.mjs` | Trade USDA peg deviations | Optional |

---

## PART 1: Prerequisites

### 1.1 System Requirements
- Node.js v20+ (you have v25.9.0)
- 1GB RAM minimum
- Stable internet connection
- Hiro Platform API key (free at platform.hiro.so)

### 1.2 Wallet Setup
Your trading wallet address: `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5`

**Minimum wallet balance to operate:**
| Purpose | STX Amount |
|---------|-----------|
| Gas for liquidations (per trigger) | 0.3 STX |
| Gas for arb trades | 0.3–0.6 STX |
| Gas reserve (1 month, 100 triggers) | 30 STX |
| LP pool deposit (to earn fees) | Any amount |
| Vault collateral (for USDA trades) | 500+ STX |

### 1.3 Configure Your .env File

Open `.env` in the project root and fill in:

```bash
# REQUIRED: Hiro API key (get free at platform.hiro.so)
HIRO_API_KEY=your-key-here

# REQUIRED for execution: Your wallet mnemonic (24 words, space-separated)
DEPLOYER_MNEMONIC=word1 word2 word3 ... word24

# Optional overrides
INTERVAL_MS=30000         # Scan every 30 seconds
LOAN_STX=50               # Flash loan size (increase for more profit)
```

**Security rules:**
- Never share your mnemonic with anyone
- `.env` is gitignored — it will never be committed
- Use a dedicated trading wallet — not your main wallet

---

## PART 2: Running the Bots

### 2.1 Dry-Run Mode (No Execution, No Capital Needed)

Start here. Verify everything works before spending any money.

```bash
# Terminal 1 — Liquidation monitor
/opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# Terminal 2 — Opportunity scanner
/opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs
```

**What to look for:**
- "Checking 99 vault(s)..." — vault discovery working
- "STX price (oracle): $X.XXXX" — oracle connected
- "USDA above peg" or "LIQUIDATABLE" — real opportunities

### 2.2 Live Execution Mode

**Step 1:** Add your mnemonic to `.env`

**Step 2:** Choose which strategies to enable

```bash
# Liquidations only (zero capital, pure trigger fees)
EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# USDA peg trading (requires open vault + USDA in wallet)
EXECUTE_USDA=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs

# Bitflow arb + compound profits to LP pool
EXECUTE=true COMPOUND=true LOAN_STX=50 /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs

# All strategies at once
EXECUTE=true EXECUTE_USDA=true COMPOUND=true LOAN_STX=50 /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs
```

### 2.3 Run Both Bots in Background (Production)

```bash
# Start both in background, log to files
/opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs >> logs/liquidations.log 2>&1 &
/opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs >> logs/opportunities.log 2>&1 &

# Watch logs in real time
tail -f logs/liquidations.log
tail -f logs/opportunities.log
```

### 2.4 Production Setup with PM2 (24/7, Auto-Restart)

```bash
# Install pm2
/opt/homebrew/bin/npm install -g pm2

# Start both bots
pm2 start "/opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs" --name liquidations
pm2 start "/opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs" --name opportunities

# Save config so they restart on reboot
pm2 save
pm2 startup

# Monitor
pm2 status
pm2 logs liquidations
pm2 logs opportunities
```

---

## PART 3: USDA Peg Trade — Step by Step

This is the most profitable strategy when USDA is above peg.

### When to use: USDA is above $1.00 (bot shows +X% deviation)

**Step 1: Open an Arkadiko Vault**
1. Go to https://app.arkadiko.finance
2. Click "Vaults" → "Open New Vault"
3. Select STX as collateral
4. Set collateral ratio to 250%+ (safe zone)
5. Mint USDA

| Your STX | Mint (safe 250%) | Profit at +5% peg |
|----------|-----------------|-------------------|
| 500 STX  | ~180 USDA       | ~$9               |
| 1,000 STX | ~360 USDA      | ~$18              |
| 3,000 STX | ~1,080 USDA    | ~$54              |
| 5,000 STX | ~1,800 USDA    | ~$90              |

**Step 2: Run the sell script**
```bash
EXECUTE_USDA=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs
```

The bot detects USDA in your wallet and sells immediately at the above-peg price.

**Step 3: Wait for peg to restore**

Watch the bot output. When USDA returns to ~$1.00:
```bash
USDA_TRADE_STX=50 EXECUTE_USDA=true /opt/homebrew/bin/node --env-file=.env scripts/usda-peg-trade.mjs
```

This buys USDA back at $1.00, you repay the vault, release your STX collateral.

**Net result:** You profited the peg spread on every USDA you minted and sold.

---

## PART 4: Liquidation Bot — Step by Step

**No capital needed. Just gas.**

### How it works:
1. Bot monitors 99 Arkadiko vaults every 30 seconds
2. When STX price drops, some vaults fall below 150% collateral ratio
3. Bot calls `liquidate-vault` — Arkadiko pays you a trigger fee
4. Stability pool USDA repays the vault debt automatically

### What triggers liquidations:
- STX drops sharply (10%+ in a day)
- A vault owner borrowed too much relative to collateral
- Any vault below 150% collateral ratio is fair game

### Running it live:
```bash
EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs
```

### To watch specific vaults at risk:
```bash
VAULT_OWNERS=SP1...,SP2... EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs
```

### Scan faster during volatile markets:
```bash
INTERVAL_MS=10000 EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs
```

---

## PART 5: Reading Bot Output

### Opportunity Scanner Output Explained:

```
[1] BITFLOW STX/stSTX ARB
  stSTX/STX ratio: 1.193        ← stSTX worth 19.3% more than STX (staking reward)
  Est. profit: -0.315 STX       ← negative = not profitable right now
  No arb — wait for cycle boundary

[2] ARKADIKO USDA PEG
  USDA implied price: $1.047 (+4.78%)  ← USDA trading 4.78% ABOVE dollar
  *** USDA ABOVE PEG ***               ← action signal
  No USDA in wallet to sell.           ← need to open vault first

[3] ALEX STX/USDA pool
  Could not fetch                      ← API rate limited, try again

[4] POOL HEALTH
  Balance: 30 STX | Loans: 0 | Fees: 0.000 STX
  Share value: 1.000000 STX/share      ← increases as arb profits compound
```

### Liquidation Bot Output Explained:

```
STX price (oracle): $0.1100       ← current price from Arkadiko oracle
Stability pool USDA: 73.35        ← max vault debt that can be liquidated now
Checking 99 vault(s)...           ← monitoring all known vault owners

  Vault: SP1ABC...
  Collateral: 500 STX             ← what's locked
  Debt: 450 USDA                  ← what they owe
  Ratio: 1.223x [AT RISK]         ← below 1.65 warning threshold
  ← Will trigger if STX drops another 5%

Summary: 99 vaults checked | 0 liquidatable | 2 at risk
```

### P&L Summary:
```bash
/opt/homebrew/bin/node --env-file=.env scripts/logger.mjs
```

---

## PART 6: APY PROJECTIONS

### With 5,500 STX (~$1,243 at $0.226)

**Recommended allocation:**

| Strategy | STX | Role |
|----------|-----|------|
| Liquidation gas reserve | 500 STX | Pay for triggers |
| LP pool deposit | 2,000 STX | Earn flash loan fees |
| Vault collateral | 3,000 STX | USDA peg trading |

---

### Strategy 1: Liquidation Bot (passive, zero capital at risk)

**Assumptions:**
- 99 vaults monitored
- STX volatile market: ~2 liquidations per week average
- Average vault size: 300 STX collateral
- Trigger fee: ~0.5% of collateral = ~1.5 STX per liquidation
- Gas cost: 0.3 STX per trigger

| Timeframe | Liquidations | Gross | Gas | Net STX | Net USD |
|-----------|-------------|-------|-----|---------|---------|
| 1 week    | 2           | 3.0   | 0.6 | 2.4     | $0.54   |
| 1 month   | 8           | 12.0  | 2.4 | 9.6     | $2.17   |
| 1 year    | 96          | 144   | 29  | 115     | $26     |

**Note:** In a volatile year with a major STX price crash, you could see 50+ liquidations in a single week. This strategy pays more when markets are most chaotic.

---

### Strategy 2: USDA Peg Trading (periodic, requires vault)

**Assumptions:**
- Open vault: 3,000 STX collateral → mint ~1,000 USDA (at 300% ratio)
- Peg deviation >2%: occurs ~6 times per year (based on Arkadiko history)
- Average spread captured: 3% per cycle
- Each cycle: mint/sell above peg → wait → buy back at peg → close

| Per cycle | USDA sold | Spread | Profit USD |
|-----------|-----------|--------|-----------|
| 1 trade   | 1,000 USDA | 3%    | ~$30      |

| Timeframe | Cycles | Profit USD |
|-----------|--------|-----------|
| 1 month   | 0.5    | ~$15      |
| 1 year    | 6      | ~$180     |

**APY:** $180 profit on $678 collateral value (3,000 STX × $0.226) = **~26.5% APY**

---

### Strategy 3: LP Pool Deposit (passive yield from flash loan fees)

**Assumptions:**
- Deposit: 2,000 STX
- Fee per loan: 0.05%
- Utilization (conservative, early stage): 10% of pool per month
- As borrowers increase, utilization grows

| Month | Utilization | Monthly loans | Fees (STX) | Annual |
|-------|------------|---------------|-----------|--------|
| Early stage | 10% | 2 loans | 0.001 STX | ~0.01% APY |
| Growth stage | 60% | 12 loans | 0.006 STX | ~0.07% APY |
| Mature | 80% daily | 240 loans/yr | 0.12 STX | ~0.6% APY |

**Honest:** LP fees are near zero today because there are no borrowers yet. This grows with ecosystem adoption. The LP pool's real value right now is as a **balance sheet for the protocol** — TVL that makes flash loans possible and signals seriousness to investors.

---

### TOTAL 1-YEAR PROJECTION (5,500 STX)

| Source | Annual Profit |
|--------|--------------|
| Liquidation triggers | ~$26 |
| USDA peg trading | ~$180 |
| LP pool fees (early stage) | ~$1 |
| **Total** | **~$207** |
| APY on 5,500 STX ($1,243) | **~16.6%** |

**In a high-volatility year** (STX drops 30%+, USDA depegs more frequently):
- Liquidations: 50+ events → $200+
- USDA peg trades: 12+ cycles → $360+
- **Total: $560+ → ~45% APY**

---

## PART 7: OTHER DEXes IT CAN INTEGRATE WITH

### Currently Active (Stacks Ecosystem)

| DEX | Status | Strategy Possible |
|-----|--------|------------------|
| **Bitflow** | Fully integrated | STX/stSTX arb flash loan |
| **Arkadiko** | Fully integrated | USDA peg + liquidations |
| **ALEX** | Monitored | Price feeds, arb detection |
| **Velar** | Monitored | Price feeds, arb detection |

### Can Be Added (Stacks Ecosystem)

| DEX | Integration Effort | Strategy |
|-----|-------------------|---------|
| **StackingDAO** | Medium | stSTX yield arbitrage |
| **Zest Protocol** | Medium | Lending rate arbitrage |
| **Pontis** | Medium | Cross-chain bridge arb |
| **LNSwap** | High | BTC/STX atomic swaps |
| **Granite** | Medium | Lending liquidations |

### Can This Work in Other Ecosystems?

**The JS bot scripts (monitor-liquidations.mjs, monitor-opportunities.mjs):**
- The liquidation bot logic works on ANY lending protocol that has:
  - A collateral ratio threshold
  - A public liquidation function
  - An API to query vault state
- **Can be ported to:** Aave (Ethereum), Venus (BSC), Moonwell (Base), MarginFi (Solana)
- **Effort:** Rewrite contract addresses and function calls (~1 day per protocol)

**The Clarity smart contracts (flash loan core):**
- Clarity only runs on Stacks — not portable
- But the architecture is identical to Aave's so if Stacks gets more TVL, the same contracts scale

**The monitoring framework:**
- DEX-agnostic — any DEX with a read-only price function can be added
- Adding a new DEX = add constants + one function in monitor-opportunities.mjs

---

## PART 8: WHAT MAKES THIS BETTER THAN HUMMINGBOT

| Feature | Hummingbot | FlashStack Bot |
|---------|-----------|---------------|
| Flash loans | No | Yes — zero capital arb |
| Bitcoin L2 | No | Yes — Stacks native |
| On-chain liquidations | No | Yes |
| Requires exchange API | Yes | No — reads chain directly |
| Custom strategies | Plugin system | JS functions (simpler) |
| Capital at risk per trade | Yes | No (flash loans) |
| Open source | Yes | Yes |
| Trade logging | Yes | Yes (trades.jsonl) |
| Paper trading | Yes | Yes (dry-run mode) |

**The core advantage:** Hummingbot needs capital for every trade. FlashStack uses flash loans — you borrow, execute, repay in one block with zero capital at risk. That is structurally different and structurally superior for arb strategies.

---

## PART 9: AAVE V3 LIQUIDATION BOT

**Best strategy for investors** — 0.05% flash loan fee, $0.01 gas on Arbitrum, ~7% liquidation bonus.

### Why Aave > Venus > PancakeSwap Flash Loans:
| | Aave | PancakeSwap (Venus) |
|--|------|---------------------|
| Flash loan fee | **0.05%** | 0.25% (5x more) |
| Gas (Arbitrum) | **~$0.01** | N/A |
| Bonus | **5–15%** | 8–10% |
| Net profit (avg) | **~6.95%** | ~7.75% but more fees |

### Running the Aave Bot (no capital, no API key):

```bash
# Scan Arbitrum (default — gas $0.01)
/opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Scan Ethereum (higher TVL, gas $5-20)
CHAIN=ethereum /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Faster scan during volatile market
INTERVAL_MS=10000 /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Raise profit floor (only alert for $50+ opportunities)
MIN_PROFIT_USD=50 /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Monitor specific addresses
BORROWERS=0x1...,0x2... /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs
```

### Going live (requires flash contract):

**Step 1:** Deploy `contracts/aave-liquidation-flash.sol` on Arbitrum
- Cost: ~$0.50–1.00 ETH gas for deployment

**Step 2:** Add to `.env`:
```bash
FLASH_CONTRACT=0x...your-deployed-contract...
PRIVATE_KEY=0x...your-arbitrum-wallet-key...
```

**Step 3:** Run live:
```bash
EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs
```

### Profit math (Arbitrum, 10% bonus asset):
| Position Size | Repay | Bonus | Flash Fee | Gas | Net |
|--------------|-------|-------|-----------|-----|-----|
| $1,000 debt | $500 | $50 | $0.25 | $0.01 | **~$49** |
| $10,000 debt | $5,000 | $500 | $2.50 | $0.01 | **~$497** |
| $100,000 debt | $50,000 | $5,000 | $25 | $0.01 | **~$4,975** |

Liquidations > $10,000 are rare but happen during market crashes. Smaller ones ($500–$2,000) happen weekly.

---

## PART 10: QUICK REFERENCE COMMANDS

```bash
# ── Stacks / Arkadiko bots ───────────────────────────────────────────────────
# Dry run (safe, no execution)
/opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs
/opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# Live liquidation bot
EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# Live USDA peg sell (when USDA > $1.00 and you have USDA in wallet)
EXECUTE_USDA=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs

# Live Bitflow arb + compound
EXECUTE=true COMPOUND=true LOAN_STX=50 /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs

# Buy USDA when below peg (spend 50 STX)
USDA_TRADE_STX=50 EXECUTE_USDA=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-opportunities.mjs

# P&L summary
/opt/homebrew/bin/node --env-file=.env scripts/logger.mjs

# Scan faster (volatile market)
INTERVAL_MS=10000 EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# Monitor specific vaults
VAULT_OWNERS=SP1...,SP2... EXECUTE=true /opt/homebrew/bin/node --env-file=.env scripts/monitor-liquidations.mjs

# Watch USDA peg and alert when > 2% deviation
WATCH=true MIN_DEVIATION=2.0 /opt/homebrew/bin/node --env-file=.env scripts/usda-peg-trade.mjs

# ── Aave V3 bot (Arbitrum / Ethereum) ───────────────────────────────────────
# Scan Arbitrum (free, works now — no API key needed)
/opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Scan Ethereum mainnet
CHAIN=ethereum /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# Live mode (requires FLASH_CONTRACT deployed)
EXECUTE=true FLASH_CONTRACT=0x... /opt/homebrew/bin/node --env-file=.env scripts/monitor-aave-liquidations.mjs

# ── Venus / BSC bot ──────────────────────────────────────────────────────────
# Scan BSC (requires BSCSCAN_API_KEY for borrower discovery)
BSCSCAN_API_KEY=... /opt/homebrew/bin/node --env-file=.env scripts/monitor-venus-liquidations.mjs
```

---

*Last updated: April 2026 | FlashStack v1.2*
