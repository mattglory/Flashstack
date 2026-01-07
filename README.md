# FlashStack 

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Testnet](https://img.shields.io/badge/testnet-LIVE-success)](https://explorer.hiro.so)
[![Volume](https://img.shields.io/badge/volume-27M_sBTC-blue)](./docs/archive/COMPLETE_SUCCESS.md)
[![Success Rate](https://img.shields.io/badge/success_rate-100%25-brightgreen)](./docs/archive/COMPLETE_SUCCESS.md)

> **Flash loans for Bitcoin Layer 2 - Built for Bitcoin's security model**  
> Enabling instant, trustless capital for DeFi strategies on Stacks blockchain

**Developer:** [Glory Matthew](https://github.com/mattglory) | **Status:** Security-Hardened Testnet | Audit Funding Requested | Mainnet Q1 2026 | Network: Stacks Testnet
---

## Overview

FlashStack is a flash loan protocol that brings instant, uncollateralized liquidity to Bitcoin Layer 2. Built specifically for Bitcoin's security model and finality guarantees, FlashStack enables capital-efficient DeFi strategies previously impossible in the Bitcoin ecosystem.

### Key Metrics (Testnet)

```
 27,000,000 sBTC Processed
 8 Receiver Contracts Deployed
 100% Success Rate  
 Zero Inflation (Atomic Mint-Burn)
 0.05% Fee (Competitive with Ethereum)
```

### Live Testnet Deployment
- **Testnet Address:** ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7
- **Explorer:** [View on Stacks Explorer](https://explorer.hiro.so/txid/ST3JAZD8CJ9XX3WNN2G61C7HD4RY333MRKPR5JGW7.flashstack-core?chain=testnet)
- **Latest Security Update:** January 5, 2026 (Commit 13b4b60)
  
### Architecture

- **Core Protocol:** Atomic flash minting of sBTC with mandatory same-block repayment
- **Security Model:** Built for Bitcoin's block times and finality requirements
- **Integration Ready:** Works seamlessly with yield aggregators and DeFi protocols

[ Complete Test Results](./docs/archive/COMPLETE_SUCCESS.md) | [ Documentation](./docs)

---

## Problem & Solution

### The Problem

Bitcoin DeFi lacks capital-efficient primitives that made Ethereum DeFi successful:
- Locked STX cannot be used for arbitrage or liquidations
- Users must hold significant capital for DeFi strategies
- No instant liquidity without giving up custody
- Limited composability between protocols

### The Solution

FlashStack enables atomic, uncollateralized loans within a single Bitcoin L2 block:

1. Flash mint sBTC instantly
2. Execute profitable strategy (arbitrage, liquidation, compounding)
3. Repay loan + 0.05% fee
4. Transaction completes atomically or reverts entirely

**Result:** Capital-efficient strategies with zero custody risk and no liquidation exposure.

---

## How It Works

### For Users

```clarity
1. Request flash loan of 0.5 sBTC
2. FlashStack mints sBTC instantly
3. Execute your profitable action
4. Repay sBTC + 0.05% fee (0.0025 sBTC)
5. All in one atomic transaction
```

**Use Cases:**
- Arbitrage across DEXs without capital
- Liquidate undercollateralized positions for rewards
- Compound yields without selling positions
- Rebalance portfolios atomically

### For Developers

```clarity
;; Implement the flash receiver trait
(impl-trait .flash-receiver-trait.flash-receiver-trait)

(define-public (execute-flash (amount uint) (borrower principal))
  (let ((fee (/ (* amount u50) u100000)))
    ;; Your profitable strategy here
    
    ;; Repay flash loan + fee
    (try! (contract-call? .sbtc-token transfer 
      (+ amount fee) borrower .flashstack-core none))
    (ok true)
  )
)
```

[ Integration Guide](./docs/02-technical/INTEGRATION_GUIDE.md) | [ API Reference](./docs/02-technical/API_REFERENCE.md)

---

## Competitive Positioning

### vs Traditional Leverage

| Feature | Traditional | FlashStack |
|---------|------------|------------|
| Collateral Risk |  Liquidation risk |  No liquidation |
| Time Required |  Hours/days |  Single block |
| Interest Costs |  Ongoing fees |  0.05% one-time |
| Capital Required |  Significant |  None (flash) |
| Custody |  Give up assets |  Never lose custody |

### vs Other Flash Loan Protocols

| Protocol | Network | Fee | Status |
|----------|---------|-----|--------|
| **FlashStack** | **Stacks L2** | **0.05%** | ** Live** |
| Aave | Ethereum | 0.09% |  Live |
| dYdX | Ethereum | 0.05% |  Live |
| Balancer | Ethereum | 0.00%* |  Live |

*Additional costs (gas, MEV, arbitrage)

**Differentiation:** Bitcoin-native design respecting Bitcoin's block times, finality, and security model - not a direct Ethereum port.

---

## Ecosystem Integration

### Part of Complete DeFi Infrastructure

FlashStack integrates with [SNP (Stacks Nexus Protocol)](https://github.com/mattglory/snp-mvp), creating Bitcoin's first flash loan + yield aggregation ecosystem.

**Combined Capabilities:**
-  **Auto-Compounding** - Harvest and reinvest yields using flash capital
-  **Instant Rebalancing** - Move between strategies atomically  
- 📈 **Leveraged Positions** - Amplify yields without liquidation risk
-  **Protocol Optimization** - Automatic yield maximization

These integrated features are unique to this ecosystem and unavailable on other Bitcoin Layer 2 protocols.

[View Integration Guide](./docs/02-technical/SNP_INTEGRATION.md)

---

## Use Cases (8 Production Receivers)

FlashStack includes 8 battle-tested receiver contracts demonstrating real-world applications:

### 1. Arbitrage Trading (`example-arbitrage-receiver`)
Execute price differences across DEXs with zero capital requirement

### 2. Liquidation Bot (`liquidation-receiver`)
Capture liquidation bonuses without holding capital

### 3. Leverage Loops (`leverage-loop-receiver`)
Build 3x+ leveraged positions in one transaction

### 4. Collateral Swaps (`collateral-swap-receiver`)
Swap collateral types without closing positions

### 5. Yield Optimization (`yield-optimization-receiver`)
Auto-compound yields by borrowing capital to harvest and reinvest

### 6. DEX Aggregation (`dex-aggregator-receiver`)
Route through multiple DEXs for optimal execution

### 7. Multi-DEX Arbitrage (`multidex-arbitrage-receiver`)
Complex multi-hop arbitrage across 3+ venues

### 8. SNP Integration (`snp-flashstack-receiver`)
Enable flash-powered yield aggregation strategies

[ View All Receivers](./contracts) | [ Developer Docs](./docs/02-technical)

---

## Technical Architecture

### Core Contracts

```
flashstack-core.clar (312 LOC)
├── flash-mint()           Main flash loan function
├── calculate-fee()        0.05% fee calculation
├── pause/unpause()        Emergency controls
└── get-stats()           Protocol statistics

sbtc-token.clar (143 LOC)
├── mint/burn()           Atomic token operations
├── set-flash-minter()    Access control
Hliance    Standard token interface

flash-receiver-trait.clar (12 LOC)
└── execute-flash()       Receiver interface
```

### Security Features

-  **Atomic Execution** - Entire transaction reverts if repayment fails
-  **Zero Custody** - FlashStack never holds user funds
-  **Inflation Protection** - Atomic mint-burn guarantees zero inflation
-  **Emergency Pause** - Circuit breaker for critical issues
-  **Access Control** - Admin functions protected
-  **Fee Limits** - Maximum 1% fee enforced in code

[ Security Policy](./SECURITY.md) | [ Architecture Details](./docs/01-project/ARCHITECTURE.md)

---

## Installation & Quick Start

### Prerequisites

- Node.js 18+
- Clarinet 2.0+
- Git

### Setup

```bash
# Clone repository
git clone https://github.com/mattglory/flashstack.git
cd flashstack

# Install dependencies
npm install

# Verify contracts compile
clarinet check

# Run test suite
npm test
```

### Try Your First Flash Loan

```bash
# Start Clarinet console
clarinet console
```

```clarity
;; In console: Set up flash minter
(contract-call? .sbtc-token set-flash-minter .flashstack-core)

;; Execute flash loan
(contract-call? .flashstack-core flash-mint 
  u10000000  ;; 0.1 sBTC
  .test-receiver)

;; Check protocol stats
(contract-call? .flashstack-core get-stats)
```

[ Complete Quickstart](./QUICKSTART.md) | [ Full Documentation](./docs)

---

## Roadmap

###  Phase 1: MVP (December 2025)
- Core flash loan protocol
- sBTC token integration
- 8 receiver contract examples
- Comprehensive testing (100% success)
- Testnet deployment (27M sBTC processed)

###  Phase 2: Mainnet Launch (Q1 2026)
- Security audit
- Mainnet deployment
- PoX-4 collateral integration
- DEX integrations (ALEX, Velar, Bitflow)
- Analytics dashboard

### 🚀 Phase 3: Ecosystem Growth (Q2 2026)
- Web application interface
- Advanced receiver strategies
- Dynamic fee market
- Multi-asset support

###  Phase 4: DeFi Infrastructure (Q3 2026)
- Developer SDK
- Strategy marketplace
- Partnership integrations
- Governance framework

[ Detailed Roadmap](./docs/01-project/ROADMAP.md)

---

## Economics

- **Flash Loan Fee:** 0.05% (50 basis points)
- **Fee Range:** 0.05% - 1.00% (admin configurable)
- **Current Setting:** 0.05% (10
### Fee Structurex cheaper than some Ethereum competitors)

### Revenue Model
Fees collected per flash mint, scaling with protocol usage

### Projected Performance
- **Target Volume:** $10M+ monthly
- **Est. Revenue:** $5K - $50K monthly (at 0.05%)
- **Growth Potential:** 10-100x with sBTC adoption

[ Financial Model](./docs/01-project/FINANCIAL_MODEL.md)

---

## Contributing

FlashStack welcomes contributions from the community:

**Ways to Contribute:**
-  Report bugs and issues
-  Suggest new features
-  Submit pull requests
-  Improve documentation
-  Create receiver examples

[ Contributing Guide](./CONTRIBUTING.md) | [ Security Policy](./SECURITY.md)

---

## Documentation

### Getting Started
- [README](./README.md) - Overview and quick start
- [Quickstart Guide](./QUICKSTART.md) - 5-minute setup
- [Installation](./QUICKSTART.md#installation) - Detailed setup instructions

### Developer Resources
- [Integration Guide](./docs/02-technical/INTEGRATION_GUIDE.md) - Build receivers
- [API Reference](./docs/02-technical/API_REFERENCE.md) - Complete API documentation
- [Smart Contracts](./docs/02-technical/SMART_CONTRACTS.md) - Contract specifications
- [Testing Guide](./TESTING_GUIDE.md) - Test development

### Ecosystem
- [Architecture](./docs/01-project/ARCHITECTURE.md) - System design
- [Roadmap](./docs/01-project/ROADMAP.md) - Development timeline
- [SNP Integration](./docs/02-technical/SNP_INTEGRATION.md) - Yield aggregator integration

[ Complete Index](./docs/INDEX.md)

---

## Community & Links

- **Repository:** [github.com/mattglory/flashstack](https://github.com/mattglory/flashstack)
- **Developer:** [Glory Matthew](https://github.com/mattglory)
- **Testnet Explorer:** [explorer.hiro.so](https://explorer.hiro.so)
- **Stacks Discord:** [stacks.chat](https://stacks.chat)
- **Stacks Forum:** [forum.stacks.org](https://forum.stacks.org)

---

## License

MIT License - see [LICENSE](./LICENSE) for details

---

## About the Developer

**Glory Matthew** ([@mattglory](https://github.com/mattglory))
- Code4STX Program Participant
- LearnWeb3 Level 34 Master
- Bitcoin DeFi Infrastructure Builder
- Creator of SNP (Stacks Nexus Protocol)

**Mission:** Building production-grade DeFi infrastructure for Bitcoin's Layer 2 ecosystem

---

<div align="center">

**FlashStack** - Instant capital for Bitcoin DeFi

Built on Stacks. Secured by Bitcoin.

[🚀 Documentation](./docs) • [ Community](https://stacks.chat) • [ Report Issue](https://github.com/mattglory/flashstack/issues)

</div>

---

**Last Updated:** January 5, 2026  
**Status:**  Security-Hardened Testnet | Audit Funding Requested | Mainnet Q1 2026 
**Repository:** https://github.com/mattglory/flashstack

