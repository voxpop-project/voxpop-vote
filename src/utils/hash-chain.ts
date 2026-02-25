/**
 * VoxPop Secure Voting Module -- SHA-256 Hash Chain Utility
 *
 * A lightweight, generic hash chain implementation used as the
 * cryptographic backbone for vote integrity.  Unlike the higher-level
 * VoteHashChain in `src/core/hash-chain.ts` (which is poll-specific),
 * this utility provides a general-purpose append-only hash chain that
 * can be reused for any data type.
 *
 * Properties:
 * - Append-only: entries can only be added, never removed or modified.
 * - Tamper-evident: changing any entry invalidates all subsequent hashes.
 * - Deterministic: the same sequence of entries always produces the same
 *   chain.
 * - Auditable: the full chain can be exported and independently verified.
 *
 * @module utils/hash-chain
 * @license AGPL-3.0-or-later
 */

import { createHash } from "crypto";

// ============================================================
// Types
// ============================================================

/** A single entry in the generic hash chain */
export interface ChainEntry<T> {
  /** Sequential index (0 = genesis) */
  index: number;
  /** SHA-256 hash of the previous entry */
  previousHash: string;
  /** SHA-256 hash of this entry's content + metadata */
  hash: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The payload data */
  data: T;
}

/** Verification result for the chain */
export interface HashChainVerification {
  isValid: boolean;
  entriesChecked: number;
  firstInvalidIndex: number;
  error?: string;
}

// ============================================================
// Constants
// ============================================================

/** SHA-256 of an all-zeros input -- the "null" previous hash for genesis */
const GENESIS_PREVIOUS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

// ============================================================
// Hash Utilities
// ============================================================

/**
 * Computes a SHA-256 hash of arbitrary string data.
 *
 * @param data - The string to hash
 * @returns Hex-encoded SHA-256 digest (64 characters)
 */
export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Computes a SHA-256 hash of a buffer.
 *
 * @param buffer - The buffer to hash
 * @returns Hex-encoded SHA-256 digest
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Computes a double SHA-256 hash (hash of hash).
 *
 * Double hashing is used in Bitcoin and provides additional security
 * against length-extension attacks.
 *
 * @param data - The string to double-hash
 * @returns Hex-encoded double SHA-256 digest
 */
export function doubleSha256(data: string): string {
  const first = createHash("sha256").update(data).digest();
  return createHash("sha256").update(first).digest("hex");
}

// ============================================================
// HashChain Class
// ============================================================

/**
 * Generic append-only hash chain.
 *
 * Each entry contains a payload of type T.  The hash of each entry is
 * computed over a deterministic serialisation of:
 * `index | previousHash | timestamp | JSON(data)`
 *
 * This ensures that any modification to any field in any entry will
 * invalidate the chain from that point forward.
 *
 * @typeParam T - The payload type stored in each entry
 *
 * @example
 * ```ts
 * // Create a chain for vote records
 * interface VoteRecord { nullifier: string; choice: number; }
 *
 * const chain = new HashChain<VoteRecord>();
 *
 * chain.append({ nullifier: "abc123", choice: 0 });
 * chain.append({ nullifier: "def456", choice: 1 });
 *
 * console.log(chain.getLatestHash());  // "e4d909..."
 * console.log(chain.verify().isValid); // true
 *
 * // Export for audit
 * const entries = chain.getAll();
 * const json = JSON.stringify(entries, null, 2);
 * ```
 */
export class HashChain<T> {
  private entries: ChainEntry<T>[] = [];

  /**
   * Creates a new hash chain with a genesis entry.
   *
   * @param genesisData - The data for the genesis entry
   */
  constructor(genesisData: T) {
    const timestamp = new Date().toISOString();
    const dataJson = JSON.stringify(genesisData);
    const hashInput = `0|${GENESIS_PREVIOUS_HASH}|${timestamp}|${dataJson}`;
    const hash = sha256(hashInput);

    this.entries.push({
      index: 0,
      previousHash: GENESIS_PREVIOUS_HASH,
      hash,
      timestamp,
      data: genesisData,
    });
  }

  /**
   * Appends a new entry to the chain.
   *
   * @param data - The payload to record
   * @returns The created ChainEntry
   */
  append(data: T): ChainEntry<T> {
    const previous = this.entries[this.entries.length - 1];
    const index = previous.index + 1;
    const timestamp = new Date().toISOString();
    const dataJson = JSON.stringify(data);
    const hashInput = `${index}|${previous.hash}|${timestamp}|${dataJson}`;
    const hash = sha256(hashInput);

    const entry: ChainEntry<T> = {
      index,
      previousHash: previous.hash,
      hash,
      timestamp,
      data,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Verifies the integrity of the entire chain.
   *
   * Checks:
   * 1. Genesis entry has the correct previous hash (all zeros)
   * 2. Each entry's hash matches its recomputed hash
   * 3. Each entry's previousHash matches the preceding entry's hash
   * 4. Indices are sequential
   *
   * @returns HashChainVerification result
   */
  verify(): HashChainVerification {
    if (this.entries.length === 0) {
      return {
        isValid: false,
        entriesChecked: 0,
        firstInvalidIndex: 0,
        error: "Chain is empty",
      };
    }

    // Check genesis
    if (this.entries[0].previousHash !== GENESIS_PREVIOUS_HASH) {
      return {
        isValid: false,
        entriesChecked: 1,
        firstInvalidIndex: 0,
        error: "Genesis entry has invalid previous hash",
      };
    }

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Check sequential index
      if (entry.index !== i) {
        return {
          isValid: false,
          entriesChecked: i + 1,
          firstInvalidIndex: i,
          error: `Entry ${i} has wrong index: expected ${i}, got ${entry.index}`,
        };
      }

      // Recompute hash
      const dataJson = JSON.stringify(entry.data);
      const hashInput = `${entry.index}|${entry.previousHash}|${entry.timestamp}|${dataJson}`;
      const expectedHash = sha256(hashInput);

      if (entry.hash !== expectedHash) {
        return {
          isValid: false,
          entriesChecked: i + 1,
          firstInvalidIndex: i,
          error: `Entry ${i} hash mismatch`,
        };
      }

      // Check chain link (skip genesis)
      if (i > 0 && entry.previousHash !== this.entries[i - 1].hash) {
        return {
          isValid: false,
          entriesChecked: i + 1,
          firstInvalidIndex: i,
          error: `Entry ${i} previousHash does not match entry ${i - 1} hash`,
        };
      }
    }

    return {
      isValid: true,
      entriesChecked: this.entries.length,
      firstInvalidIndex: -1,
    };
  }

  /**
   * Returns the hash of the latest entry.
   *
   * @returns SHA-256 hex string
   */
  getLatestHash(): string {
    return this.entries[this.entries.length - 1].hash;
  }

  /**
   * Returns the latest entry.
   *
   * @returns The most recent ChainEntry
   */
  getLatest(): ChainEntry<T> {
    return this.entries[this.entries.length - 1];
  }

  /**
   * Returns an entry by index.
   *
   * @param index - The entry index
   * @returns The ChainEntry or undefined if out of range
   */
  getEntry(index: number): ChainEntry<T> | undefined {
    return this.entries[index];
  }

  /**
   * Returns a copy of all entries (for export/audit).
   *
   * @returns Array of ChainEntries
   */
  getAll(): ChainEntry<T>[] {
    return [...this.entries];
  }

  /**
   * Returns the total number of entries (including genesis).
   */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Imports and verifies a chain from a serialised array of entries.
   *
   * @param entries - The entries to import
   * @returns A new HashChain if valid, or null if verification fails
   */
  static fromEntries<T>(entries: ChainEntry<T>[]): HashChain<T> | null {
    if (!entries || entries.length === 0) return null;

    // Create a chain using Object.create to bypass constructor
    const chain = Object.create(HashChain.prototype) as HashChain<T>;
    Object.defineProperty(chain, "entries", {
      value: [...entries],
      writable: true,
      configurable: true,
    });

    // Verify integrity
    const result = chain.verify();
    if (!result.isValid) return null;

    return chain;
  }
}

/**
 * Factory function to create a new HashChain.
 *
 * @param genesisData - Payload for the genesis entry
 * @returns A new HashChain instance
 */
export function createChain<T>(genesisData: T): HashChain<T> {
  return new HashChain<T>(genesisData);
}
