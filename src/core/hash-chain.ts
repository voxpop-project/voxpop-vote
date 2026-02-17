/**
 * VoxPop Secure Voting Module — SHA-256 Hash Chain for Vote Integrity
 *
 * This module implements a tamper-evident hash chain to guarantee the
 * integrity of vote results. Each vote is linked to the previous one
 * through a SHA-256 hash, creating an append-only ledger that can be
 * independently audited.
 *
 * If any vote is modified, removed, or inserted after the fact, the
 * chain breaks — making tampering immediately detectable.
 *
 * Key design decisions:
 * - SHA-256 for broad compatibility and proven security
 * - Genesis block with deterministic hash (auditable from block 0)
 * - Each block contains: index, previous hash, nullifier hash, vote data, timestamp
 * - No personal data in the chain — only cryptographic references
 *
 * @module hash-chain
 * @license AGPL-3.0-or-later
 */

import { createHash } from "crypto";

// ============================================================
// Types
// ============================================================

/** Represents a single block in the vote hash chain */
export interface VoteBlock {
  /** Sequential index of this block (0 = genesis) */
  index: number;
  /** SHA-256 hash of the previous block (all zeros for genesis) */
  previousHash: string;
  /** SHA-256 hash of this block's contents */
  hash: string;
  /** ISO 8601 timestamp of when this block was created */
  timestamp: string;
  /** The poll/vote ID this vote belongs to */
  pollId: string;
  /** The nullifier hash (unique per voter per poll — no identity leak) */
  nullifierHash: string;
  /** The index of the chosen option (0-based) */
  choiceIndex: number;
}

/** Result of a chain integrity verification */
export interface ChainVerificationResult {
  /** Whether the entire chain is valid */
  isValid: boolean;
  /** Total number of blocks checked */
  blocksChecked: number;
  /** Index of the first invalid block (-1 if all valid) */
  firstInvalidBlock: number;
  /** Error description if chain is invalid */
  error?: string;
}

/** Summary statistics for a hash chain */
export interface ChainStats {
  /** Total number of blocks (including genesis) */
  totalBlocks: number;
  /** Total number of votes (blocks minus genesis) */
  totalVotes: number;
  /** Hash of the genesis block */
  genesisHash: string;
  /** Hash of the latest block */
  latestHash: string;
  /** Timestamp of the first vote (or genesis if no votes) */
  firstTimestamp: string;
  /** Timestamp of the latest block */
  latestTimestamp: string;
}

// ============================================================
// Constants
// ============================================================

/** The previous hash for the genesis block (64 zeros = SHA-256 null) */
const GENESIS_PREVIOUS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

/** The poll ID for the genesis block */
const GENESIS_POLL_ID = "GENESIS";

// ============================================================
// Core Functions
// ============================================================

/**
 * Computes the SHA-256 hash of a block's contents.
 *
 * The hash is computed over a deterministic string representation of
 * the block data (excluding the hash field itself). This ensures that
 * any change to the block's contents produces a different hash.
 *
 * @param index - Block index
 * @param previousHash - Hash of the previous block
 * @param timestamp - ISO 8601 timestamp
 * @param pollId - The poll identifier
 * @param nullifierHash - The voter's nullifier hash
 * @param choiceIndex - The chosen option index
 * @returns SHA-256 hex digest
 */
export function computeBlockHash(
  index: number,
  previousHash: string,
  timestamp: string,
  pollId: string,
  nullifierHash: string,
  choiceIndex: number
): string {
  const data = `${index}|${previousHash}|${timestamp}|${pollId}|${nullifierHash}|${choiceIndex}`;
  return createHash("sha256").update(data).digest("hex");
}

// ============================================================
// VoteHashChain Class
// ============================================================

/**
 * Manages an append-only hash chain for vote integrity.
 *
 * Every vote cast is recorded as a block in the chain. Each block
 * references the previous block's hash, creating a tamper-evident
 * sequence. If any block is modified after insertion, all subsequent
 * hashes become invalid — making tampering immediately detectable
 * during audit.
 *
 * @example
 * ```typescript
 * const chain = new VoteHashChain("referendum-2026");
 *
 * // Add votes (nullifier hashes come from ZKP verification)
 * chain.addVote("abc123...", 0); // Voter chose option 0
 * chain.addVote("def456...", 1); // Voter chose option 1
 *
 * // Verify integrity
 * const result = chain.verify();
 * console.log(result.isValid); // true
 *
 * // Get results
 * const tally = chain.tally();
 * console.log(tally); // Map { 0 => 1, 1 => 1 }
 * ```
 */
export class VoteHashChain {
  /** The poll this chain belongs to */
  readonly pollId: string;

  /** The ordered list of blocks */
  private blocks: VoteBlock[] = [];

  /** Set of nullifier hashes already in the chain (double-vote prevention) */
  private usedNullifiers: Set<string> = new Set();

  /**
   * Creates a new VoteHashChain with a genesis block.
   *
   * @param pollId - The unique identifier for the poll/vote
   */
  constructor(pollId: string) {
    if (!pollId || pollId.trim() === "") {
      throw new Error("Poll ID cannot be empty");
    }

    this.pollId = pollId;

    // Create genesis block
    const timestamp = new Date().toISOString();
    const hash = computeBlockHash(
      0,
      GENESIS_PREVIOUS_HASH,
      timestamp,
      GENESIS_POLL_ID,
      "0",
      -1
    );

    const genesis: VoteBlock = {
      index: 0,
      previousHash: GENESIS_PREVIOUS_HASH,
      hash,
      timestamp,
      pollId: GENESIS_POLL_ID,
      nullifierHash: "0",
      choiceIndex: -1,
    };

    this.blocks.push(genesis);
  }

  /**
   * Adds a vote to the hash chain.
   *
   * The nullifier hash is checked against previously used nullifiers
   * to prevent double voting. If the nullifier was already used, the
   * vote is rejected.
   *
   * @param nullifierHash - The voter's nullifier hash (from ZKP verification)
   * @param choiceIndex - The index of the chosen option (0-based)
   * @returns The created VoteBlock, or null if the vote was rejected (double vote)
   *
   * @example
   * ```typescript
   * const block = chain.addVote("abc123def456...", 0);
   * if (block) {
   *   console.log("Vote recorded at index", block.index);
   * } else {
   *   console.log("Double vote detected!");
   * }
   * ```
   */
  addVote(nullifierHash: string, choiceIndex: number): VoteBlock | null {
    // Double-vote prevention
    if (this.usedNullifiers.has(nullifierHash)) {
      return null;
    }

    if (choiceIndex < 0 || !Number.isInteger(choiceIndex)) {
      throw new Error("Choice index must be a non-negative integer");
    }

    const previousBlock = this.blocks[this.blocks.length - 1];
    const index = previousBlock.index + 1;
    const timestamp = new Date().toISOString();

    const hash = computeBlockHash(
      index,
      previousBlock.hash,
      timestamp,
      this.pollId,
      nullifierHash,
      choiceIndex
    );

    const block: VoteBlock = {
      index,
      previousHash: previousBlock.hash,
      hash,
      timestamp,
      pollId: this.pollId,
      nullifierHash,
      choiceIndex,
    };

    this.blocks.push(block);
    this.usedNullifiers.add(nullifierHash);

    return block;
  }

  /**
   * Verifies the integrity of the entire hash chain.
   *
   * Checks that:
   * 1. The genesis block has the correct previous hash (all zeros)
   * 2. Each block's hash matches its recomputed hash
   * 3. Each block's previousHash matches the previous block's hash
   * 4. Block indices are sequential
   *
   * @returns A ChainVerificationResult with the verification outcome
   *
   * @example
   * ```typescript
   * const result = chain.verify();
   * if (!result.isValid) {
   *   console.error(`Chain corrupted at block ${result.firstInvalidBlock}`);
   * }
   * ```
   */
  verify(): ChainVerificationResult {
    if (this.blocks.length === 0) {
      return {
        isValid: false,
        blocksChecked: 0,
        firstInvalidBlock: 0,
        error: "Chain is empty (no genesis block)",
      };
    }

    // Check genesis block
    const genesis = this.blocks[0];
    if (genesis.previousHash !== GENESIS_PREVIOUS_HASH) {
      return {
        isValid: false,
        blocksChecked: 1,
        firstInvalidBlock: 0,
        error: "Genesis block has invalid previous hash",
      };
    }

    // Verify each block
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];

      // Check index is sequential
      if (block.index !== i) {
        return {
          isValid: false,
          blocksChecked: i + 1,
          firstInvalidBlock: i,
          error: `Block ${i} has wrong index: expected ${i}, got ${block.index}`,
        };
      }

      // Recompute hash and compare
      const expectedHash = computeBlockHash(
        block.index,
        block.previousHash,
        block.timestamp,
        block.pollId,
        block.nullifierHash,
        block.choiceIndex
      );

      if (block.hash !== expectedHash) {
        return {
          isValid: false,
          blocksChecked: i + 1,
          firstInvalidBlock: i,
          error: `Block ${i} hash mismatch: expected ${expectedHash}, got ${block.hash}`,
        };
      }

      // Check link to previous block (skip genesis)
      if (i > 0) {
        const previousBlock = this.blocks[i - 1];
        if (block.previousHash !== previousBlock.hash) {
          return {
            isValid: false,
            blocksChecked: i + 1,
            firstInvalidBlock: i,
            error: `Block ${i} previousHash doesn't match block ${i - 1} hash`,
          };
        }
      }
    }

    return {
      isValid: true,
      blocksChecked: this.blocks.length,
      firstInvalidBlock: -1,
    };
  }

  /**
   * Tallies the votes by choice index.
   *
   * Returns a Map where keys are choice indices and values are vote counts.
   * The genesis block is excluded from the tally.
   *
   * @returns Map of choiceIndex -> voteCount
   *
   * @example
   * ```typescript
   * const tally = chain.tally();
   * // Map { 0 => 15, 1 => 8, 2 => 3 }
   * ```
   */
  tally(): Map<number, number> {
    const counts = new Map<number, number>();

    for (const block of this.blocks) {
      // Skip genesis block
      if (block.index === 0) continue;

      const current = counts.get(block.choiceIndex) || 0;
      counts.set(block.choiceIndex, current + 1);
    }

    return counts;
  }

  /**
   * Gets a specific block by index.
   *
   * @param index - The block index (0 = genesis)
   * @returns The VoteBlock, or undefined if index is out of range
   */
  getBlock(index: number): VoteBlock | undefined {
    return this.blocks[index];
  }

  /**
   * Gets the latest block in the chain.
   *
   * @returns The most recent VoteBlock
   */
  getLatestBlock(): VoteBlock {
    return this.blocks[this.blocks.length - 1];
  }

  /**
   * Gets the total number of blocks (including genesis).
   *
   * @returns The chain length
   */
  get length(): number {
    return this.blocks.length;
  }

  /**
   * Gets the number of votes recorded (excluding genesis).
   *
   * @returns The number of votes
   */
  get voteCount(): number {
    return this.blocks.length - 1;
  }

  /**
   * Checks if a nullifier hash has already been used.
   *
   * @param nullifierHash - The nullifier hash to check
   * @returns true if the nullifier was already used (double vote attempt)
   */
  hasNullifier(nullifierHash: string): boolean {
    return this.usedNullifiers.has(nullifierHash);
  }

  /**
   * Returns all blocks in the chain (for export/audit).
   *
   * @returns A copy of the blocks array
   */
  getAllBlocks(): VoteBlock[] {
    return [...this.blocks];
  }

  /**
   * Returns chain statistics.
   *
   * @returns ChainStats summary
   */
  getStats(): ChainStats {
    const genesis = this.blocks[0];
    const latest = this.blocks[this.blocks.length - 1];

    return {
      totalBlocks: this.blocks.length,
      totalVotes: this.blocks.length - 1,
      genesisHash: genesis.hash,
      latestHash: latest.hash,
      firstTimestamp: genesis.timestamp,
      latestTimestamp: latest.timestamp,
    };
  }

  /**
   * Imports and verifies an existing chain (for audit purposes).
   *
   * Takes an array of blocks (e.g., from JSON export) and verifies
   * the entire chain before accepting it. Useful for independent
   * third-party audits.
   *
   * @param pollId - The expected poll ID
   * @param blocks - The array of VoteBlocks to import
   * @returns A new VoteHashChain if valid, or null if verification fails
   *
   * @example
   * ```typescript
   * const exportedBlocks = JSON.parse(chainJson);
   * const auditChain = VoteHashChain.fromBlocks("poll-123", exportedBlocks);
   * if (auditChain) {
   *   console.log("Chain verified:", auditChain.getStats());
   * }
   * ```
   */
  static fromBlocks(
    pollId: string,
    blocks: VoteBlock[]
  ): VoteHashChain | null {
    if (!blocks || blocks.length === 0) {
      return null;
    }

    // Create a chain and manually set its blocks for verification
    const chain = Object.create(VoteHashChain.prototype) as VoteHashChain;
    Object.defineProperty(chain, "pollId", {
      value: pollId,
      writable: false,
    });

    // Use Object.assign to set private fields
    const blocksArray: VoteBlock[] = [...blocks];
    const nullifierSet = new Set<string>();

    // Rebuild nullifier set from blocks (skip genesis)
    for (const block of blocksArray) {
      if (block.index > 0) {
        nullifierSet.add(block.nullifierHash);
      }
    }

    // Set private fields via closure trick
    Object.defineProperty(chain, "blocks", {
      value: blocksArray,
      writable: true,
    });
    Object.defineProperty(chain, "usedNullifiers", {
      value: nullifierSet,
      writable: true,
    });

    // Verify the imported chain
    const result = chain.verify();
    if (!result.isValid) {
      return null;
    }

    return chain;
  }
}

/**
 * Creates a new VoteHashChain for a poll.
 *
 * Factory function for convenience.
 *
 * @param pollId - The unique poll identifier
 * @returns A new VoteHashChain with a genesis block
 */
export function createHashChain(pollId: string): VoteHashChain {
  return new VoteHashChain(pollId);
}
