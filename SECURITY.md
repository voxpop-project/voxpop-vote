# Security Policy

VoxPop is a security-critical voting platform built on Zero-Knowledge Proofs and cryptographic integrity mechanisms. We take every vulnerability report seriously.

---

## Supported Versions

| Version | Status | Support |
|---------|--------|---------|
| 0.x (current development) | Pre-release | Security updates provided |
| < 0.1 | Unreleased | Best-effort fixes |

As the project matures, this table will be updated to reflect stable releases and their support windows.

---

## Reporting a Vulnerability

**DO NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email us at:

> **security@voxpop-app.com**

### What to Include in Your Report

1. **Description** — A clear summary of the vulnerability and its nature (e.g., authentication bypass, proof forgery, data leak).
2. **Affected component** — Which module is impacted (e.g., ZKP circuit, API endpoint, identity verification).
3. **Reproduction steps** — Detailed instructions to reproduce the issue, including environment details (OS, Node.js version, browser).
4. **Proof of concept** — Code snippets, scripts, or screenshots that demonstrate the vulnerability.
5. **Impact assessment** — Your evaluation of severity and potential impact (e.g., vote manipulation, identity exposure).
6. **Suggested fix** — If you have remediation ideas, we welcome them.

### What NOT to Do

- Do not publicly disclose the vulnerability before it has been patched.
- Do not exploit the vulnerability beyond what is necessary to demonstrate it.
- Do not access, modify, or delete data belonging to other users.

---

## Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment of report | Within **48 hours** |
| Initial triage and severity assessment | Within **7 days** |
| Patch for critical vulnerabilities | Within **30 days** |
| Patch for high-severity vulnerabilities | Within **60 days** |
| Patch for medium/low-severity vulnerabilities | Within **90 days** |
| Public disclosure (coordinated) | After patch release |

We will keep you informed throughout the process.

---

## Responsible Disclosure

We follow a **90-day disclosure window**:

- Once reported, we have 90 days to develop and release a fix.
- After the fix is released (or after 90 days), the reporter may publicly disclose.
- We request coordination on timing and content of any public disclosure.
- We will credit reporters in release notes and our Hall of Fame (unless they prefer anonymity).

---

## Scope

### In Scope

- **ZKP module** — Semaphore proof generation, verification, circuit integrity
- **Merkle Tree implementation** — Tree construction, membership proofs, country-based trees
- **Nullifier system** — Double-vote prevention, nullifier derivation
- **Hash chain** — SHA-256 result integrity chain
- **API layer** — NestJS endpoints, authentication, authorization, input validation
- **Identity verification** — eIDAS 2.0 integration, credential handling
- **Transport layer** — Pluggable transports (Snowflake, obfs4), censorship resistance
- **Client-side cryptography** — WebAssembly ZKP computation, key management
- **Dependencies** — Third-party libraries that introduce vulnerabilities
- **Infrastructure configuration** — Docker, CI/CD, deployment configs in the repository

### Out of Scope

- Social engineering attacks against maintainers or contributors
- Denial-of-service (DoS/DDoS) attacks against hosted instances
- Physical attacks on infrastructure
- Vulnerabilities in third-party services not controlled by VoxPop
- Issues in forks or unofficial distributions
- Spam or abuse of non-security features

---

## Hall of Fame

We recognize security researchers who help make VoxPop safer:

| Researcher | Date | Description |
|------------|------|-------------|
| *Be the first!* | — | — |

If you report a valid vulnerability and wish to be credited, include your preferred name and optional link in your report.

---

## PGP Key

A PGP public key for encrypted vulnerability reports will be published at:

- This file (updated when available)
- `https://voxpop-app.com/.well-known/security.txt`
- Public keyservers

In the meantime, please use the email address above. If you need to share highly sensitive information, mention this in your initial email and we will arrange a secure channel.

---

## Contact

- **Security reports:** security@voxpop-app.com
- **General questions:** contact@voxpop-app.com
- **Code of Conduct:** conduct@voxpop-app.com

---

Thank you for helping keep VoxPop and its users safe.
