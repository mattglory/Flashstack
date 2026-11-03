# Contributing to FlashStack

First off, thank you for considering contributing to FlashStack! It's people like you that make FlashStack a stronger flash loan protocol on Bitcoin Layer 2.

## 🌟 Ways to Contribute

- 🐛 Report bugs
- 💡 Suggest new features or improvements
- 📖 Improve documentation
- 🔧 Submit bug fixes
- ✨ Add new receiver contract examples
- 🧪 Write additional tests
- 🎨 Improve UI/UX (when frontend launches)

## 🚀 Quick Start for Contributors

### Prerequisites

- [Clarinet](https://github.com/stx-labs/clarinet) **at exactly the version CI pins** (the
  download URL in `.github/workflows/test.yml`, currently 3.23.2). Older versions can't parse
  `epoch = "4.0"`, and a different version makes `tests/mainnet-plan-guard.test.ts` skip
  its deployment-safety checks instead of running them.
- Node.js at the major in `.nvmrc` or later
- Git
- Basic understanding of Clarity smart contracts

### Development Setup

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/flashstack.git
   cd flashstack
   ```

2. **Install dependencies** from the lockfiles
   ```bash
   npm ci && (cd web && npm ci)
   ```

3. **Check your toolchain matches CI**, then verify
   ```bash
   npm run doctor      # prints the exact checksum-verified clarinet install if yours differs
   clarinet check
   npm test            # expect 0 skipped; a skip means your clarinet doesn't match CI
   ```

4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

## 📝 Development Workflow

### Making Changes

1. **Write your code**
   - Follow existing code style
   - Add comments for complex logic
   - Keep functions focused and small

2. **Test your changes**
   ```bash
   # Check syntax
   clarinet check
   
   # Run in console to test
   clarinet console
   ```

3. **Update documentation**
   - Update README.md if you added features
   - Add code comments
   - Update relevant docs in /docs folder

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add arbitrage calculator function"
   ```

   Use conventional commit messages:
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation only
   - `test:` - Adding tests
   - `refactor:` - Code refactoring
   - `style:` - Formatting changes
   - `chore:` - Maintenance tasks

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request**
   - Go to the original FlashStack repository
   - Click "New Pull Request"
   - Select your fork and branch
   - Fill out the PR template
   - Submit!

## 🎯 Code Standards

### Clarity Smart Contracts

- **Follow SIP-010 standards** for token contracts
- **Use descriptive variable names** (`flash-mint-amount` not `amt`)
- **Add input validation** for all public functions
- **Include error handling** with descriptive error codes
- **Comment complex logic** with clear explanations
- **Keep functions under 50 lines** when possible

Example:
```clarity
;; Good ✅
(define-public (flash-mint (amount uint) (receiver <flash-receiver>))
  (begin
    ;; Validate amount
    (asserts! (> amount u0) err-invalid-amount)
    
    ;; Validate not paused
    (asserts! (not (var-get paused)) err-protocol-paused)
    
    ;; Execute flash mint
    ...
  )
)

;; Bad ❌
(define-public (fm (a uint) (r <flash-receiver>))
  ;; No validation, unclear names
  ...
)
```

### Testing

- **Write tests for new features**
- **Test edge cases** (zero amounts, max values, etc.)
- **Test error conditions**
- **Include integration tests** for receiver contracts

### Documentation

- **Update README.md** for significant features
- **Add inline comments** for complex code
- **Create examples** for new receiver types
- **Update API docs** in /docs folder

## 🐛 Reporting Bugs

### Before Submitting

1. **Check existing issues** - Your bug may already be reported
2. **Use latest version** - Update to latest main branch
3. **Minimal reproduction** - Can you reproduce it consistently?

### Creating a Bug Report

Use the bug report template and include:

- **Clear title** - Describe the issue
- **Steps to reproduce** - Detailed steps
- **Expected behavior** - What should happen
- **Actual behavior** - What actually happens
- **Environment** - Clarinet version, OS, etc.
- **Code snippets** - Relevant contract code
- **Error messages** - Full error output

Example:
```
Title: flash-mint fails with err-insufficient-collateral on valid STX amount

Steps to reproduce:
1. Deploy contracts to devnet
2. Lock 100,000 STX via PoX
3. Call flash-mint with 10 sBTC
4. Transaction fails

Expected: flash-mint succeeds
Actual: Returns (err u104)

Environment:
- Clarinet 2.3.0
- Windows 11
- Node 18.0.0
```

## 💡 Suggesting Features

We love new ideas! Before suggesting:

1. **Check existing issues** - Someone may have suggested it
2. **Consider scope** - Does it fit FlashStack's mission?
3. **Think through implementation** - How would it work?

### Creating a Feature Request

Use the feature request template and include:

- **Clear description** - What's the feature?
- **Use case** - Why is it needed?
- **Examples** - How would it be used?
- **Alternatives** - What other solutions exist?

## 🔍 Code Review Process

When you submit a PR:

1. **Automated checks run** - Clarinet check, tests
2. **Maintainer reviews** - Usually within 48 hours
3. **Feedback addressed** - Make requested changes
4. **Approval & merge** - Once approved, we merge!

### What We Look For

- ✅ Code works and tests pass
- ✅ Follows coding standards
- ✅ Well documented
- ✅ No breaking changes (or clearly noted)
- ✅ Minimal scope (focused changes)

## 🏆 Recognition

Contributors are recognized in:
- README.md contributors section
- CHANGELOG.md for each release
- Special shoutouts on Twitter
- Potential core team invitation for consistent contributors

## 📚 Resources

### Documentation
- [README.md](./README.md) - Project overview
- [QUICKSTART.md](./QUICKSTART.md) - Getting started
- [/docs](./docs) - Complete documentation

### Learning Clarity
- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Clarinet Documentation](https://docs.hiro.so/clarinet)
- [Stacks Academy](https://academy.stacks.org)

### Community
- [Twitter](https://twitter.com/FlashStackBTC) - Follow for updates
- [GitHub Discussions](https://github.com/mattglory/flashstack/discussions) - Ask questions
- [Stacks Discord](https://stacks.chat) - Chat with community

## 📧 Contact

- **Project Lead**: Matt Glory ([@FlashStackBTC](https://twitter.com/FlashStackBTC))
- **GitHub**: [mattglory](https://github.com/mattglory)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to FlashStack! Together we're building the future of Bitcoin DeFi. ⚡
