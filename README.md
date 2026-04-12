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

All 13 contracts are live on Stacks mainnet:

| Contract | Address |
|---|---|
| `flashstack-core` | [`SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core`](https://explorer.hiro.so/address/SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flashstack-core) |
| `sbtc-token` | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.sbtc-token` |
| `flash-receiver-trait` | `SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.flash-receiver-trait` |

### Confirmed Mainnet Flash Loans

| # | Amount | Receiver | Strategy |
|---|---|---|---|
| 1 | 0.01 sBTC | `test-receiver` | Basic demonstration |
| 2 | 0.05 sBTC | `test-receiver` | Basic demonstration |
| 3 | 0.10 sBTC | `dex-aggregator-receiver` | DEX arbitrage |

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
