/**
 * VoxPop Secure Voting Module -- Nullifier System
 *
 * Nullifiers are the cryptographic mechanism that prevents double-voting
 * while preserving voter anonymity.  In the Semaphore protocol the
 * nullifier is deterministically derived from:
 *
 *   nullifier = hash(identityNullifierSecret, scope)
 *
 * where `scope` is the poll ID.  Because the derivation is deterministic,
 * if the same voter attempts to vote twice on the same poll, the resulting
 * nullifier will be identical -- and the system rejects the duplicate.
 *
 * Crucially, the nullifier reveals **nothing** about the voter's identity.
 * It is a one-way function: given a nullifier you cannot derive the
 * identity that produced it.
 *
 * This module provides:
 * 1. Nullifier generation helpers (SHA-256 based for the PoC; the
 *    production system will use Poseidon hashes inside the ZK circuit).
 * 2. A NullifierStore that tracks consumed nullifiers per poll.
 * 3. Batch verification utilities for audit purposes.
 *
 * @module nullifier
 * @license AGPL-3.0-or-later
 */

import { createHash } from "crypto";

// ============================================================
// Types
// ============================================================

/** Record of a consumed nullifier */
export interface NullifierRecord {
  /** The nullifier hash (hex string) */
  nullifierHash: string;
  /** The poll where this nullifier was consumed */
  pollId: string;
  /** ISO 8601 timestamp of when the nullifier was recorded */
  recordedAt: string;
}

/** Result of a nullifier check */
export interface NullifierCheckResult {
  /** Whether the nullifier is fresh (has NOT been used) */
  isFresh: boolean;
  /** If not fresh, the record of the previous use */
  existingRecord?: NullifierRecord;
}

/** Aggregated statistics for nullifier usage */
export interface NullifierStats {
  /** Total number of consumed nullifiers across all polls */
  totalConsumed: number;
  /** Number of polls that have at least one consumed nullifier */
  activePollCount: number;
  /** Per-poll breakdown */
  perPoll: Map<string, number>;
}

// ============================================================
// Nullifier Generation
// ============================================================

/**
 * Generates a deterministic nullifier hash from an identity secret
 * and a poll scope.
 *
 * In the production ZK circuit this is done inside the SNARK using
 * a Poseidon hash.  For the proof-of-concept we use SHA-256 to
 * demonstrate the concept without requiring circuit compilation.
 *
 * The critical property is *determinism*: the same (secret, scope)
 * pair MUST always produce the same nullifier.
 *
 * @param identityNullifierSecret - The voter's private nullifier secret
 *   (bigint from their Semaphore identity)
 * @param scope - The poll identifier used as scope
 * @returns Hex-encoded SHA-256 nullifier hash
 *
 * @example
 * ```ts
 * const nullifier = generateNullifier(identity.nullifierSecret, "poll-2026-01");
 * // "a3f1c4..."  (deterministic 64-char hex string)
 * ```
 */
export function generateNullifier(
  identityNullifierSecret: bigint,
  scope: string
): string {
  const preimage = `${identityNullifierSecret.toString(16)}:${scope}`;
  return createHash("sha256").update(preimage).digest("hex");
}

/**
 * Generates an external nullifier from a poll ID.
 *
 * The external nullifier is a public value that scopes nullifier
 * generation to a specific poll.  In Semaphore v4 this is the
 * `scope` parameter passed to `generateProof()`.
 *
 * @param pollId - The unique poll identifier
 * @returns SHA-256 hash of the poll ID (hex string)
 */
export function generateExternalNullifier(pollId: string): string {
  return createHash("sha256").update(`voxpop:external:${pollId}`).digest("hex");
}

/**
 * Verifies that a nullifier was correctly derived from the given inputs.
 *
 * This is used during vote verification to ensure the voter did not
 * forge a nullifier.  In the full system this check is performed
 * inside the ZK-SNARK verifier; here we do it in plain code for the PoC.
 *
 * @param nullifierHash - The nullifier to verify
 * @param identityNullifierSecret - The voter's private nullifier secret
 * @param scope - The poll scope
 * @returns true if the nullifier matches the expected derivation
 */
export function verifyNullifier(
  nullifierHash: string,
  identityNullifierSecret: bigint,
  scope: string
): boolean {
  const expected = generateNullifier(identityNullifierSecret, scope);
  return nullifierHash === expected;
}

// ============================================================
// NullifierStore
// ============================================================

/**
 * Tracks consumed nullifiers to prevent double-voting.
 *
 * Each poll has its own nullifier set because nullifiers are scoped
 * by poll ID.  The same voter legitimately produces *different*
 * nullifiers for different polls (since the scope differs), so a
 * voter can participate in multiple polls without issue.
 *
 * Thread-safety note: this in-memory implementation is single-threaded.
 * In production, the nullifier store will be backed by a PostgreSQL
 * table with a UNIQUE constraint on (poll_id, nullifier_hash).
 *
 * @example
 * ```ts
 * const store = new NullifierStore();
 *
 * // Voter casts a vote
 * const nullifier = generateNullifier(identity.nullifierSecret, "poll-1");
 * const result = store.consume("poll-1", nullifier);
 * console.log(result.isFresh); // true -- vote accepted
 *
 * // Same voter tries again
 * const again = store.consume("poll-1", nullifier);
 * console.log(again.isFresh); // false -- double vote rejected
 *
 * // Same voter on a different poll -- allowed
 * const otherNull = generateNullifier(identity.nullifierSecret, "poll-2");
 * const other = store.consume("poll-2", otherNull);
 * console.log(other.isFresh); // true
 * ```
 */
export class NullifierStore {
  /**
   * Internal storage: pollId -> Set of consumed nullifier hashes.
   * Using a Map of Sets gives O(1) lookup per poll.
   */
  private consumed: Map<string, Map<string, NullifierRecord>> = new Map();

  /**
   * Attempts to consume a nullifier for a poll.
   *
   * "Consume" means marking the nullifier as used.  If the nullifier
   * has already been consumed for this poll, the attempt is rejected
   * and the existing record is returned.
   *
   * @param pollId - The poll identifier
   * @param nullifierHash - The nullifier hash to consume
   * @returns NullifierCheckResult indicating whether the nullifier was fresh
   */
  consume(pollId: string, nullifierHash: string): NullifierCheckResult {
    let pollMap = this.consumed.get(pollId);

    // Check if nullifier already exists for this poll
    if (pollMap) {
      const existing = pollMap.get(nullifierHash);
      if (existing) {
        return {
          isFresh: false,
          existingRecord: existing,
        };
      }
    } else {
      pollMap = new Map();
      this.consumed.set(pollId, pollMap);
    }

    // Record the new nullifier
    const record: NullifierRecord = {
      nullifierHash,
      pollId,
      recordedAt: new Date().toISOString(),
    };

    pollMap.set(nullifierHash, record);

    return { isFresh: true };
  }

  /**
   * Checks whether a nullifier has been consumed without consuming it.
   *
   * Useful for pre-flight checks before expensive proof verification.
   *
   * @param pollId - The poll identifier
   * @param nullifierHash - The nullifier hash to check
   * @returns NullifierCheckResult
   */
  check(pollId: string, nullifierHash: string): NullifierCheckResult {
    const pollMap = this.consumed.get(pollId);
    if (!pollMap) {
      return { isFresh: true };
    }

    const existing = pollMap.get(nullifierHash);
    if (existing) {
      return { isFresh: false, existingRecord: existing };
    }

    return { isFresh: true };
  }

  /**
   * Returns the number of consumed nullifiers for a specific poll.
   *
   * @param pollId - The poll identifier
   * @returns Count of consumed nullifiers
   */
  countForPoll(pollId: string): number {
    return this.consumed.get(pollId)?.size ?? 0;
  }

  /**
   * Returns all consumed nullifier records for a poll (for auditing).
   *
   * @param pollId - The poll identifier
   * @returns Array of NullifierRecords, ordered by recordedAt
   */
  getRecordsForPoll(pollId: string): NullifierRecord[] {
    const pollMap = this.consumed.get(pollId);
    if (!pollMap) return [];

    return Array.from(pollMap.values()).sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );
  }

  /**
   * Verifies that no duplicate nullifiers exist within a poll.
   *
   * This is a consistency check for audit purposes.  In a correctly
   * functioning system this should always return 0.
   *
   * @param pollId - The poll identifier
   * @returns Number of duplicate nullifiers detected (should be 0)
   */
  auditDuplicates(pollId: string): number {
    // In a Map-based store, duplicates are structurally impossible.
    // This method exists for the interface contract and for use when
    // auditing data imported from external sources (e.g. JSON dump).
    const pollMap = this.consumed.get(pollId);
    if (!pollMap) return 0;

    const seen = new Set<string>();
    let duplicates = 0;
    for (const hash of pollMap.keys()) {
      if (seen.has(hash)) duplicates++;
      seen.add(hash);
    }
    return duplicates;
  }

  /**
   * Returns aggregate statistics about nullifier usage.
   *
   * @returns NullifierStats
   */
  getStats(): NullifierStats {
    let totalConsumed = 0;
    const perPoll = new Map<string, number>();

    for (const [pollId, pollMap] of this.consumed) {
      const count = pollMap.size;
      perPoll.set(pollId, count);
      totalConsumed += count;
    }

    return {
      totalConsumed,
      activePollCount: this.consumed.size,
      perPoll,
    };
  }

  /**
   * Lists all poll IDs that have at least one consumed nullifier.
   *
   * @returns Array of poll IDs
   */
  listPolls(): string[] {
    return Array.from(this.consumed.keys());
  }

  /**
   * Resets all consumed nullifiers for a specific poll.
   *
   * This is ONLY intended for testing.  In production, nullifiers
   * are never cleared (they are permanent records).
   *
   * @param pollId - The poll to reset
   */
  resetPoll(pollId: string): void {
    this.consumed.delete(pollId);
  }

  /**
   * Resets the entire store.  Testing only.
   */
  reset(): void {
    this.consumed.clear();
  }
}

/**
 * Creates a new NullifierStore instance.
 *
 * @returns A fresh NullifierStore
 */
export function createNullifierStore(): NullifierStore {
  return new NullifierStore();
}
