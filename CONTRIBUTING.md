# Contributing to VoxPop

Welcome, and thank you for your interest in contributing to VoxPop! This project builds a secure, privacy-preserving voting module using Zero-Knowledge Proofs, Merkle Trees, and censorship-resistant infrastructure. Because VoxPop handles democratic processes, **security and correctness are paramount** — every contribution is held to a high standard.

Whether you are fixing a typo, improving documentation, or working on cryptographic circuits, your help is valued.

---

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Standards](#code-standards)
- [Areas of Contribution](#areas-of-contribution)
- [Pull Request Process](#pull-request-process)
- [Security](#security)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

---

## How to Contribute

1. **Fork** the repository on GitHub ([github.com/voxpop-project/voxpop-vote](https://github.com/voxpop-project/voxpop-vote)).
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/voxpop-vote.git
   cd voxpop-vote
   ```
3. **Create a branch** from `main` with a descriptive name:
   ```bash
   git checkout -b feat/short-description
   ```
4. **Make your changes**, commit them following our [commit conventions](#commit-messages), and push:
   ```bash
   git push origin feat/short-description
   ```
5. **Open a Pull Request** against `main` on the upstream repository.

---

## Development Setup

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ (LTS recommended) |
| npm | 10+ |
| Git | 2.40+ |
| PostgreSQL | 15+ (for backend work) |

### Installation

```bash
# Clone and install dependencies
git clone https://github.com/<your-username>/voxpop-vote.git
cd voxpop-vote
npm install
```

### Running Locally

```bash
# Start the development server
npm run dev

# Run the full test suite
npm test

# Run tests in watch mode
npm run test:watch

# Lint and format
npm run lint
npm run format
```

### Environment Variables

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

> **Warning:** Never commit `.env` files or any secrets to the repository.

---

## Code Standards

### TypeScript

- **Strict mode** is enabled — do not use `any` unless absolutely necessary and documented.
- All new code must be written in TypeScript.
- Export types and interfaces explicitly.

### Linting and Formatting

- **ESLint** enforces code quality rules. Run `npm run lint` before committing.
- **Prettier** handles formatting. Run `npm run format` or configure your editor to format on save.
- CI will reject PRs that fail lint or format checks.

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `security`

Examples:
- `feat(zkp): add Semaphore proof generation for group voting`
- `fix(api): correct nullifier validation on vote submission`
- `docs: update contributing guide with setup instructions`
- `security(auth): patch identity verification bypass`

### Testing

- All new features must include tests.
- Aim for meaningful coverage, not just line count.
- Cryptographic modules require both unit tests and property-based tests.

---

## Areas of Contribution

We label issues by difficulty to help you find work that matches your experience:

### 🟢 Easy

- Documentation improvements and typo fixes
- Translations (i18n)
- UI/UX improvements and accessibility enhancements
- Adding or improving code comments

### 🟡 Medium

- API endpoints (NestJS controllers, services, DTOs)
- Increasing test coverage
- DevOps and CI/CD pipeline improvements
- Database migrations and schema work
- Performance optimizations

### 🔴 Advanced

- ZKP circuits (Semaphore integration, proof generation/verification)
- Cryptographic modules (Merkle Tree implementation, nullifier logic, hash chains)
- Security hardening (transport layer, anti-censorship, pluggable transports)
- Identity verification (eIDAS 2.0 integration)
- WebAssembly compilation and optimization

> **Note:** Advanced contributions involving cryptography require thorough review. Please open an issue to discuss your approach before starting work.

---

## Pull Request Process

### Before Submitting

- [ ] Your branch is up to date with `main`.
- [ ] All tests pass locally (`npm test`).
- [ ] Linting passes (`npm run lint`).
- [ ] You have added or updated tests for your changes.
- [ ] You have updated relevant documentation if needed.
- [ ] Commit messages follow Conventional Commits.

### PR Description

Your pull request should include:

- **Summary** of the changes and motivation.
- **Related issue** number (e.g., `Closes #42`).
- **Type of change** (bug fix, feature, breaking change, documentation).
- **Testing performed** — describe how you verified your changes.
- **Screenshots** if the change affects the UI.

### Review Process

- All PRs require at least **1 approving review** before merge.
- PRs that touch **cryptographic code, ZKP circuits, or security-sensitive modules** require at least **2 approving reviews**, including one from a maintainer with cryptography expertise.
- Reviewers may request changes — please address feedback promptly.
- We use squash-and-merge for most PRs to keep the history clean.

---

## Security

**VoxPop is a security-critical project.** If you discover a vulnerability:

- **DO NOT** open a public issue.
- Report it privately following our [Security Policy](SECURITY.md).
- Email: **security@voxpop-app.com**

General guidelines:

- Never commit secrets, API keys, private keys, or `.env` files.
- Never disable or weaken cryptographic checks, even in tests.
- Flag any code that handles private data for extra review.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold a welcoming, inclusive, and harassment-free environment.

Report unacceptable behavior to **conduct@voxpop-app.com**.

---

## License

VoxPop is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE). By contributing, you agree that your contributions will be licensed under the same license.

This means any modifications to VoxPop — including those deployed as a network service — must also be released under AGPL-3.0 with source code made available.

---

Thank you for helping build transparent and secure democratic tools. Every contribution matters.
