<p align="center">
  <img src="docs/assets/logo.png" alt="VoxPop Logo" width="200" />
</p>

<h1 align="center">VoxPop</h1>

<p align="center">
  <strong>The Voice of the People</strong><br/>
  Anonymous, verifiable, and censorship-resistant voting for everyone.
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#module-overview">Modules</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#running-tests">Tests</a> &bull;
  <a href="#documentation">Documentation</a> &bull;
  <a href="#contributing">Contributing</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  <img src="https://img.shields.io/badge/status-pre--alpha-orange.svg" alt="Status: Pre-Alpha" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
  <img src="https://img.shields.io/badge/ZKP-Semaphore-purple.svg" alt="ZKP: Semaphore" />
</p>

---

## What is VoxPop?

VoxPop is an **open-source voting module** that enables organizations to conduct **anonymous, verifiable, and censorship-resistant** digital votes. Built on **zero-knowledge proofs (ZKP)**, VoxPop ensures that every vote is:

- **Anonymous** -- No one can link a vote to a voter (not even the system administrator)
- **Verifiable** -- Every voter can independently verify that their vote was counted correctly
- **Censorship-resistant** -- Votes can be cast even under network restrictions or state censorship
- **Privacy-first** -- Zero personal data stored (GDPR-native by design)

VoxPop fills a critical gap in the market: between free academic tools (Helios, Belenios) that are unusable in production, and enterprise solutions (Voatz, Scytl) that cost $50,000+/year.

## The Problem

- **4.4 billion people** live in countries rated "not free" or "partly free" (Freedom House 2024)
- **1.5 million+ associations** in France alone need affordable, secure voting tools
- Existing solutions are either insecure (Google Forms), unusable (academic ZKP tools), or prohibitively expensive (enterprise platforms)
- **No open-source tool** combines ZKP anonymity, verifiability, censorship resistance, and ease of use

## Features

### Core Voting Module

| Feature | Technology | Status |
|---------|-----------|--------|
| **Anonymous voting** | Zero-Knowledge Proofs via [Semaphore](https://semaphore.pse.dev/) | Implemented |
| **Anti-double voting** | Cryptographic nullifiers | Implemented |
| **Per-country jurisdiction** | Merkle Trees (one tree per country) | Implemented |
| **Tamper-proof results** | SHA-256 hash chains | Implemented |
| **Vote orchestration** | VoteModule (createPoll, castVote, verify, audit) | Implemented |
| **Censorship resistance** | Pluggable transports (Snowflake, obfs4) | Planned |
| **Mobile proof generation** | WebAssembly (WASM) -- target < 3 seconds | Planned |
| **Identity verification** | eIDAS 2.0 + document verification (Onfido/Sumsub) | Planned |
| **Privacy compliance** | Zero personal data stored -- GDPR-native | By design |

### Web Application & API

| Feature | Technology | Status |
|---------|-----------|--------|
| **REST API** | Express.js with poll, vote, and audit routes | Implemented |
| **Landing page** | Next.js 14 + Tailwind CSS + Framer Motion | Done |
| **Interactive demo** | 7-step voting flow simulator | Done |
| **Pricing page** | 4 tiers + free citizen mode | Done |

## Architecture

VoxPop is designed as a **modular voting primitive** that can be integrated into any platform.

```
                    +--------------------------------------------+
                    |            VoxPop Platform                  |
                    |       (Next.js Web Application)             |
                    +-----------------------+--------------------+
                                            |
                    +-----------------------+--------------------+
                    |             VoxPop API                      |
                    |          (REST + Express)                   |
                    +-----------+------------+-------------------+
                                |            |
              +-----------------+    +-------+--------+    +-------------------+
              |                 |    |                |    |                   |
    +---------+---------+ +----+----+------+ +-------+----------+
    |   ZKP Module      | |  Identity      | |  Anti-Censorship  |
    |   (Semaphore)     | |  Verification  | |  (Transports)     |
    |                   | |  (eIDAS/Onfido)| |  (Snowflake/obfs4)|
    |  - GroupManager   | |                | |                   |
    |  - Merkle Trees   | |  - eIDAS 2.0   | |  - Tor bridges    |
    |  - Nullifiers     | |  - Document +  | |  - Domain fronting|
    |  - ZK-SNARKs      | |    Liveness    | |  - Obfuscation    |
    |  - Hash chains    | |               | |                   |
    +-------------------+ +---------------+ +-------------------+
```

### How it works (simplified)

1. **Identity Verification** -- Citizen proves their identity via eIDAS 2.0 (FranceConnect, itsme, eID) or document verification (passport + liveness check)
2. **Commitment** -- A cryptographic commitment is added to the country's Merkle Tree (e.g., France tree, Belgium tree)
3. **Vote** -- Citizen generates a ZKP proving they belong to the correct Merkle Tree, without revealing their identity
4. **Nullifier** -- A deterministic code is generated (secret + vote ID = unique nullifier). Same person + same vote = same nullifier = rejected if already used
5. **Tally** -- Votes are added to a SHA-256 hash chain. Any tampering breaks the chain and is immediately detected
6. **Verification** -- Anyone can independently verify the hash chain and confirm the results

> For a detailed technical overview, see [docs/architecture.md](docs/architecture.md)

## Module Overview

The core voting module is implemented as a set of composable TypeScript modules:

### `src/core/vote-module.ts` -- Main Orchestrator

The `VoteModule` class ties all sub-systems together and exposes four principal operations:

| Method | Description |
|--------|-------------|
| `createPoll()` | Define a new voting session with options, country, and duration |
| `castVote()` | Submit a vote with nullifier hash (full ZKP pipeline) |
| `verifyVote()` | Independently verify a recorded vote by its hash |
| `getResults()` | Privacy-preserving vote tallying with hash chain integrity |
| `audit()` | Comprehensive audit report for third-party verification |

### `src/core/semaphore-integration.ts` -- ZKP Engine

Integrates with the [Semaphore protocol](https://semaphore.pse.dev/) (Ethereum Foundation):

- `createVoterIdentity()` -- Generate anonymous voter identities
- `generateVoteProof()` -- Create ZK-SNARK proofs for votes
- `verifyVoteProof()` -- Verify proofs without revealing identity
- `GroupManager` -- Manage per-country Semaphore groups

### `src/core/merkle-tree.ts` -- Voter Registries

Two implementations:

- **`MerkleTree`** -- Standalone SHA-256 binary Merkle tree with proof generation/verification
- **`CountryTreeRegistry`** -- Per-country Semaphore groups for voter eligibility

### `src/core/nullifier.ts` -- Double-Vote Prevention

- `generateNullifier()` -- Deterministic nullifier from identity + poll scope
- `NullifierStore` -- Tracks consumed nullifiers per poll
- Cross-poll isolation (same voter can vote on different polls)

### `src/core/hash-chain.ts` -- Vote Integrity

- `VoteHashChain` -- Append-only SHA-256 hash chain for tamper-evident vote recording
- Genesis block, chain verification, vote tallying, export/import for audits

### `src/utils/hash-chain.ts` -- Generic Hash Chain

- `HashChain<T>` -- Generic typed hash chain usable for any data type
- `sha256()`, `doubleSha256()` -- Hash utilities

### `src/types/index.ts` -- Type Definitions

Comprehensive TypeScript interfaces for the entire system: `Vote`, `Poll`, `VoterIdentity`, `MerkleProof`, `SemaphoreProofData`, `AuditReport`, and more.

## Project Structure

```
voxpop-vote/
+-- README.md               # This file
+-- LICENSE                  # AGPL-3.0
+-- CONTRIBUTING.md          # Contribution guidelines
+-- SECURITY.md              # Security policy
+-- CODE_OF_CONDUCT.md       # Community standards
+-- package.json             # Project configuration
+-- tsconfig.json            # TypeScript configuration
+-- jest.config.ts           # Test configuration
+-- .gitignore               # Files to exclude from git
+-- .github/                 # GitHub configuration
|   +-- ISSUE_TEMPLATE/      # Bug report & feature request templates
+-- docs/                    # Documentation
|   +-- architecture.md      # Technical architecture
|   +-- zkp-module.md        # ZKP module specification
|   +-- api-design.md        # API specification
+-- src/                     # Source code
|   +-- index.ts             # Public API exports
|   +-- types/
|   |   +-- index.ts         # Shared TypeScript interfaces
|   +-- core/
|   |   +-- semaphore-integration.ts  # Semaphore ZKP + GroupManager
|   |   +-- merkle-tree.ts           # MerkleTree + CountryTreeRegistry
|   |   +-- nullifier.ts             # Nullifier generation + store
|   |   +-- hash-chain.ts            # Vote hash chain (tamper-evident)
|   |   +-- vote-module.ts           # Main VoteModule orchestrator
|   +-- utils/
|   |   +-- hash-chain.ts            # Generic typed hash chain
|   +-- api/
|   |   +-- server.ts                # Express API server
|   |   +-- store.ts                 # In-memory store (MVP)
|   |   +-- routes/                  # API route handlers
|   |   +-- middleware/              # Error handling, rate limiting
+-- tests/                   # Test suites
    +-- core/
    |   +-- semaphore.test.ts         # Identity + group tests
    |   +-- merkle-tree.test.ts       # Standalone Merkle tree tests
    |   +-- nullifier.test.ts         # Nullifier system tests
    |   +-- hash-chain.test.ts        # Hash chain tests
    |   +-- vote-module.test.ts       # VoteModule integration tests
    +-- api/
    |   +-- polls.test.ts
    |   +-- votes.test.ts
    |   +-- audit.test.ts
    +-- e2e/
        +-- voting-flow.test.ts       # Full end-to-end voting lifecycle
```

## Getting Started

> **Note:** VoxPop is currently in **pre-alpha** stage. The core ZKP voting module is functional with SHA-256 proofs; full Semaphore WASM circuit integration is in progress.

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Installation

```bash
# Clone the repository
git clone https://github.com/voxpop-project/voxpop-vote.git
cd voxpop-vote

# Install dependencies
npm install
```

### Quick Start (Programmatic)

```typescript
import {
  VoteModule,
  createVoteModule,
  generateNullifier,
} from "@voxpop-project/voxpop-vote";

// 1. Create the voting module
const vm = createVoteModule();

// 2. Create a poll
const poll = vm.createPoll({
  title: "Should we transition to renewable energy by 2030?",
  options: ["Yes", "No", "Abstain"],
  countryCode: "FR",
  durationMinutes: 10080, // 7 days
});

// 3. Cast votes (nullifiers come from ZKP proof generation)
vm.castVote({
  pollId: poll.id,
  nullifierHash: generateNullifier(123456n, poll.id),
  choiceIndex: 0, // "Yes"
});

// 4. Get results
const results = vm.getResults(poll.id);
console.log(results.results);
// [{ option: "Yes", votes: 1, percentage: 100 }, ...]

// 5. Audit
const audit = vm.audit(poll.id);
console.log(audit.hashChainValid); // true
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run a specific test file
npx jest tests/core/vote-module.test.ts

# Run only core module tests
npx jest tests/core/

# Type-check without emitting
npm run type-check
```

### Test Coverage

| Module | Tests | Description |
|--------|-------|-------------|
| `semaphore.test.ts` | 10+ | Identity creation, restoration, group management |
| `merkle-tree.test.ts` | 20+ | SHA-256 tree, proof generation, verification, batch ops |
| `nullifier.test.ts` | 20+ | Generation, verification, store, cross-poll isolation |
| `hash-chain.test.ts` | 20+ | Chain integrity, tampering detection, tally, export/import |
| `vote-module.test.ts` | 20+ | Full orchestration, lifecycle, scale, error handling |
| `voting-flow.test.ts` | 10+ | E2E API tests (100-voter scale, double-vote, audit) |

### Running the API Server

```bash
# Development mode
npm run dev:api

# The API will be available at http://localhost:3001/v1
```

## Development Roadmap

| Milestone | Target | Description | Status |
|-----------|--------|-------------|--------|
| **M0** | Feb 2026 | Repository, documentation, web application | Done |
| **M1** | May 2026 | Semaphore integration + vote module architecture | **In Progress** |
| **M2** | Aug 2026 | Full ZKP voting with WASM proof generation | Planned |
| **M3** | Nov 2026 | REST API + anti-censorship transports | Planned |
| **M4** | Jan 2027 | Security audit by independent third party | Planned |
| **M5** | Feb 2027 | v1.0 release -- npm package + Docker images | Planned |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | Technical architecture and design decisions |
| [ZKP Module](docs/zkp-module.md) | Zero-knowledge proof module specification |
| [API Design](docs/api-design.md) | REST API endpoints and data models |
| [Contributing](CONTRIBUTING.md) | How to contribute to VoxPop |
| [Security Policy](SECURITY.md) | How to report security vulnerabilities |

## Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **ZKP** | [Semaphore](https://semaphore.pse.dev/) (Ethereum Foundation) | Battle-tested ZKP protocol for anonymous signaling |
| **Circuits** | [snarkjs](https://github.com/iden3/snarkjs) + [circomlibjs](https://github.com/iden3/circomlibjs) | Groth16 proof system with JavaScript bindings |
| **Merkle Trees** | Custom SHA-256 + Semaphore Groups | Per-country voter registries with proof generation |
| **Hash chains** | SHA-256 | Industry standard, tamper-evident result integrity |
| **Anti-censorship** | Snowflake + obfs4 (Tor Project) | Proven under real-world state censorship |
| **Client-side proofs** | WebAssembly (WASM) | Near-native performance on mobile devices |
| **Identity** | eIDAS 2.0 + Onfido/Sumsub | EU-standard digital identity + document verification |
| **Web framework** | Next.js 14 + React 18 | Modern, performant, SEO-friendly |
| **API** | Express.js 5 | Lightweight REST API |
| **Styling** | Tailwind CSS + Framer Motion | Utility-first CSS with smooth animations |
| **Language** | TypeScript | Type safety across the entire stack |
| **License** | AGPL-3.0 | Copyleft -- prevents proprietary forks |

## Why AGPL-3.0?

VoxPop is licensed under the **GNU Affero General Public License v3.0**. This means:

- **You CAN:** Use, modify, distribute, and deploy VoxPop freely
- **You MUST:** Share any modifications under the same license
- **You CANNOT:** Create a proprietary fork or closed-source derivative

We chose AGPL-3.0 because **voting infrastructure must be auditable and transparent**. Any organization using VoxPop -- including governments -- must make their modifications available for public scrutiny. This is not just a legal requirement; it is a democratic principle.

## Contributing

We welcome contributions from developers, designers, cryptographers, and civic tech enthusiasts.

Please read our [Contributing Guide](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

### Priority areas for contribution

- **Cryptography:** Semaphore integration, ZKP circuit optimization
- **Security:** Threat modeling, penetration testing, formal verification
- **Accessibility:** WCAG compliance, screen reader support, internationalization
- **Documentation:** Translations, tutorials, API documentation
- **Testing:** Unit tests, integration tests, end-to-end tests

## Security

Security is paramount for a voting system. If you discover a vulnerability:

1. **DO NOT** open a public issue
2. Email us at **security@voxpop-app.com** (or see [SECURITY.md](SECURITY.md))
3. We will respond within 48 hours
4. We follow responsible disclosure practices

## Acknowledgments

VoxPop builds upon the work of:

- [Semaphore](https://semaphore.pse.dev/) by the Ethereum Foundation -- ZKP anonymous signaling protocol
- [snarkjs](https://github.com/iden3/snarkjs) by iden3 -- JavaScript ZK-SNARK implementation
- [Tor Project](https://www.torproject.org/) -- Censorship resistance infrastructure
- [NLnet Foundation](https://nlnet.nl/) -- Supporting open internet technologies
- The global civic tech community

## Contact

- **Website:** [https://voxpop-app.com](https://voxpop-app.com)
- **Email:** contact@voxpop-app.com
- **GitHub:** [https://github.com/voxpop-project](https://github.com/voxpop-project)

---

<p align="center">
  <strong>VoxPop -- Because democracy deserves trustworthy infrastructure.</strong><br/>
  <sub>Built with transparency. Licensed for freedom. Designed for everyone.</sub>
</p>
