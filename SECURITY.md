# Security Policy

## 🔒 Security Commitment

FlashStack takes security seriously. As a flash loan protocol handling valuable assets, we prioritize the security of our smart contracts and the safety of our users' funds.

## 🛡️ Scope

In scope: the live mainnet contracts listed in [README.md](./README.md) and
[docs/security/CONTRACT_INVENTORY.md](./docs/security/CONTRACT_INVENTORY.md), the successor
contracts in `/contracts`, the web app in `/web`, and the operator scripts in `/scripts`.
Live contracts are immutable: a fix means pausing, de-approving, rotating or migrating, not
patching in place.

## 🔍 Security Properties and Limits

- **Atomic repayment check**: every core and pool reads its balance before and after the
  receiver callback and reverts the whole transaction unless it grew by at least the fee.
- **Funds are held by contracts**: the cores hold admin-supplied reserves and the LP pools hold
  depositors' funds. LP `withdraw` is not admin-gated or pause-gated.
- **Admin powers**: each live contract has a single admin principal that can pause flash loans,
  approve or remove receivers, set fees and caps, and (on the cores) withdraw the reserve.
  Pausing a live contract stops flash loans only; it does not stop deposits or withdrawals.
- **Receiver allow-list**: only admin-approved receivers can take loans during the beta.
- **Known issues**: every finding and its status is in
  [docs/security/FINDINGS_REGISTER.md](./docs/security/FINDINGS_REGISTER.md).

### Smart Contract Audits
- **Status**: not yet audited by a third party. No audit firm is engaged yet.
- **Scope packet**: [docs/security/AUDIT_SCOPE.md](./docs/security/AUDIT_SCOPE.md)
- **Internal review**: see `docs/security/` (threat model, per-contract reviews, findings register)

## 🚨 Reporting a Vulnerability

We appreciate responsible disclosure of security vulnerabilities.

### How to Report

**For critical vulnerabilities** (affecting funds or protocol operation):

1. **DO NOT** create a public GitHub issue
2. **Report privately** via:
   - **Preferred**: GitHub private vulnerability reporting at
     [github.com/mattglory/Flashstack/security/advisories/new](https://github.com/mattglory/Flashstack/security/advisories/new)
   - Twitter DM: [@FlashStackBTC](https://twitter.com/FlashStackBTC) (to ask for a contact only; please don't send exploit details by DM)

**For non-critical issues** (documentation, minor bugs):
- Create a public issue on GitHub

### What to Include

Please provide:
- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** (severity assessment)
- **Suggested fix** (if you have one)
- **Your contact information** for follow-up

### Example Report Template

```
Subject: [SECURITY] Brief description

Severity: [Critical/High/Medium/Low]

Description:
[Detailed description of the vulnerability]

Steps to Reproduce:
1. 
2. 
3. 

Potential Impact:
[What could an attacker do?]

Suggested Fix:
[Optional - your ideas for fixing it]

Contract Affected:
[e.g., SP20XD46NGAX05ZQZDKFYCCX49A3852BQABNP0VG5.flashstack-sbtc-core, function: flash-loan]

Disclosure Timeline Preference:
[When you're comfortable with public disclosure]
```

## ⏱️ Response Timeline

Targets (FlashStack is a small team; we'll tell you if we expect to miss one):

| Severity | First Response | Fix Timeline | Public Disclosure |
|----------|---------------|--------------|-------------------|
| Critical | 24 hours      | 7 days       | After containment |
| High     | 48 hours      | 14 days      | After containment |
| Medium   | 5 days        | 30 days      | After containment |
| Low      | 7 days        | 60 days      | Immediate (GitHub issue) |

"Fix" on a live contract usually means containment (pause, de-approve a receiver, rotate admin)
or migration to a successor, because deployed contracts can't be changed.

## 🏆 Bug Bounty Program

There is **no bug bounty programme today**, and no rewards are currently offered. If one
launches, its scope and terms will be published here first. Responsible reports are still very
welcome and will be credited (see Hall of Fame).

## 🔐 Security Best Practices

### For Users

1. **Verify Contract Addresses**
   - Always verify you're interacting with official FlashStack contracts
   - Check contract addresses on our official docs

2. **Test Small Amounts First**
   - Start with small flash mint amounts
   - Verify everything works before scaling up

3. **Understand Risks**
   - Flash loans require technical knowledge
   - Ensure your receiver contract is thoroughly tested
   - Failed repayments revert entire transactions

4. **Review Receiver Contracts**
   - Audit any receiver contract before using it
   - Test extensively on devnet/testnet first
   - Be cautious with third-party receivers

### For Developers

1. **Implement the right receiver trait** for the core you borrow from:
   `stx-flash-receiver-trait` (STX) or `sbtc-flash-receiver-trait` (sBTC). See
   [docs/BUILD_A_RECEIVER.md](./docs/BUILD_A_RECEIVER.md).

2. **Repay loan + fee to the core, and gate your callback**: accept the callback only from the
   core (`contract-caller`), and repay a hardcoded core, never a caller-supplied one. A receiver
   must meet [docs/security/RECEIVER_VETTING.md](./docs/security/RECEIVER_VETTING.md) before it
   can be approved.

3. **Validate Inputs**
   ```clarity
   (asserts! (> amount u0) err-invalid-amount)
   ```

4. **Test Thoroughly**
   - Test on devnet first
   - Simulate edge cases
   - Test with large amounts
   - Verify fee calculations

5. **Handle Errors Gracefully**
   - Use descriptive error codes
   - Return clear error messages
   - Test failure scenarios

## 📚 Security Resources

### Documentation
- [Contract inventory](./docs/security/CONTRACT_INVENTORY.md)
- [Threat model](./docs/security/THREAT_MODEL.md)
- [Building a receiver](./docs/BUILD_A_RECEIVER.md)

### External Resources
- [Clarity Security Guidelines](https://docs.stacks.co/clarity/security)
- [Stacks Blockchain Security](https://docs.stacks.co/security)
- [DeFi Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## 🔄 Security Update Process

When a vulnerability is fixed:

1. **Contain first**: for a live contract, pause / de-approve / rotate before anything is published; exploit detail stays private until then
2. **Review**: independent re-verification of the finding and the fix
3. **Deploy**: Deploy to testnet for verification
4. **Notify**: Contact vulnerability reporter
5. **Public Release**: Release fix to mainnet
6. **Disclosure**: Publish security advisory
7. **Recognition**: Credit reporter (if desired)

## ⚖️ Safe Harbor

We support security researchers who:
- Act in good faith
- Follow responsible disclosure
- Don't exploit vulnerabilities
- Don't access/modify user data
- Don't perform DoS attacks

We will not pursue legal action against security researchers who follow these guidelines.

## 📝 Past Security Advisories

Findings, fixes and containment status are tracked in
[docs/security/FINDINGS_REGISTER.md](./docs/security/FINDINGS_REGISTER.md).

## 📞 Contact

- **Project Lead**: Matt Glory
- **GitHub**: [@mattglory](https://github.com/mattglory)
- **Twitter**: [@FlashStackBTC](https://twitter.com/FlashStackBTC)

## 🙏 Hall of Fame

We recognize and thank security researchers who help improve FlashStack:

*Coming soon - be the first!*

---

**Last Updated**: November 2026

Thank you for helping keep FlashStack and the Bitcoin DeFi ecosystem secure! 🛡️⚡
