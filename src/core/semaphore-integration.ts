/**
 * VoxPop Secure Voting Module — Semaphore Integration
 *
 * This module provides the core ZKP (Zero-Knowledge Proof) integration
 * using the Semaphore protocol by the Ethereum Foundation's Privacy &
 * Scaling Explorations team.
 *
 * Semaphore allows voters to prove they belong to a group (country-level
 * Merkle Tree) without revealing their identity, while cryptographic
 * nullifiers prevent double-voting.
 *
 * @module semaphore-integration
 * @license AGPL-3.0-or-later
 * @see https://semaphore.pse.dev/
 */

import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import {
  generateProof,
  verifyProof,
  SemaphoreProof,
} from "@semaphore-protocol/proof";

// ============================================================
// Types
// ============================================================

/** Represents a voter's anonymous identity (private key + commitment) */
export interface VoterIdentity {
  /** The Semaphore Identity object (contains trapdoor + nullifier secret) */
  identity: Identity;
  /** The public commitment derived from the identity (added to Merkle Tree) */
  commitment: bigint;
}

/** Represents a single vote with its ZKP */
export interface VoteProof {
  /** The ID of the vote/poll being voted on */
  voteId: string;
  /** The voter's choice (hashed) */
  choice: bigint;
  /** The Semaphore ZK proof */
  proof: SemaphoreProof;
  /** ISO timestamp of when the vote was cast */
  timestamp: string;
  /** The nullifier hash (prevents double voting) */
  nullifierHash: bigint;
}

/** Configuration for a voting session */
export interface VoteConfig {
  /** Unique identifier for this vote/poll */
  voteId: string;
  /** Human-readable title */
  title: string;
  /** Available choices (e.g., ["yes", "no", "abstain"]) */
  choices: string[];
  /** Country code (ISO 3166-1 alpha-2) for jurisdiction-specific votes */
  countryCode: string;
  /** Start time (ISO 8601) */
  startTime: string;
  /** End time (ISO 8601) */
  endTime: string;
}

/** Result of proof verification */
export interface VerificationResult {
  /** Whether the proof is valid */
  isValid: boolean;
  /** The nullifier hash (for double-vote detection) */
  nullifierHash: bigint;
  /** Error message if verification failed */
  error?: string;
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Creates a new anonymous voter identity.
 *
 * The identity consists of:
 * - A trapdoor (private random value)
 * - A nullifier (private random value)
 * - A commitment (public, derived from trapdoor + nullifier)
 *
 * The commitment is what gets added to the country's Merkle Tree.
 * The trapdoor and nullifier must be kept secret by the voter.
 *
 * @returns A new VoterIdentity with a Semaphore Identity and its commitment
 *
 * @example
 * ```typescript
 * const voter = createVoterIdentity();
 * console.log("Commitment:", voter.commitment);
 * // Add voter.commitment to the country's Merkle Tree
 * ```
 */
export function createVoterIdentity(): VoterIdentity {
  const identity = new Identity();
  return {
    identity,
    commitment: identity.commitment,
  };
}

/**
 * Restores a voter identity from a previously saved secret.
 *
 * Voters can export their identity secret and restore it later
 * (e.g., on a different device). This is important because losing
 * the identity means losing the ability to vote.
 *
 * @param secret - The identity secret string (base64 encoded)
 * @returns The restored VoterIdentity
 *
 * @example
 * ```typescript
 * const secret = voter.identity.export();
 * // ... save secret securely ...
 * const restored = restoreVoterIdentity(secret);
 * ```
 */
export function restoreVoterIdentity(secret: string): VoterIdentity {
  const identity = new Identity(secret);
  return {
    identity,
    commitment: identity.commitment,
  };
}

/**
 * Generates a Zero-Knowledge Proof for a vote.
 *
 * This is the core privacy mechanism: the voter proves they are a member
 * of the group (country Merkle Tree) without revealing which member they are.
 * The proof also includes a nullifier that prevents the same identity from
 * voting twice on the same voteId.
 *
 * @param voter - The voter's identity
 * @param group - The Semaphore group (country Merkle Tree)
 * @param voteId - The unique identifier for the vote/poll
 * @param choiceIndex - The index of the chosen option (0-based)
 * @returns A VoteProof containing the ZK proof and metadata
 *
 * @example
 * ```typescript
 * const group = new Group([voter.commitment, ...otherCommitments]);
 * const proof = await generateVoteProof(voter, group, "vote-2026-01", 0);
 * // proof can be sent to the server without revealing voter's identity
 * ```
 */
export async function generateVoteProof(
  voter: VoterIdentity,
  group: Group,
  voteId: string,
  choiceIndex: number
): Promise<VoteProof> {
  // The scope (voteId) ensures the nullifier is unique per vote
  // This prevents double-voting: same identity + same scope = same nullifier
  const proof = await generateProof(voter.identity, group, choiceIndex, voteId);

  return {
    voteId,
    choice: BigInt(choiceIndex),
    proof,
    timestamp: new Date().toISOString(),
    nullifierHash: BigInt(proof.nullifier),
  };
}

/**
 * Verifies a Zero-Knowledge Proof for a vote.
 *
 * This function checks that:
 * 1. The voter is a member of the group (without knowing who)
 * 2. The proof is mathematically valid
 * 3. The nullifier is correctly computed (for double-vote detection)
 *
 * Note: Double-vote detection (checking if nullifierHash was already used)
 * must be done by the caller against a stored set of used nullifiers.
 *
 * @param voteProof - The vote proof to verify
 * @returns A VerificationResult indicating whether the proof is valid
 *
 * @example
 * ```typescript
 * const result = await verifyVoteProof(proof);
 * if (result.isValid) {
 *   // Check nullifierHash against used nullifiers
 *   if (!usedNullifiers.has(result.nullifierHash)) {
 *     usedNullifiers.add(result.nullifierHash);
 *     // Count the vote
 *   }
 * }
 * ```
 */
export async function verifyVoteProof(
  voteProof: VoteProof
): Promise<VerificationResult> {
  try {
    const isValid = await verifyProof(voteProof.proof);

    return {
      isValid,
      nullifierHash: voteProof.nullifierHash,
      error: isValid ? undefined : "Proof verification failed",
    };
  } catch (error) {
    return {
      isValid: false,
      nullifierHash: voteProof.nullifierHash,
      error: error instanceof Error ? error.message : "Unknown verification error",
    };
  }
}

/**
 * Creates a vote configuration object.
 *
 * @param params - The vote configuration parameters
 * @returns A VoteConfig object
 */
export function createVoteConfig(params: {
  voteId: string;
  title: string;
  choices: string[];
  countryCode: string;
  durationMinutes: number;
}): VoteConfig {
  const startTime = new Date();
  const endTime = new Date(startTime.getTime() + params.durationMinutes * 60000);

  return {
    voteId: params.voteId,
    title: params.title,
    choices: params.choices,
    countryCode: params.countryCode.toUpperCase(),
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}
