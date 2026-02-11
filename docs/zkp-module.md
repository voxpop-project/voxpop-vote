# VoxPop — ZKP Module Specification

## Overview

The ZKP (Zero-Knowledge Proof) module is the cryptographic core of VoxPop. It enables voters to prove their eligibility without revealing their identity.

**Library:** Semaphore v4 (Privacy & Scaling Explorations, Ethereum Foundation)
**Proof System:** Groth16 ZK-SNARKs
**Client Computation:** WebAssembly (target: <3 seconds on modern smartphones)

## Core Concepts

### Identity & Secrets

When a citizen verifies their identity (via eIDAS or document), they receive a **cryptographic secret** — a random value stored only on their device.

```
Identity Verification → Secret Generation → Merkle Tree Insertion
     (eIDAS/doc)         (device-only)        (anonymous hash)
```

The secret never leaves the device. Only its hash (commitment) is added to the Merkle Tree.

### Semaphore Integration

Semaphore provides:
- **Identity:** Generates a cryptographic identity (trapdoor + nullifier secret)
- **Group:** Manages Merkle Tree membership (per-country groups)
- **Proof:** Generates and verifies ZK-SNARK proofs

```typescript
import { Identity } from "@semaphore-protocol/identity"
import { Group } from "@semaphore-protocol/group"
import { generateProof, verifyProof } from "@semaphore-protocol/proof"

// 1. Create identity (on user's device, one-time)
const identity = new Identity(userSecret)

// 2. Add to country group (after verification)
const franceGroup = new Group()
franceGroup.addMember(identity.commitment)

// 3. Generate proof when voting
const proof = await generateProof(identity, franceGroup, voteSignal, pollId)

// 4. Verify proof on server
const isValid = await verifyProof(proof)
```

## Per-Country Merkle Trees

Each country maintains its own Merkle Tree of verified citizens.

```
France Tree          Belgium Tree         Germany Tree
    Root                 Root                 Root
   /    \               /    \               /    \
  H01   H23           H01   H23           H01   H23
 / \   / \           / \   / \           / \   / \
C1  C2 C3  C4       C1  C2 C3  C4       C1  C2 C3  C4
```

**Properties:**
- Tree depth: 20 (supports ~1 million members per country)
- Scalable to depth 23 (~8 million members)
- Membership proof: O(log n) — ~20 steps for 1 million members
- Append-only with batched insertions for consistency

**Country Isolation:**
- A French citizen's commitment exists ONLY in the France tree
- A proof generated against the France tree cannot validate a Belgian vote
- This is enforced mathematically, not by access control

## Nullifier System

Nullifiers prevent double-voting while maintaining anonymity.

### How It Works

```
nullifier = hash(identity_secret + poll_id)
```

- **Deterministic:** Same person + same poll = always the same nullifier
- **One-way:** Cannot derive identity from nullifier
- **Unique per poll:** Different poll = different nullifier (so voting history is unlinkable)

### Double-Vote Prevention

```
First vote:
  1. Compute nullifier: hash(secret + poll_42) = "9c2f1b8a..."
  2. Check registry: "9c2f1b8a..." exists? NO
  3. Record vote + add nullifier to registry
  4. VOTE ACCEPTED

Second attempt:
  1. Compute nullifier: hash(secret + poll_42) = "9c2f1b8a..." (same!)
  2. Check registry: "9c2f1b8a..." exists? YES
  3. VOTE REJECTED — "Already voted"
```

### Why It Cannot Be Bypassed

| Attack | Why It Fails |
|--------|-------------|
| Change secret to get new nullifier | New secret not in Merkle Tree = proof invalid |
| Create second account | eIDAS/identity verification only issues one secret per citizen |
| Modify nullifier before sending | Nullifier is verified as part of the ZKP = tampering detected |
| Delete nullifier from registry | Hash chain detects any modification to the registry |

## SHA-256 Hash Chain

Every recorded vote is chained to the previous one:

```
Vote 1: hash_1 = SHA256(vote_1 + "genesis")
Vote 2: hash_2 = SHA256(vote_2 + hash_1)
Vote 3: hash_3 = SHA256(vote_3 + hash_2)
...
Vote N: hash_N = SHA256(vote_N + hash_{N-1})
```

**Tamper Detection:** Modifying any single vote changes its hash, which cascades through all subsequent hashes. Any tampering is instantly detectable by recomputing the chain.

## Performance Targets

| Operation | Target | Method |
|-----------|--------|--------|
| Proof generation (client) | < 3 seconds | WebAssembly, Groth16 |
| Proof verification (server) | < 500 ms | Native snarkjs |
| Merkle Tree lookup | < 50 ms | O(log n), depth 20 |
| Nullifier check | < 10 ms | Hash table lookup |
| Hash chain append | < 5 ms | Single SHA-256 |

## WebAssembly Strategy

ZKP computation happens entirely on the client device:

1. WASM circuit files bundled with the application
2. Proof generated locally — no data sent to server during computation
3. Only the proof, nullifier, and encrypted vote are transmitted
4. Progressive loading: circuit files cached after first use

## File Structure

```
src/core/
  zkp/
    identity.ts        — Identity creation and management
    group.ts           — Merkle Tree group operations
    proof-generator.ts — Client-side WASM proof generation
    proof-verifier.ts  — Server-side proof verification
    circuits/          — Circom circuit definitions
  nullifier/
    registry.ts        — Nullifier storage and lookup
    validator.ts       — Nullifier validation logic
  hash-chain/
    chain.ts           — SHA-256 chain operations
    verifier.ts        — Chain integrity verification
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @semaphore-protocol/core | ^4.0.0 | Core Semaphore functionality |
| @semaphore-protocol/identity | ^4.0.0 | Identity management |
| @semaphore-protocol/group | ^4.0.0 | Merkle Tree groups |
| @semaphore-protocol/proof | ^4.0.0 | Proof generation/verification |
| snarkjs | latest | ZK-SNARK proof system |
| circomlib | latest | Circuit library |
