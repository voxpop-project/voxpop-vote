# VoxPop — System Architecture

## Overview

VoxPop is a privacy-preserving voting system built on three pillars:

1. **Zero-Knowledge Proofs** — Prove voter eligibility without revealing identity
2. **Per-Country Merkle Trees** — Ensure only eligible citizens vote in their jurisdiction
3. **Censorship Resistance** — Operate even under state-level internet censorship

## High-Level Architecture

```
+---------------------+     +---------------------+     +---------------------+
|    CLIENT (Mobile)   |     |    API GATEWAY       |     |    MICROSERVICES     |
|                     |     |                     |     |                     |
| - Next.js PWA       |     | - NestJS            |     | 1. Auth Service     |
| - WASM ZKP Engine   |<--->| - Rate Limiting     |<--->| 2. Vote Service     |
| - Local Key Store   |     | - JWT Auth          |     | 3. Crypto Service   |
| - Offline Support   |     | - Input Validation  |     | 4. Notification Svc |
+---------------------+     +---------------------+     | 5. Audit Service    |
         |                                               +---------------------+
         |                                                        |
         v                                                        v
+---------------------+                              +---------------------+
| CENSORSHIP LAYER    |                              |    DATA LAYER       |
|                     |                              |                     |
| - Snowflake         |                              | - PostgreSQL        |
| - obfs4             |                              | - Redis (cache)     |
| - Domain Fronting   |                              | - Merkle Trees      |
| - Auto-detection    |                              | - Hash Chain Store  |
+---------------------+                              +---------------------+
```

## Core Modules

### 1. ZKP Module (`src/core/`)

The cryptographic heart of VoxPop. Built on Semaphore v4 (Ethereum Foundation).

**Responsibilities:**
- Generate ZK-SNARK proofs on client device via WebAssembly
- Verify proofs server-side
- Manage nullifiers (anti-double-vote)
- Maintain SHA-256 hash chains for result integrity

**Key Components:**
- `proof-generator.ts` — Client-side WASM proof generation (<3s target)
- `proof-verifier.ts` — Server-side proof verification
- `nullifier-registry.ts` — Nullifier storage and lookup
- `hash-chain.ts` — SHA-256 vote chaining

### 2. Identity Module (`src/core/`)

Handles voter verification without storing personal data.

**Two verification paths:**
- **Path A: eIDAS 2.0** — Government digital identity (EU 27 countries)
  - FranceConnect, German eID, Belgian itsme, etc.
  - Confirms citizenship without transmitting personal data
- **Path B: Document Verification** — For non-eIDAS countries
  - NFC passport chip reading
  - AI liveness check (anti-deepfake)
  - Document destroyed immediately after verification

**Output:** A cryptographic secret stored only on the user's device, added to the country's Merkle Tree as an anonymous hash.

### 3. Anti-Censorship Module (`src/core/`)

Ensures VoxPop works even in restricted environments.

**Techniques:**
- **Snowflake** — Routes traffic through volunteer browsers worldwide
- **obfs4** — Transforms traffic into random noise
- **Domain Fronting** — Disguises traffic as visits to allowed websites
- **Auto-detection** — Automatically activates when censorship is detected

### 4. API Layer (`src/api/`)

RESTful API built with NestJS.

See [API Design](api-design.md) for full endpoint documentation.

### 5. Web Application (`src/web/`)

Next.js 14 Progressive Web App.

- Mobile-first responsive design
- Offline capability for proof generation
- Tailwind CSS + Framer Motion

## Voting Flow

```
STEP 1: IDENTITY VERIFICATION (one-time)
  User opens VoxPop
  -> Redirected to eIDAS provider (or document scan)
  -> Government confirms: "Citizen of [country]: YES"
  -> Device receives cryptographic SECRET
  -> Secret hash added to country Merkle Tree
  -> No personal data stored anywhere

STEP 2: CASTING A VOTE
  User selects a vote and chooses an option
  -> Device computes (in ~3 seconds via WASM):
     1. ZKP: "I am in the [country] Merkle Tree"
     2. Nullifier: unique code = my secret + this vote ID
     3. Encrypted vote: end-to-end encrypted choice
  -> All sent to VoxPop server

STEP 3: SERVER VERIFICATION
  Server checks:
  -> Is the ZKP mathematically valid? YES
  -> Does this nullifier already exist? NO
  -> VOTE RECORDED
  -> Nullifier added to "already voted" list
  -> Vote appended to hash chain

STEP 4: RECEIPT
  User receives cryptographic receipt:
  -> Vote hash, nullifier, ZKP proof, Merkle root
  -> Can verify vote was counted
  -> Cannot reveal WHAT was voted

STEP 5: RESULTS
  Public and verifiable:
  -> Hash chain: each vote linked to previous
  -> Any tampering breaks the chain = instantly detectable
  -> Anyone can audit (open source code)
```

## 6 Security Layers

| Layer | Technology | Protects Against |
|-------|-----------|-----------------|
| 1 | Identity Verification (eIDAS / document) | Fake accounts, bots, impersonation |
| 2 | Zero-Knowledge Proofs (Semaphore) | Identity exposure, surveillance |
| 3 | Per-Country Merkle Trees | Foreign voters, jurisdiction violations |
| 4 | Cryptographic Nullifiers | Double voting, ballot stuffing |
| 5 | SHA-256 Hash Chain | Result tampering, post-hoc modification |
| 6 | Pluggable Transports (Tor ecosystem) | State censorship, internet blocking |

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Frontend | Next.js 14, React 18, TypeScript | SSR, PWA support, type safety |
| Styling | Tailwind CSS 3.4, Framer Motion | Rapid UI development, animations |
| Backend | NestJS (Node.js) | Modular architecture, TypeScript native |
| Database | PostgreSQL 15+ | ACID compliance, proven reliability |
| Cache | Redis | Session management, rate limiting |
| ZKP | Semaphore v4, snarkjs, Circom | Ethereum Foundation, battle-tested |
| WASM | WebAssembly | Client-side ZKP computation |
| Transport | Snowflake, obfs4 | Tor ecosystem, 20+ years of testing |

## Development Phases

| Phase | Focus | Timeline |
|-------|-------|----------|
| Phase 1 (MVP) | Hash chain + E2E encryption + 2FA | M0-M3 |
| Phase 2 | ZKP integration (Semaphore) | M3-M6 |
| Phase 3 | ElGamal homomorphic tallying | M6-M9 |
| Phase 4 | Hyperledger Fabric (optional) | M9-M12 |

## Privacy by Design

- **Zero personal data stored** — only anonymous cryptographic proofs
- **Client-side computation** — ZKP generated on user's device
- **Secret stored locally** — never transmitted to servers
- **GDPR native** — no data = no risk = full compliance
- **eIDAS 2.0 compliant** — European digital identity standard
