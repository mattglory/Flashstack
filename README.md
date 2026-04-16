# FlashStack

**The First Flash Loan Protocol for Bitcoin Layer 2**

[![Status](https://img.shields.io/badge/Status-Mainnet%20Live-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-86%20Passing-success)]()
[![Clarity](https://img.shields.io/badge/Clarity-2-blue)]()
[![Live](https://img.shields.io/badge/Live-flashstack.vercel.app-blue)](https://flashstack.vercel.app)
[![License](https://img.shields.io/badge/License-MIT-yellow)]()

> Atomic, uncollateralized flash loans on Stacks blockchain. Borrow capital, execute your strategy, and repay — all in one transaction. If repayment fails, the entire transaction reverts.

---

## Mainnet Deployment

### STX Flash Loans (Reserve-Based) — New

| Contract | Address | Explorer |
|---|---|---|
| `flashstack-stx-core` | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core` | [View](https://explorer.hiro.so/txid/0x4c1a17483eb5bc42b4d7454ffc53f5b1fe4d18d1370b23b60199ee9d8d28ba70?chain=mainnet) |
| `stx-flash-receiver-trait` | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait` | [View](https://explorer.hiro.so/txid/0x767d17c6d8ef98998cd48ce4ad47ed0432d29e74fb0e8fc12b0b353e975e57cf?chain=mainnet) |
| `stx-test-receiver` | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.stx-test-receiver` | [View](https://explorer.hiro.so/txid/0xfead69fa92f54e5790ff1b17a9479e86716e93b66357726d8c9be336df558e45?chain=mainnet) |
| `bitflow-arb-receiver` | `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.bitflow-arb-receiver` | [View](https://explorer.hiro.so/txid/0x616449ab17cb75e3ddd4d2bbb2b7c38c0d4cd566b00035606d9a70bc08b637d4?chain=mainnet) |

Reserve: 80 STX seeded. Max single loan: 5,000 STX. Fee: 0.05%.

### sBTC Flash Loans (Mint/Burn) — Original

| Contract | Address |
|---|---|
| `flashstack-core` | [`SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core`](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core?chain=mainnet) |
| `sbtc-token` | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.sbtc-token` |
| `flash-receiver-trait` | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flash-receiver-trait` |

### Confirmed Mainnet Flash Loans

| # | Asset | Amount | Receiver | Tx |
|---|---|---|---|---|
| 1 | sBTC | 0.01 sBTC | `test-receiver` | Basic demonstration |
| 2 | sBTC | 0.05 sBTC | `test-receiver` | Basic demonstration |
| 3 | sBTC | 0.10 sBTC | `dex-aggregator-receiver` | DEX arbitrage |
| 4 | STX | 80 STX reserve deposited | `flashstack-stx-core` | [View](https://explorer.hiro.so/txid/0x9dd66a9d5372cb843d1ecfdf47138e7e91cf7597f807dafdbb7e129e1da23040?chain=mainnet) |

### Previous Testnet Deployment

| Version | Address | Date |
|---|---|---|
| v1.2 | [`ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7`](https://explorer.hiro.so/address/ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7?chain=testnet) | Jan 5, 2026 |

---

## Quick Start

### Smart Contracts

```bash
git clone https://github.com/mattglory/flashstack.git
cd flashstack
npm install
npm test          # 86 tests passing
npm run check     # Clarinet contract verification
```

**Requirements:** Node.js 16+, npm 7+, [Clarinet](https://github.com/hirosystems/clarinet) 2.0+

### Frontend Dashboard

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

The dashboard connects to the live mainnet deployment and shows real-time protocol stats, wallet connection via Leather/Xverse, and user position data.

---

## How It Works

FlashStack uses an **atomic mint-burn architecture**:

1. User calls `flash-mint` with an amount and a receiver contract
2. Protocol mints sBTC to the receiver (amount + fee)
3. Receiver executes its strategy (arbitrage, liquidation, etc.)
4. Receiver repays the full amount + fee back to the protocol
5. Protocol burns the returned amount; fee is transferred to treasury

If step 4 fails, the entire transaction reverts — no funds are at risk.

---

## Security

### Status: Mainnet (not audited)

> This protocol has not been professionally audited. Use at your own risk.

### Security Hardening (v1.2)

All findings from an independent security review were addressed:

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-01 | Critical | Anyone could call `mint` on sbtc-token | Fixed — flash-minter-only gate |
| C-02 | Critical | Reentrancy via receiver callback | Fixed — supply invariant check |
| H-01 | High | Supply inflates after each flash loan | Fixed — burn amount, transfer fee separately |
| H-02 | High | No collateral check before mint | Accepted — test override by design |
| H-03 | High | Fee hardcoded in receivers | Fixed — dynamic `get-fee-basis-points` call |
| M-01 | Medium | No circuit breaker | Fixed — max single loan 5 sBTC, max block 25 sBTC |
| M-02 | Medium | Wrong block height API | N/A — `block-height` correct for epoch 2.5 |
| M-03 | Medium | Simulated DEX prices unprotected | Fixed — owner-only setters |
| L-01 | Low | Fee rounds to zero for tiny loans | Fixed — minimum fee of 1 satoshi |
| L-02 | Low | Wrong error code from `set-fee` | Fixed — returns ERR-INVALID-AMOUNT (u104) |
| I-01 | Info | No treasury for fee accumulation | Accepted — treasury var added |
| I-02 | Info | Stale v2 contract deployed | Fixed — flashstack-core-v2 deleted |

---

## Arbitrage Strategies

Flash loans are uncollateralized — you borrow zero capital and only pay the Stacks tx fee (~$0.002). The protocol guarantees: if your repayment fails, everything reverts. You never lose your own capital, only the gas fee.

### Strategy 1: stSTX Peg Arbitrage (Bitflow)

stSTX accumulates staking yield. When yield accrues, stSTX briefly trades above 1:1 STX on Bitflow before arbitrageurs equalize it. `bitflow-arb-receiver` captures this atomically:

```
Borrow 1000 STX (free, uncollateralized)
  -> Swap 1000 STX -> 1012 stSTX on Bitflow (stSTX at 0.988 STX = above peg)
  -> Swap 1012 stSTX -> 1010 STX on Bitflow
  -> Repay 1000.05 STX (principal + 0.05% fee)
  -> Keep 9.95 STX profit, zero capital at risk
```

**When to run:** Watch for stSTX/STX ratio on Bitflow rising above 1.0005 (0.05% spread covers the fee).

### Strategy 2: Cross-DEX Price Arbitrage

Same token, different price on two DEXes (e.g. ALEX vs Velar):

```
Borrow 500 STX
  -> Buy TOKEN on ALEX at lower price
  -> Sell TOKEN on Velar at higher price
  -> Repay 500.025 STX + keep spread
```

### Strategy 3: Liquidation Bot

A DeFi lending protocol lists undercollateralized positions. You borrow STX, repay the borrower's debt, receive discounted collateral, sell it, repay the flash loan, keep the liquidation bonus.

```
Borrow 2000 STX
  -> Repay borrower's 2000 STX debt to lending protocol
  -> Receive 2200 STX worth of collateral (10% liquidation bonus)
  -> Sell collateral for 2200 STX
  -> Repay 2000.10 STX
  -> Keep 199.90 STX profit
```

### Economics Summary

| Role | Capital required | Risk | Profit source |
|---|---|---|---|
| Borrower (you) | 0 STX | ~$0.002 tx fee if strategy fails | Arb spread minus 0.05% fee |
| Reserve provider (admin) | 80+ STX locked | Reserve stays safe (reverts on failure) | 0.05% fee on every loan |

---

## Integration Guide

### Build a Flash Loan Receiver

Implement the `flash-receiver-trait` to create your own strategy:

```clarity
(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee-bp (unwrap! (contract-call? .flashstack-core get-fee-basis-points) (err u999)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
  )
    ;; === YOUR STRATEGY HERE ===
    ;; Examples: arbitrage, liquidation, leverage, collateral swap
    (try! (your-strategy-logic amount))

    ;; === REPAY THE LOAN ===
    (as-contract (contract-call? .sbtc-token transfer
      total-owed tx-sender .flashstack-core none))
  )
)
```

### Run Flash Loans via Script

```bash
DEPLOYER_MNEMONIC="your twelve word mnemonic here" \
DEPLOYER_ADDRESS="SP..." \
NETWORK=mainnet \
node scripts/run-flash-loans.mjs
```

**Never hardcode your mnemonic in source files.**

### Read Protocol Data

```typescript
import { fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import { STACKS_MAINNET } from "@stacks/network";

const CONTRACT = "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ";

const result = await fetchCallReadOnlyFunction({
  contractAddress: CONTRACT,
  contractName: "flashstack-core",
  functionName: "get-stats",
  functionArgs: [],
  network: STACKS_MAINNET,
  senderAddress: CONTRACT,
});

const stats = cvToJSON(result);
// { total-flash-mints, total-volume, total-fees-collected, current-fee-bp, paused }
```

### Connect a Wallet

```typescript
import { connect, disconnect, isConnected, getLocalStorage } from "@stacks/connect";

await connect();

if (isConnected()) {
  const { addresses } = getLocalStorage();
  const stxAddress = addresses.stx[0].address;
  console.log("Connected:", stxAddress);
}
```

### Call Flash Mint

```typescript
import { request } from "@stacks/connect";

const result = await request("stx_callContract", {
  contract: "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core",
  functionName: "flash-mint",
  functionArgs: [
    "u1000000",
    "SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.your-receiver"
  ],
});
```

---

## Architecture

### Core Contracts

| Contract | Purpose |
|---|---|
| `flashstack-core` | Main protocol — flash mint/burn, fees, circuit breaker, admin |
| `sbtc-token` | SIP-010 token interface (mock sBTC) |
| `flash-receiver-trait` | Standard interface all receivers must implement |

### Receiver Contracts (10)

| Receiver | Strategy |
|---|---|
| `test-receiver` | Basic flash loan demonstration |
| `simple-receiver` | Minimal receiver template |
| `example-arbitrage-receiver` | DEX arbitrage template |
| `liquidation-receiver` | Liquidation bot with bonus capture |
| `leverage-loop-receiver` | 3x leveraged positions |
| `collateral-swap-receiver` | Atomic collateral swapping |
| `yield-optimization-receiver` | Auto-compounding strategies |
| `dex-aggregator-receiver` | Multi-DEX routing via ALEX Lab AMM |
| `multidex-arbitrage-receiver` | Multi-hop arbitrage |
| `snp-flashstack-receiver-v3` | SNP integration for leveraged yield |

### Read-Only Functions

| Function | Returns |
|---|---|
| `get-stats()` | Total mints, volume, fees collected, fee rate, paused status |
| `get-stx-locked(principal)` | STX locked as collateral |
| `get-max-flash-amount(uint)` | Max borrowable sBTC for given collateral |
| `get-max-single-loan()` | Circuit breaker: max single loan |
| `get-max-block-volume()` | Circuit breaker: max volume per block |
| `is-paused()` | Protocol pause status |
| `get-fee-basis-points()` | Current fee in basis points |
| `calculate-fee(uint)` | Fee for a given loan amount |

### Error Codes

| Code | Meaning |
|---|---|
| `u100` | Not enough collateral |
| `u101` | Repayment failed |
| `u102` | Unauthorized (admin only) |
| `u103` | Receiver callback failed |
| `u104` | Invalid amount (must be > 0) |
| `u105` | Protocol is paused |
| `u106` | Receiver not on whitelist |
| `u107` | Loan exceeds single-loan limit |
| `u108` | Block volume limit exceeded |
| `u109` | PoX call failed |

---

## Frontend

The `web/` directory contains a Next.js 14 dashboard:

- **Protocol Stats** — live on-chain data with 30s auto-refresh
- **Flash Loan Execution** — submit flash loans with fee preview and receiver selection
- **Wallet Connection** — Leather/Xverse via @stacks/connect v8
- **Network Toggle** — switch between testnet and mainnet
- **User Position** — STX locked and max flash amount

**Live:** [flashstack.vercel.app](https://flashstack.vercel.app)

**Tech:** Next.js 14 (App Router), TypeScript, Tailwind CSS, @stacks/connect, @stacks/transactions, @stacks/network

### Frontend Configuration

```bash
# web/.env.local (testnet)
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_CONTRACT_ADDRESS=ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7

# web/.env.production (mainnet)
NEXT_PUBLIC_NETWORK=mainnet
NEXT_PUBLIC_CONTRACT_ADDRESS=SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ
```

---

## Testing

```bash
npm test                # Run all 86 tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

**Coverage:** initialization, admin access control, fee calculations (0.05%-1.00%), collateral ratios (300%), circuit breaker limits, whitelist management, flash loan execution, end-to-end mint-burn cycle, boundary value testing, admin transfer security, SNP receiver integration, sbtc-token operations.

Framework: [Vitest](https://vitest.dev/) + [Clarigen](https://github.com/mechanismHQ/clarigen)

See [TESTING.md](./TESTING.md) for details.

---

## Project Structure

```
flashstack/
  contracts/              # 13 Clarity smart contracts
  tests/                  # 86 Vitest + Clarigen tests
  scripts/                # Flash loan executor (env-var driven)
  web/                    # Next.js 14 frontend dashboard
    src/
      app/                # App Router pages
      components/         # UI components
      lib/                # Stacks integration, hooks, utils
  Clarinet.toml           # Contract configuration
  vitest.config.js        # Test configuration
```

---

## Roadmap

- [x] Security hardening (all audit findings addressed)
- [x] Mainnet deployment (13 contracts)
- [x] Test suite (86 tests)
- [x] Frontend dashboard with flash loan execution UI
- [x] DEX integration (ALEX Lab AMM in dex-aggregator-receiver)
- [ ] Professional audit
- [ ] Bug bounty program
- [ ] Real sBTC integration
- [ ] DEX partnerships (ALEX, Bitflow, Velar)
- [ ] Multi-asset support
- [ ] Governance

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-receiver`)
3. Add tests for your changes
4. Submit a pull request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT](./LICENSE)

---

## Author

**Glory Matthew** ([@mattglory](https://github.com/mattglory))

- Twitter: [@mattglory_](https://twitter.com/mattglory_)
- Email: mattglory14@gmail.com
