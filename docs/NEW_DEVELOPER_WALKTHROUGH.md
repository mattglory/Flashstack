# FlashStack: Your First Flash Loan on Bitcoin L2

### A complete walkthrough for developers with zero Clarity or Stacks experience

By the end of this guide you will have:

1. Deployed your own smart contract to Stacks mainnet
2. Executed a real flash loan — borrowed STX with **zero collateral** and repaid it in the same transaction

**Time:** ~45 minutes (plus blockchain confirmation waits)
**Cost:** ~2 STX in network fees (a few dollars). Have **5 STX** in your wallet to be comfortable.
**Experience needed:** you can copy-paste commands into a terminal. That's it.

---

## How a flash loan works (60-second version)

A flash loan is an uncollateralized loan that must be repaid **within the same
blockchain transaction**. The sequence:

1. You call FlashStack's `flash-loan` function
2. FlashStack sends STX to *your* contract (the "receiver")
3. FlashStack calls your contract's `execute-stx-flash` function — this is
   where a real strategy would use the money (arbitrage, liquidations, etc.)
4. Your contract repays the loan + a 0.05% fee
5. If repayment fails for any reason, **the entire transaction reverts** — as
   if nothing ever happened. Nobody can lose funds. That's why no collateral
   is needed.

The receiver template you'll deploy skips step 3's strategy and simply repays.
That's enough to prove the full borrow-repay cycle on mainnet.

---

## Step 1 — Install Node.js

You need Node.js 18 or newer.

- Download the LTS version from https://nodejs.org and install it.
- Verify in a terminal (Mac: Terminal app; Windows: PowerShell):

```
node --version
```

You should see `v18`, `v20`, `v22` or higher.

## Step 2 — Create a Stacks wallet

1. Install the **Leather** wallet extension from https://leather.io (or
   **Xverse** from https://xverse.app — both work).
2. Create a new wallet. You'll be shown a **24-word Secret Recovery Phrase**.
3. **Write the 24 words down and store them safely.** Anyone with these words
   controls your wallet. Never share them, never paste them into a website,
   never commit them to GitHub. You will only ever type them into your own
   terminal in this guide.
4. Copy your **STX address** — it starts with `SP` and looks like
   `SP2ABC...XYZ`. This is safe to share.

## Step 3 — Get some STX

You need ~5 STX on **mainnet**.

- Easiest: buy STX inside Leather/Xverse (card purchase), or
- Buy on an exchange (Binance, OKX, Kraken, Coinbase) and withdraw to your
  `SP...` address.

Wait until the STX shows in your wallet before continuing.

## Step 4 — Get the FlashStack code

In your terminal:

```
git clone https://github.com/mattglory/flashstack.git
cd flashstack
npm install
```

(No git? Download the ZIP from the GitHub page, unzip it, and `cd` into it.)

## Step 5 — Look at the contract you're about to deploy (optional, 2 min)

Open `contracts/templates/stx-receiver-template.clar` in any text editor.
It's ~60 lines of Clarity, the language of Stacks smart contracts. The
important parts:

- `execute-stx-flash` — the function FlashStack calls during the loan. It
  computes the fee, checks the contract can repay, and repays. The comment
  `>>> Your strategy would go here <<<` marks where real arbitrage logic
  would live.
- `withdraw` — lets you (and only you) take back any STX you send to the
  contract later.
- `(asserts! (is-eq contract-caller FLASH-CORE) ...)` — only the real
  FlashStack core can trigger your callback. Nobody else can touch it.

You don't need to edit anything.

## Step 6 — Deploy your receiver to mainnet

Pick a contract name with your own name in it, e.g. `jane-flash-receiver-v1`
(lowercase letters, numbers, dashes only).

**Mac/Linux:**
```
RECEIVER_NAME=yourname-flash-receiver-v1 DEPLOYER_MNEMONIC="your 24 words separated by spaces" node scripts/deploy-receiver-template.mjs
```

**Windows PowerShell:**
```
$env:RECEIVER_NAME="yourname-flash-receiver-v1"
$env:DEPLOYER_MNEMONIC="your 24 words separated by spaces"
node scripts/deploy-receiver-template.mjs
```

The script prints your wallet address, broadcasts the deployment (~0.5 STX
fee), and waits for confirmation (1–5 minutes). When it finishes you'll see:

```
  DEPLOY COMPLETE
  Your contract: SP2ABC...XYZ.yourname-flash-receiver-v1
```

That `SP...XYZ.yourname-flash-receiver-v1` string is your **contract ID**.

## Step 7 — Get whitelisted

Send your contract ID to Matt (the FlashStack maintainer). FlashStack only
lends to approved receiver contracts, so this step is required.

Matt runs the whitelist transaction and confirms back — usually within a few
hours. You can verify yourself: open your contract in the explorer
(`https://explorer.hiro.so/txid/SP...XYZ.yourname-flash-receiver-v1?chain=mainnet`)
— and wait for Matt's confirmation message.

## Step 8 — Seed your receiver with fee money

The flash loan fee is 0.05% and your contract pays it. Send **0.1 STX** from
your wallet to your contract ID:

1. Open Leather/Xverse → Send → paste your full contract ID
   (`SP...XYZ.yourname-flash-receiver-v1`) as the recipient
2. Send 0.1 STX

0.1 STX covers the fee on a 1 STX loan two hundred times over, and you can
withdraw it back in Step 10.

## Step 9 — Execute your flash loan

**Mac/Linux:**
```
RECEIVER=SP2ABC...XYZ.yourname-flash-receiver-v1 DEPLOYER_MNEMONIC="your 24 words" node scripts/execute-flash-loan.mjs
```

**Windows PowerShell:**
```
$env:RECEIVER="SP2ABC...XYZ.yourname-flash-receiver-v1"
$env:DEPLOYER_MNEMONIC="your 24 words"
node scripts/execute-flash-loan.mjs
```

The script borrows 1 STX through your receiver and waits for confirmation.
Success looks like:

```
  FLASH LOAN COMPLETE -- you just borrowed and repaid
  1 STX with zero collateral, atomically.
  Result: (ok true)
  Tx:     https://explorer.hiro.so/txid/0x...?chain=mainnet
```

**Send Matt that transaction link.** It's the on-chain proof of your
integration. Open it in the explorer and look at the event list — you'll see
the loan arrive at your contract and the repayment + fee go back, all inside
one transaction.

Want a bigger thrill? Run it again with `LOAN_STX=100` — borrowing 100 STX
costs the same effort.

## Step 10 — Get your seed money back (optional)

Your contract's `withdraw` function returns leftover STX to your wallet. The
easiest way: open your contract in the explorer, connect your wallet, and call
`withdraw` with amount in microSTX (e.g. `99000000` for 0.099 STX — check the
exact remaining balance with the `get-balance` read-only function first).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Node.js isn't installed or terminal needs restarting after install |
| Deploy says balance too low | You need ~1 STX in the wallet; confirm your STX arrived on mainnet (address starts with SP, not ST) |
| `ConflictingNonceInMempool` | You sent two transactions at once — wait for the first to confirm, run again |
| Flash loan aborts with an unauthorized/whitelist error | Your receiver isn't whitelisted yet — ping Matt (Step 7) |
| Flash loan aborts with `u500` | Receiver can't cover the fee — send it 0.1 STX (Step 8) |
| Script says "timed out" | The network is just slow — open the explorer link; it usually confirms |
| Anything else | Send Matt the explorer link of the failed transaction — the error is always visible on-chain |

## What's next?

You've proven the plumbing. The interesting part is what goes in the
`>>> Your strategy would go here <<<` gap:

- **Arbitrage:** buy low on one DEX, sell high on another — see
  `contracts/alex-arb-receiver-v5.clar` for a production example
- **Liquidations:** repay someone's debt, claim their collateral at a discount
- **Anything atomic:** if it's profitable within one transaction, a flash
  loan funds it with zero capital

Docs: [BUILD_A_RECEIVER.md](BUILD_A_RECEIVER.md) ·
[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) ·
[API_REFERENCE.md](API_REFERENCE.md)
