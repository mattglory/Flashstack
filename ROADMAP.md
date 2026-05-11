# FlashStack Roadmap

## Completed (Q4 2025 — Q1 2026)

### Protocol Foundation
- [x] Flash loan core contract deployed on Stacks mainnet (STX)
- [x] sBTC flash loan core deployed
- [x] LP pool contract — external depositors earn yield from fees
- [x] Flash receiver trait standard (SIP-compatible)
- [x] 21 contracts deployed and verified on mainnet
- [x] 86 passing tests across all contracts

### Receiver Ecosystem
- [x] Bitflow STX/stSTX arbitrage receiver
- [x] DEX aggregator receiver (multi-DEX routing)
- [x] Liquidation receiver
- [x] Leverage loop receiver
- [x] Collateral swap receiver
- [x] Yield optimization receiver
- [x] SNP integration receiver

### Monitoring Infrastructure
- [x] Liquidation monitor — watches 99 live Arkadiko vaults in real-time
- [x] Opportunity scanner — 6 live strategies monitored every 30s
- [x] USDA peg deviation detection
- [x] Cross-DEX price monitoring (ALEX, Velar, Arkadiko)

### Frontend
- [x] Next.js dashboard live at flashstack.xyz
- [x] Flash loan execution UI
- [x] LP pool deposit/withdraw UI
- [x] Arbitrage bot UI

---

## In Progress (Q2 2026)

### Protocol
- [ ] Formal security audit (Coinfabrik / CoinSentinel)
- [ ] Bug bounty program launch (up to 10,000 STX for critical)
- [ ] flashstack-stx-core v2 — multi-asset collateral support
- [ ] Governance token design

### Integrations
- [ ] Arkadiko vault liquidation receiver (direct JS approach validated)
- [ ] USDA peg trade automation (vault open + sell in one flow)
- [ ] Bitflow LP auto-compounder

### Infrastructure
- [ ] VPS deployment for 24/7 bot operation
- [ ] Alert system (email/webhook) for liquidation opportunities
- [ ] Dashboard live stats from on-chain data

---

## Planned (Q3 2026)

### Growth
- [ ] TVL growth campaign — target 100,000 STX in LP pool
- [ ] Developer SDK and documentation portal
- [ ] Receiver template library (10+ strategies)
- [ ] Integration with StackingDAO, Zest Protocol, Velar

### Protocol Expansion
- [ ] sBTC flash loans on mainnet (pending sBTC mainnet launch)
- [ ] Cross-protocol flash loan routing
- [ ] Governance contract deployment
- [ ] Fee tier system for large borrowers

---

## Long Term Vision

FlashStack aims to be the **primary flash loan infrastructure layer for Bitcoin DeFi** — on Stacks today, expanding to other Bitcoin L2s as the ecosystem matures.

The protocol is designed to be:
- **Permissionless** — anyone can borrow, anyone can provide liquidity
- **Composable** — any Clarity contract can be a receiver
- **Capital efficient** — zero idle capital for borrowers, continuous yield for LPs
- **Bitcoin-native** — secured by Bitcoin's proof of work

---

*Last updated: April 2026*
