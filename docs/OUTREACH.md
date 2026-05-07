# FlashStack Outreach Templates

## X Thread

---

**Tweet 1 (main)**
FlashStack is live on Stacks Mainnet.

Flash loans for STX and canonical sBTC — zero collateral, single atomic transaction.

If repayment fails, the whole thing reverts. No risk to the protocol, no risk to you (beyond ~$0.001 gas).

Here's what we've built:

**Tweet 2**
Two flash loan engines live on mainnet:

STX core → SP20XD46...flashstack-stx-core
sBTC core → SP20XD46...flashstack-sbtc-core

Both proven with confirmed mainnet transactions including a live Bitflow DEX round-trip (STX → stSTX → STX in one tx).

**Tweet 3**
Confirmed mainnet flash loans:

1/ STX + Bitflow arb receiver — STX borrowed, swapped on Bitflow stableswap, repaid + fee
https://explorer.hiro.so/txid/0xabd33fc46ffa204ce61f25664f057e414063f28ce75c8387a6df9116453110cb?chain=mainnet

2/ Canonical sBTC flash loan — real Bitcoin, borrowed and repaid atomically
https://explorer.hiro.so/txid/0xc9d8e86f5ffcfc61537a25d6108a4b8ac0cf075568027a878cf2e9bcf6d53b4e?chain=mainnet

**Tweet 4**
Want to build on top of FlashStack?

Implement one Clarity function → deploy → get whitelisted → access up to 5,000 STX or 0.1 BTC per transaction.

Testing guide (STX): https://github.com/mattglory/Flashstack/blob/main/docs/TESTING_GUIDE_STX.md
Testing guide (sBTC): https://github.com/mattglory/Flashstack/blob/main/docs/TESTING_GUIDE_SBTC.md

DM or reply to get your receiver whitelisted.

**Tweet 5**
Try it now:
https://flashstack.vercel.app/flash-loan

Open source:
https://github.com/mattglory/Flashstack

Built on @Stacks with canonical @sBTC — first flash loan protocol on Bitcoin L2.

---

## Stacks Discord — #builders

**Message:**

Hey builders — FlashStack is live on Stacks Mainnet and we're opening up external testing.

**What it is:** Flash loan protocol for STX and canonical sBTC. Borrow up to 5,000 STX or 0.1 BTC with zero collateral in a single atomic transaction. If your receiver doesn't repay, the tx reverts — no risk to the protocol.

**What's deployed:**
- `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core`
- `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core`

**Confirmed mainnet txs:**
- STX + Bitflow arb: https://explorer.hiro.so/txid/0xabd33fc46ffa204ce61f25664f057e414063f28ce75c8387a6df9116453110cb?chain=mainnet
- sBTC flash loan: https://explorer.hiro.so/txid/0xc9d8e86f5ffcfc61537a25d6108a4b8ac0cf075568027a878cf2e9bcf6d53b4e?chain=mainnet

**To build a receiver:** implement one function (`execute-stx-flash` or `execute-sbtc-flash`), deploy, and reply here with your contract address — I'll whitelist it.

Testing guides:
- STX: https://github.com/mattglory/Flashstack/blob/main/docs/TESTING_GUIDE_STX.md
- sBTC: https://github.com/mattglory/Flashstack/blob/main/docs/TESTING_GUIDE_SBTC.md

Frontend: https://flashstack.vercel.app
GitHub: https://github.com/mattglory/Flashstack

---

## Stacks Discord — #defi

**Message:**

Flash loans are now live on Stacks Mainnet — both STX and canonical sBTC.

FlashStack lets you borrow up to 5,000 STX or 0.1 BTC with zero collateral, atomically. Standard flash loan pattern: borrow → execute strategy → repay in one block. No repayment = full revert.

Proven on-chain:
- STX flash loan + Bitflow DEX round-trip confirmed ✅
- Canonical sBTC flash loan confirmed ✅

Use cases: arbitrage, liquidations, collateral swaps, leveraged yield.

Try it: https://flashstack.vercel.app/flash-loan
GitHub: https://github.com/mattglory/Flashstack

If you're building a DeFi strategy on Stacks and want to integrate — reply here or DM.

---

## Bitflow Outreach

**To:** Bitflow team (X DM or Discord)
**Subject/opener:** FlashStack x Bitflow integration

Hey Bitflow team,

I'm the builder behind FlashStack — a flash loan protocol on Stacks Mainnet. We already have a working Bitflow integration: `bitflow-arb-receiver` borrows STX via flash loan and executes a round-trip on your STX/stSTX stableswap in one atomic transaction.

Confirmed mainnet tx:
https://explorer.hiro.so/txid/0xabd33fc46ffa204ce61f25664f057e414063f28ce75c8387a6df9116453110cb?chain=mainnet

Would love to explore a few things:
1. Could you mention FlashStack as a flash loan source for Bitflow arbitrage bots?
2. We're building sBTC arbitrage receivers — interested in a joint receiver that targets Bitflow's sBTC pools?
3. Any Bitflow pools you'd want dedicated FlashStack receiver templates for?

Happy to build the integration and open-source it. This makes Bitflow more attractive to MEV bots and arb searchers.

GitHub: https://github.com/mattglory/Flashstack
Frontend: https://flashstack.vercel.app

— Glory / @flashstackbtc

---

## Zest Protocol Outreach

**To:** Zest Protocol team (X DM or Discord)
**Subject/opener:** FlashStack — flash liquidation receiver for Zest

Hey Zest team,

I'm building FlashStack — a flash loan protocol for STX and canonical sBTC on Stacks Mainnet. Both engines are live and confirmed on mainnet.

Flash loans are a natural fit for Zest: when a borrowing position becomes undercollateralised, a liquidator can use a FlashStack flash loan to fund the liquidation without putting up their own capital — borrow sBTC, liquidate the Zest position, repay in one atomic tx.

I'd love to:
1. Build a Zest liquidation receiver for FlashStack (open-source, MIT)
2. Understand your liquidation interface so the receiver targets it correctly
3. Explore any joint announcement once it's working

This gives Zest a liquidation engine and gives FlashStack a compelling real-world use case.

GitHub: https://github.com/mattglory/Flashstack

— Glory / @flashstackbtc

---

## ALEX Lab Outreach

**To:** ALEX Lab team (X DM or Discord)
**Subject/opener:** FlashStack integration with ALEX pools

Hey ALEX team,

I'm the builder behind FlashStack — the first flash loan protocol on Stacks, supporting both STX and canonical sBTC. Live on mainnet with confirmed transactions.

ALEX has deep sBTC liquidity. FlashStack could be the flash loan layer that powers arbitrage and liquidations across ALEX pools — borrow sBTC atomically, execute on ALEX, repay in one tx.

Specifically interested in:
1. Building an ALEX sBTC arbitrage receiver (open-source)
2. Whether ALEX has a standard swap interface we can target
3. Any co-marketing opportunity — "ALEX-powered flash arb via FlashStack"

The Bitflow receiver we built is a good reference for what this would look like:
https://explorer.hiro.so/txid/0xabd33fc46ffa204ce61f25664f057e414063f28ce75c8387a6df9116453110cb?chain=mainnet

GitHub: https://github.com/mattglory/Flashstack

— Glory / @flashstackbtc
