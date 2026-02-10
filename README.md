# FlashStack

**The First Flash Loan Protocol for Bitcoin Layer 2**

[![Status](https://img.shields.io/badge/Status-Security--Hardened%20Testnet-green)]()
[![Testnet](https://img.shields.io/badge/Testnet-Live-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-60%20Passing-success)]()
[![Clarity](https://img.shields.io/badge/Clarity-2%20%26%203-blue)]()
[![License](https://img.shields.io/badge/License-MIT-yellow)]()

> Atomic, uncollateralized flash loans on Stacks blockchain. Borrow capital, execute your strategy, and repay — all in one transaction. If repayment fails, the entire transaction reverts.

---

## Quick Start

### Smart Contracts

```bash
git clone https://github.com/mattglory/flashstack.git
cd flashstack
npm install
npm test          # 60 tests passing
npm run check     # Clarinet contract verification
```

**Requirements:** Node.js 16+, npm 7+, [Clarinet](https://github.com/hirosystems/clarinet) 2.0+

### Frontend Dashboard

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

The dashboard connects to the live testnet deployment and shows real-time protocol stats, wallet connection via Leather/Xverse, and user position data.

---

## Testnet Deployment

| | Address | Deployed |
|---|---|---|
| **Current (v1.2)** | [`ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7`](https://explorer.hiro.so/txid/ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7.flashstack-core?chain=testnet) | Jan 5, 2026 |
| **Previous** | [`ST2X1GBHA2WJXREWP231EEQXZ1GDYZEEXYRAD1PA8`](https://explorer.hiro.so/address/ST2X1GBHA2WJXREWP231EEQXZ1GDYZEEXYRAD1PA8?chain=testnet) | Dec 7, 2025 |

---

## How It Works

FlashStack uses an **atomic mint-burn architecture**:

1. User calls `flash-mint` with an amount and a receiver contract
2. Protocol mints sBTC to the receiver (amount + fee)
3. Receiver executes its strategy (arbitrage, liquidation, etc.)
4. Receiver repays the full amount + fee back to the protocol
5. Protocol burns the returned tokens

If step 4 fails, the entire transaction reverts — no funds are at risk.

---

## Integration Guide

### Build a Flash Loan Receiver

Implement the `flash-receiver-trait` to create your own strategy:

```clarity
(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  (let (
    (fee (/ (* amount u50) u100000))    ;; 0.05% fee
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

### Read Protocol Data with @stacks/transactions

Query on-chain stats from your JavaScript/TypeScript app:

```typescript
import { fetchCallReadOnlyFunction, cvToJSON } from "@stacks/transactions";
import { STACKS_TESTNET } from "@stacks/network";

const CONTRACT = "ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7";

// Fetch protocol stats
const result = await fetchCallReadOnlyFunction({
  contractAddress: CONTRACT,
  contractName: "flashstack-core",
  functionName: "get-stats",
  functionArgs: [],
  network: STACKS_TESTNET,
  senderAddress: CONTRACT,
});

const stats = cvToJSON(result);
// stats.value.value => { total-flash-mints, total-volume, total-fees-collected, current-fee-bp, paused }
```

### Connect a Wallet with @stacks/connect

```typescript
import { connect, disconnect, isConnected, getLocalStorage } from "@stacks/connect";

// Connect wallet (opens Leather/Xverse popup)
await connect();

// Check connection status
if (isConnected()) {
  const { addresses } = getLocalStorage();
  const stxAddress = addresses.stx[0].address;
  console.log("Connected:", stxAddress);
}

// Disconnect
disconnect();
```

### Call Flash Mint with @stacks/transactions

```typescript
import { request } from "@stacks/connect";

const result = await request("stx_callContract", {
  contract: "ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7.flashstack-core",
  functionName: "flash-mint",
  functionArgs: [
    "u1000000",                                    // amount in micro-sBTC
    "ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7.your-receiver"  // your receiver contract
  ],
});
```

---

## Architecture

### Core Contracts

| Contract | Purpose |
|---|---|
| `flashstack-core` | Main protocol — flash mint/burn, fees, circuit breaker, admin |
| `sbtc-token` | SIP-010 token interface (mock on testnet, real sBTC on mainnet) |
| `flash-receiver-trait` | Standard interface all receivers must implement |

### Receiver Examples (8 contracts)

| Receiver | Strategy |
|---|---|
| `test-receiver` | Basic flash loan demonstration |
| `example-arbitrage-receiver` | DEX arbitrage template |
| `liquidation-receiver` | Liquidation bot with bonus capture |
| `leverage-loop-receiver` | 3x+ leveraged positions |
| `collateral-swap-receiver` | Atomic collateral swapping |
| `yield-optimization-receiver` | Auto-compounding strategies |
| `dex-aggregator-receiver` | Multi-DEX optimal routing |
| `multidex-arbitrage-receiver` | Complex multi-hop arbitrage |

### Read-Only Functions

| Function | Returns |
|---|---|
| `get-stats()` | Total mints, volume, fees collected, fee rate, paused status |
| `get-stx-locked(principal)` | STX locked as collateral for a given address |
| `get-max-flash-amount(uint)` | Max borrowable sBTC for a given collateral amount |
| `get-max-single-loan()` | Circuit breaker: max single loan size |
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
- **Wallet Connection** — Leather/Xverse via @stacks/connect v8
- **Network Toggle** — switch between testnet and mainnet
- **User Position** — STX locked and max flash amount

**Tech:** Next.js 14 (App Router), TypeScript, Tailwind CSS, @stacks/connect, @stacks/transactions, @stacks/network

---

## Security

### Status: Testnet (not audited)

> **Do not use with real funds.** This protocol has not been professionally audited. Mainnet deployment will occur only after a clean audit and bug bounty program.

### Hardening (v1.2, January 2026)

- Admin auth upgraded from `tx-sender` to `contract-caller`
- Removed all `unwrap-panic` calls
- Added receiver whitelist (only approved contracts can borrow)
- Circuit breaker: max single loan 5 sBTC, max block volume 25 sBTC
- Emergency pause controls
- Comprehensive error handling

See commit [`13b4b60`](https://github.com/mattglory/flashstack/commit/13b4b60) for full diff.

---

## Testing

```bash
npm test                # Run all 60 tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

**Coverage areas:** initialization, admin access control, fee calculations (0.05%-1.00%), collateral ratios (300%), circuit breaker limits, whitelist management, flash loan execution, security edge cases.

Framework: [Vitest](https://vitest.dev/) + [Clarigen](https://github.com/mechanismHQ/clarigen) for type-safe Clarity testing.

See [TESTING.md](./TESTING.md) for details.

---

## Roadmap

- [x] Security hardening v1.2
- [x] Testnet deployment (12 contracts)
- [x] Test suite (60 tests)
- [x] Frontend dashboard
- [ ] Professional audit
- [ ] Bug bounty program
- [ ] Real sBTC integration
- [ ] DEX partnerships (ALEX, Bitflow, Velar)
- [ ] Mainnet deployment
- [ ] Multi-asset support
- [ ] Governance

---

## Project Structure

```
flashstack/
  contracts/              # 12 Clarity smart contracts
  tests/                  # 60 Vitest + Clarigen tests
  web/                    # Next.js 14 frontend dashboard
    src/
      app/                # App Router pages
      components/         # UI components (layout, wallet, dashboard)
      lib/                # Stacks integration, hooks, utils
  Clarinet.toml           # Contract configuration
  vitest.config.js        # Test configuration
```

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
