# Security Policy

## 🔒 Security Commitment

FlashStack takes security seriously. As a flash loan protocol handling valuable assets, we prioritize the security of our smart contracts and the safety of our users' funds.

## 🛡️ Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | ✅ Yes (Current)   |
| < 1.0   | ❌ No              |

## 🔍 Known Security Features

### Zero-Risk Design
- **Atomic Transactions**: All flash loans execute atomically - if repayment fails, the entire transaction reverts
- **No Custody**: FlashStack never holds user funds
- **Collateral Verification**: All collateral checks happen on-chain via PoX-4
- **Zero Inflation**: Guaranteed by atomic mint-burn cycles

### Smart Contract Audits
- ⏳ **Status**: Pending audit (scheduled Q1 2026)
- 🧪 **Testing**: 100% success rate across 8 receiver contracts
- 📊 **Volume Tested**: 27M sBTC processed without failures

## 🚨 Reporting a Vulnerability

We appreciate responsible disclosure of security vulnerabilities.

### How to Report

**For critical vulnerabilities** (affecting funds or protocol operation):

1. **DO NOT** create a public GitHub issue
2. **Contact us privately** via:
   - Twitter DM: [@FlashStackBTC](https://twitter.com/FlashStackBTC)
   - GitHub: Open a private security advisory at [github.com/mattglory/flashstack/security/advisories](https://github.com/mattglory/flashstack/security/advisories)

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
[e.g., flashstack-core.clar, function: flash-mint]

Disclosure Timeline Preference:
[When you're comfortable with public disclosure]
```

## ⏱️ Response Timeline

We are committed to responding quickly:

| Severity | First Response | Fix Timeline | Public Disclosure |
|----------|---------------|--------------|-------------------|
| Critical | 24 hours      | 7 days       | After fix deployed |
| High     | 48 hours      | 14 days      | After fix deployed |
| Medium   | 5 days        | 30 days      | After fix deployed |
| Low      | 7 days        | 60 days      | Immediate (GitHub issue) |

## 🏆 Bug Bounty Program

### Current Status
- 🔄 **Status**: Coming Soon (Q1 2026)
- 💰 **Rewards**: Based on severity and impact
- 📋 **Scope**: All smart contracts in `/contracts` directory

### Anticipated Reward Range
- **Critical**: Up to 10,000 STX or equivalent sBTC
- **High**: Up to 5,000 STX
- **Medium**: Up to 1,000 STX
- **Low**: Recognition + swag

*Exact amounts TBD and dependent on fundraising success*

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

1. **Implement Flash Receiver Trait**
   ```clarity
   (impl-trait .flash-receiver-trait.flash-receiver-trait)
   ```

2. **Always Repay Loan + Fee**
   ```clarity
   (let ((fee (/ (* amount u50) u10000)))
     ;; Your logic here
     (try! (contract-call? .sbtc-token transfer 
       (+ amount fee) borrower (as-contract tx-sender) none))
   )
   ```

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
- [Smart Contracts Overview](./docs/02-technical/SMART_CONTRACTS.md)
- [Integration Guide](./docs/02-technical/INTEGRATION_GUIDE.md)
- [Developer Documentation](./docs/02-technical/DEVELOPER_DOCUMENTATION.md)

### External Resources
- [Clarity Security Guidelines](https://docs.stacks.co/clarity/security)
- [Stacks Blockchain Security](https://docs.stacks.co/security)
- [DeFi Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)

## 🔄 Security Update Process

When a vulnerability is fixed:

1. **Private Fix**: Develop and test fix in private repository
2. **Review**: Internal code review
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

*None yet - this is our first public release*

## 📞 Contact

- **Project Lead**: Matt Glory
- **GitHub**: [@mattglory](https://github.com/mattglory)
- **Twitter**: [@FlashStackBTC](https://twitter.com/FlashStackBTC)

## 🙏 Hall of Fame

We recognize and thank security researchers who help improve FlashStack:

*Coming soon - be the first!*

---

**Last Updated**: April 2026
**Version**: 1.0

Thank you for helping keep FlashStack and the Bitcoin DeFi ecosystem secure! 🛡️⚡
