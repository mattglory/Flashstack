# Build a FlashStack Receiver

**For:** Stacks developers who want to write a custom flash loan strategy  
**Network:** Stacks Mainnet  
**Time:** ~30 minutes to deploy a working receiver

---

## What Is a Receiver?

A receiver is a Clarity smart contract that implements a single callback function. When you call `flash-loan` on FlashStack, the protocol sends STX (or sBTC) to your receiver contract and immediately calls your callback. Inside the callback, your contract executes any strategy — a DEX swap, a liquidation, a collateral swap, anything — and then repays principal + fee before returning. If repayment fails, the entire transaction reverts automatically. No partial execution is possible.

```
You → flashstack-stx-core.flash-loan(amount, receiver)
         ↓
      STX sent to receiver
         ↓
      receiver.execute-stx-flash(amount, core) ← your strategy runs here
         ↓
      receiver repays principal + 0.05% fee
         ↓
      core verifies repayment → success or full revert
```

Zero capital required. If your strategy produces a loss, the transaction reverts — you lose only the Stacks transaction fee (~0.001 STX).

---

## Deployed Contracts

All FlashStack contracts are under `SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5`.

| Contract | Role |
|----------|------|
| `flashstack-stx-core` | STX flash loan engine |
| `flashstack-sbtc-core` | sBTC flash loan engine |
| `stx-flash-receiver-trait` | STX callback interface |
| `sbtc-flash-receiver-trait` | sBTC callback interface |
| `stx-test-receiver` | Minimal working STX receiver |
| `sbtc-test-receiver` | Minimal working sBTC receiver |
| `bitflow-arb-receiver-v4` | Live STX/stSTX arb on Bitflow |
| `velar-sbtc-arb-receiver` | Live sBTC/wSTX arb on Velar |

Canonical sBTC token: `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`

---

## Part 1 — STX Receiver

### The Minimal Template

Every STX receiver must implement this trait:

```clarity
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)
```

Minimum working receiver:

```clarity
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    ;; Look up the current fee rate dynamically — never hardcode
    (fee-bp    (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                  get-fee-basis-points) (err u500)))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))  ;; minimum 1 microSTX
    (total-owed (+ amount fee))
  )
    ;; --- YOUR STRATEGY GOES HERE ---
    ;; (amount) microSTX is already in this contract at this point.
    ;; Execute swaps, liquidations, or any on-chain call.
    ;; You must end with at least (total-owed) microSTX in this contract.
    ;; --- END STRATEGY ---

    ;; Repay principal + fee to the core contract
    (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) (err u501))
    (ok true)
  )
)
```

### Important Rules

1. **Always use `as-contract`** when transferring STX back to core. The STX lives in the contract's balance, not the caller's.
2. **Always look up `get-fee-basis-points` dynamically.** The fee can change. Hardcoding `u5` is a bug — if the fee increases, your repayment will be short and the tx will revert.
3. **Use literal principals for trait arguments.** If you call a function that takes `<ft-trait>`, write the principal inline (e.g., `'SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-alex`). Using a `define-constant` for a trait argument will fail Clarity's static analysis.
4. **Minimum fee is 1 microSTX.** For tiny loans, `(/ (* amount fee-bp) u10000)` rounds to zero. The template handles this with `(if (> raw-fee u0) raw-fee u1)`.

### A Real Strategy: DEX Arbitrage

```clarity
(impl-trait 'SP3TGRVG7DKGFVRTTVGGS60S59R916FWB4DAB9STZ.stx-flash-receiver-trait.stx-flash-receiver-trait)

(define-constant ERR-SWAP-FAILED  (err u501))
(define-constant ERR-NO-PROFIT    (err u502))
(define-constant ERR-REPAY-FAILED (err u503))

(define-public (execute-stx-flash (amount uint) (core principal))
  (let (
    (fee-bp    (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-stx-core
                  get-fee-basis-points) ERR-REPAY-FAILED))
    (raw-fee   (/ (* amount fee-bp) u10000))
    (fee       (if (> raw-fee u0) raw-fee u1))
    (total-owed (+ amount fee))
  )
    ;; Leg 1: swap STX for some token on your chosen DEX
    ;; (unwrap! (as-contract (contract-call? 'YOUR-DEX swap-x-for-y ...)) ERR-SWAP-FAILED)

    ;; Leg 2: swap that token back for STX
    ;; (unwrap! (as-contract (contract-call? 'YOUR-DEX swap-y-for-x ...)) ERR-SWAP-FAILED)

    ;; Verify we came out ahead
    (let ((stx-bal (stx-get-balance (as-contract tx-sender))))
      (asserts! (>= stx-bal total-owed) ERR-NO-PROFIT)
      (unwrap! (as-contract (stx-transfer? total-owed tx-sender core)) ERR-REPAY-FAILED)
      (ok true)
    )
  )
)

;; Rescue any trapped STX (admin only)
(define-constant OWNER tx-sender)
(define-public (rescue-stx (amount uint) (to principal))
  (begin
    (asserts! (is-eq tx-sender OWNER) (err u600))
    (unwrap! (as-contract (stx-transfer? amount tx-sender to)) (err u601))
    (ok true)
  )
)
```

Live example to read: [contracts/bitflow-arb-receiver.clar](../contracts/bitflow-arb-receiver.clar) (deployed as `bitflow-arb-receiver-v4` on mainnet) and [contracts/alex-arb-receiver.clar](../contracts/alex-arb-receiver.clar).

---

## Part 2 — sBTC Receiver

### The Minimal Template

```clarity
(impl-trait 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.sbtc-flash-receiver-trait.sbtc-flash-receiver-trait)

(define-constant SBTC 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token)

(define-public (execute-sbtc-flash (amount uint) (core principal))
  (let (
    (fee-bp  (unwrap! (contract-call? 'SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core
                get-fee-basis-points) (err u500)))
    (raw-fee (/ (* amount fee-bp) u10000))
    (fee     (if (> raw-fee u0) raw-fee u1))
    (owed    (+ amount fee))
  )
    ;; --- YOUR STRATEGY ---
    ;; (amount) canonical sBTC satoshis are in this contract.
    ;; --- END STRATEGY ---

    ;; Repay principal + fee
    (unwrap! (as-contract (contract-call? SBTC transfer owed tx-sender core none)) (err u501))
    (ok true)
  )
)
```

Key difference from STX: repayment uses `contract-call?` with the sBTC token contract, not `stx-transfer?`.

Live example: [contracts/velar-sbtc-arb-receiver.clar](../contracts/velar-sbtc-arb-receiver.clar).

---

## Part 3 — Deploy and Get Whitelisted

### Step 1: Deploy your contract

Use Clarinet or the Hiro deployment tool. Your contract must implement the correct trait — Clarity checks this at deploy time and will reject the contract if it doesn't.

Deploy script pattern (see [scripts/deploy-alex-receiver.mjs](../scripts/deploy-alex-receiver.mjs) for a complete example):

```js
import { makeContractDeploy, ClarityVersion, PostConditionMode } from "@stacks/transactions";
import { readFileSync } from "fs";

const deployTx = await makeContractDeploy({
  contractName: "my-receiver",
  codeBody: readFileSync("contracts/my-receiver.clar", "utf8"),
  senderKey: privateKey,
  network: STACKS_MAINNET,
  clarityVersion: ClarityVersion.Clarity3,
  postConditionMode: PostConditionMode.Allow,
  fee: 500_000,
  nonce: currentNonce,
});
```

### Step 2: Get whitelisted

FlashStack uses an allowlist. Only approved receivers can borrow. To get your contract whitelisted:

**Option A — Open a GitHub issue:**  
Go to https://github.com/mattglory/Flashstack/issues with your contract address and a brief description of your strategy. The admin will call `add-approved-receiver` on `flashstack-stx-core` or `flashstack-sbtc-core`.

**Option B — Contact directly:**  
DM [@flashstackbtc](https://x.com/flashstackbtc) on X with your contract address.

Whitelisting is quick — usually same day for legitimate strategies.

### Step 3: Test with the simulate read-only first

Before executing a live flash loan, use your receiver's `simulate` function (if you added one) or call the core's `get-fee-basis-points` to verify the math:

```bash
# Check current fee rate
curl -s -X POST "https://api.hiro.so/v2/contracts/call-read/SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5/flashstack-stx-core/get-fee-basis-points" \
  -H "Content-Type: application/json" \
  -d '{"sender":"YOUR-ADDRESS","arguments":[]}' | python3 -m json.tool
# Returns: {"okay":true,"result":"0x010000000000000000000000000000000005"} → 5 basis points (0.05%)
```

### Step 4: Execute the flash loan

```js
import { makeContractCall, PostConditionMode, Cl } from "@stacks/transactions";

const tx = await makeContractCall({
  contractAddress: "SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5",
  contractName: "flashstack-stx-core",
  functionName: "flash-loan",
  functionArgs: [
    Cl.uint(loanAmountMicroSTX),
    Cl.principal("YOUR-ADDRESS.your-receiver"),
  ],
  senderKey: privateKey,
  network: STACKS_MAINNET,
  postConditionMode: PostConditionMode.Allow,
  fee: 300_000,
});
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `(err u403)` on swap | DEX blocklist check — some AMMs block new contracts by default | Contact the DEX team to confirm your contract is permitted |
| `(err none)` on deploy | Clarity static analysis failed — likely a `define-constant` used as a `<trait>` argument | Replace constants with literal principals in all `contract-call?` expressions that take trait-typed parameters |
| `ContractAlreadyExists` | A previous failed deploy (even `abort_by_response`) reserved the contract name | Rename your contract (e.g., append `-v2`) |
| Repayment reverts | Strategy produced a loss — `stx-bal < total-owed` | Add a pre-flight `asserts!` check or use the `simulate` read-only before live execution |
| `ERR-NOT-APPROVED` from core | Receiver not on the allowlist | Open a GitHub issue or DM to get whitelisted |

---

## Strategies Worth Building

**STX strategies** (borrow from `flashstack-stx-core`):
- Bitflow STX/stSTX arb — stSTX trades above peg after stacking reward cycles
- ALEX STX/ALEX arb — ALEX briefly overpriced before emissions events
- Arkadiko liquidations — undercollateralized vaults, STX debt repaid at discount
- Collateral swap — atomically swap one collateral type for another without closing a position

**sBTC strategies** (borrow from `flashstack-sbtc-core`):
- Velar wSTX/sBTC arb — live receiver already deployed, use as reference
- Zest sBTC liquidations — pending Zest whitelist

---

## Further Reading

- [STX Testing Guide](TESTING_GUIDE_STX.md) — how to run existing test scenarios
- [sBTC Testing Guide](TESTING_GUIDE_SBTC.md) — sBTC-specific test flows
- [LP Collateral Integration Spec](LP_COLLATERAL_INTEGRATION_SPEC.md) — using FlashStack LP shares as lending collateral
- [Live receiver contracts](../contracts/) — read the source of deployed strategies
- [GitHub](https://github.com/mattglory/Flashstack) — full repo, MIT licensed
