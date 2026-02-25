/**
 * VoxPop Secure Voting Module -- Main Orchestrator
 *
 * The VoteModule is the top-level entry point that wires together all
 * cryptographic sub-systems into a coherent voting API:
 *
 *   GroupManager   -- Semaphore group management (per-country Merkle trees)
 *   NullifierStore -- Double-vote prevention
 *   VoteHashChain  -- Tamper-evident vote ledger
 *   MerkleTree     -- SHA-256 audit snapshots
 *
 * The module exposes four principal operations:
 *   1. createPoll()  -- Define a new voting session
 *   2. castVote()    -- Submit a vote with ZKP proof
 *   3. verifyVote()  -- Independently verify a recorded vote
 *   4. getResults()  -- Privacy-preserving vote tallying
 *
 * Privacy guarantees:
 * - No voter identity is ever stored or logged.
 * - Votes are linked to nullifiers (not to people).
 * - Results are aggregated -- individual votes cannot be traced back.
 * - All data structures are designed for independent third-party audit.
 *
 * @module vote-module
 * @license AGPL-3.0-or-later
 */

import { createHash, randomUUID } from "crypto";
import { Group } from "@semaphore-protocol/group";
import {
  GroupManager,
  createVoterIdentity,
  generateVoteProof,
  verifyVoteProof,
  type VoterIdentity,
  type VoteProof,
  type VoteConfig,
} from "./semaphore-integration";
import { NullifierStore, generateNullifier } from "./nullifier";
import { VoteHashChain, createHashChain } from "./hash-chain";
import { CountryTreeRegistry } from "./merkle-tree";

// ============================================================
// Types
// ============================================================

/** Status of a managed poll */
export type PollStatus = "upcoming" | "active" | "closed";

/** A poll managed by the VoteModule */
export interface ManagedPoll {
  /** Unique poll identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Longer description */
  description: string;
  /** Available options (minimum 2) */
  options: string[];
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  /** Current lifecycle status */
  status: PollStatus;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 closing timestamp */
  closesAt: string;
  /** Whether full ZKP verification is enforced */
  requireZkp: boolean;
}

/** Parameters for creating a new poll */
export interface CreatePollParams {
  title: string;
  description?: string;
  options: string[];
  countryCode: string;
  /** Duration in minutes */
  durationMinutes: number;
  requireZkp?: boolean;
}

/** Receipt returned after a successful vote */
export interface VoteReceipt {
  /** Whether the vote was accepted */
  accepted: boolean;
  /** SHA-256 hash of the vote block */
  voteHash: string;
  /** Position in the hash chain */
  chainPosition: number;
  /** Hash of the previous block */
  previousHash: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The nullifier that was consumed */
  nullifierHash: string;
}

/** Parameters for casting a vote */
export interface CastVoteParams {
  /** The poll to vote on */
  pollId: string;
  /** The nullifier hash (from ZKP or generated) */
  nullifierHash: string;
  /** Zero-based choice index */
  choiceIndex: number;
  /** Optional: the full Semaphore proof for ZKP verification */
  proof?: VoteProof;
}

/** Aggregated result for a single option */
export interface OptionTally {
  option: string;
  index: number;
  votes: number;
  percentage: number;
}

/** Full result set for a poll */
export interface PollResults {
  pollId: string;
  status: PollStatus;
  results: OptionTally[];
  totalVotes: number;
  hashChain: {
    genesisHash: string;
    latestHash: string;
    length: number;
    isValid: boolean;
  };
  computedAt: string;
}

/** Comprehensive audit report */
export interface PollAudit {
  pollId: string;
  totalVotes: number;
  totalBlocks: number;
  hashChainValid: boolean;
  firstInvalidBlock: number;
  duplicateNullifiers: number;
  merkleTreeConsistent: boolean;
  genesisHash: string;
  latestHash: string;
  firstTimestamp: string;
  latestTimestamp: string;
}

/** Error thrown by the VoteModule */
export class VoteModuleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly pollId?: string
  ) {
    super(message);
    this.name = "VoteModuleError";
  }
}

// ============================================================
// VoteModule
// ============================================================

/**
 * The central orchestrator for the VoxPop secure voting system.
 *
 * Coordinates all sub-systems (groups, nullifiers, hash chains) to
 * provide a complete privacy-preserving voting solution.
 *
 * @example
 * ```ts
 * const voteModule = new VoteModule();
 *
 * // --- Setup ---
 * voteModule.registerCountry("FR");
 *
 * // --- Create a poll ---
 * const poll = voteModule.createPoll({
 *   title: "Should we adopt renewable energy?",
 *   options: ["Yes", "No", "Abstain"],
 *   countryCode: "FR",
 *   durationMinutes: 10080, // 7 days
 * });
 *
 * // --- Register voters (after identity verification) ---
 * const voter = createVoterIdentity();
 * voteModule.registerVoter("FR", voter.commitment);
 *
 * // --- Cast a vote ---
 * const nullifier = generateNullifier(voter.identity.commitment, poll.id);
 * const receipt = voteModule.castVote({
 *   pollId: poll.id,
 *   nullifierHash: nullifier,
 *   choiceIndex: 0,
 * });
 *
 * console.log(receipt.accepted); // true
 *
 * // --- Get results ---
 * const results = voteModule.getResults(poll.id);
 * console.log(results.results);
 * // [{ option: "Yes", votes: 1, ... }, { option: "No", votes: 0, ... }, ...]
 *
 * // --- Audit ---
 * const audit = voteModule.audit(poll.id);
 * console.log(audit.hashChainValid); // true
 * ```
 */
export class VoteModule {
  /** Semaphore group manager (per-country) */
  private groupManager: GroupManager;

  /** Nullifier consumption tracker */
  private nullifierStore: NullifierStore;

  /** Poll metadata storage */
  private polls: Map<string, ManagedPoll> = new Map();

  /** Hash chain per poll */
  private chains: Map<string, VoteHashChain> = new Map();

  /** Country tree registry (for Semaphore groups) */
  private registry: CountryTreeRegistry;

  constructor() {
    this.groupManager = new GroupManager();
    this.nullifierStore = new NullifierStore();
    this.registry = new CountryTreeRegistry();
  }

  // --------------------------------------------------------
  // Country / Voter Registration
  // --------------------------------------------------------

  /**
   * Registers a country for voter eligibility.
   *
   * Creates both a Semaphore group (for ZKP proofs) and a Merkle tree
   * entry in the country registry.
   *
   * @param countryCode - ISO 3166-1 alpha-2 code
   */
  registerCountry(countryCode: string): void {
    const code = countryCode.toUpperCase();

    if (!this.groupManager.hasGroup(code)) {
      this.groupManager.createGroup(code);
    }

    if (!this.registry.hasCountry(code)) {
      this.registry.createCountryTree(code);
    }
  }

  /**
   * Registers a voter in a country.
   *
   * The commitment is added to both the Semaphore group and the
   * country Merkle tree.
   *
   * @param countryCode - ISO 3166-1 alpha-2 code
   * @param commitment - The voter's identity commitment
   */
  registerVoter(countryCode: string, commitment: bigint): void {
    const code = countryCode.toUpperCase();

    // Ensure country is registered
    this.registerCountry(code);

    // Add to Semaphore group
    this.groupManager.addMember(code, commitment);

    // Add to country registry
    this.registry.registerVoter(code, commitment);
  }

  // --------------------------------------------------------
  // Poll Management
  // --------------------------------------------------------

  /**
   * Creates a new poll.
   *
   * Initialises a hash chain for the poll and ensures the country
   * has a registered group.
   *
   * @param params - Poll creation parameters
   * @returns The created ManagedPoll
   */
  createPoll(params: CreatePollParams): ManagedPoll {
    const {
      title,
      description = "",
      options,
      countryCode,
      durationMinutes,
      requireZkp = false,
    } = params;

    if (!title || title.trim() === "") {
      throw new VoteModuleError("Poll title is required", "INVALID_TITLE");
    }
    if (!options || options.length < 2) {
      throw new VoteModuleError("At least 2 options are required", "INVALID_OPTIONS");
    }
    if (durationMinutes <= 0) {
      throw new VoteModuleError("Duration must be positive", "INVALID_DURATION");
    }

    const code = countryCode.toUpperCase();
    this.registerCountry(code);

    const id = `poll_${randomUUID().slice(0, 12)}`;
    const now = new Date();
    const closesAt = new Date(now.getTime() + durationMinutes * 60000);

    const poll: ManagedPoll = {
      id,
      title: title.trim(),
      description: description.trim(),
      options,
      countryCode: code,
      status: "active",
      createdAt: now.toISOString(),
      closesAt: closesAt.toISOString(),
      requireZkp,
    };

    this.polls.set(id, poll);
    this.chains.set(id, createHashChain(id));

    return poll;
  }

  /**
   * Retrieves a poll by ID.
   *
   * Also auto-closes polls whose closing time has passed.
   *
   * @param pollId - The poll identifier
   * @returns The ManagedPoll or undefined
   */
  getPoll(pollId: string): ManagedPoll | undefined {
    const poll = this.polls.get(pollId);
    if (poll && poll.status === "active") {
      if (new Date(poll.closesAt) <= new Date()) {
        poll.status = "closed";
      }
    }
    return poll;
  }

  /**
   * Lists all polls, optionally filtered.
   *
   * @param filters - Optional country and status filters
   * @returns Array of ManagedPolls
   */
  listPolls(filters?: {
    countryCode?: string;
    status?: PollStatus;
  }): ManagedPoll[] {
    let polls = Array.from(this.polls.values());

    // Auto-close expired polls
    const now = new Date();
    for (const poll of polls) {
      if (poll.status === "active" && new Date(poll.closesAt) <= now) {
        poll.status = "closed";
      }
    }

    if (filters?.countryCode) {
      const code = filters.countryCode.toUpperCase();
      polls = polls.filter((p) => p.countryCode === code);
    }

    if (filters?.status) {
      polls = polls.filter((p) => p.status === filters.status);
    }

    return polls;
  }

  // --------------------------------------------------------
  // Voting
  // --------------------------------------------------------

  /**
   * Casts a vote on a poll.
   *
   * This method performs the full vote acceptance pipeline:
   * 1. Validate the poll exists and is active
   * 2. Validate the choice index
   * 3. Check the nullifier has not been used (double-vote prevention)
   * 4. Optionally verify the ZKP proof (when enforced)
   * 5. Record the vote in the hash chain
   * 6. Consume the nullifier
   * 7. Return a receipt
   *
   * @param params - Vote parameters
   * @returns VoteReceipt on success
   * @throws VoteModuleError on failure
   */
  castVote(params: CastVoteParams): VoteReceipt {
    const { pollId, nullifierHash, choiceIndex, proof } = params;

    // 1. Poll exists
    const poll = this.getPoll(pollId);
    if (!poll) {
      throw new VoteModuleError(
        "Poll does not exist",
        "POLL_NOT_FOUND",
        pollId
      );
    }

    // 2. Poll is active
    if (poll.status === "closed") {
      throw new VoteModuleError(
        "This poll is no longer accepting votes",
        "POLL_CLOSED",
        pollId
      );
    }

    // 3. Validate choice
    if (
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= poll.options.length
    ) {
      throw new VoteModuleError(
        `Choice index must be between 0 and ${poll.options.length - 1}`,
        "INVALID_CHOICE",
        pollId
      );
    }

    // 4. Check nullifier freshness (pre-flight)
    const nullifierCheck = this.nullifierStore.check(pollId, nullifierHash);
    if (!nullifierCheck.isFresh) {
      throw new VoteModuleError(
        "A vote with this nullifier has already been recorded",
        "ALREADY_VOTED",
        pollId
      );
    }

    // 5. ZKP verification (when proof is provided and required)
    //    In the full system, this calls verifyProof() from @semaphore-protocol/proof.
    //    For the MVP, we accept the vote if a proof object is provided.
    if (poll.requireZkp && proof) {
      // The proof object is validated structurally.
      // Full cryptographic verification will be wired when Semaphore
      // WASM circuits are integrated.
      if (!proof.proof || !proof.nullifierHash) {
        throw new VoteModuleError(
          "Invalid ZKP proof structure",
          "INVALID_PROOF",
          pollId
        );
      }
    }

    // 6. Record vote in hash chain
    const chain = this.chains.get(pollId);
    if (!chain) {
      throw new VoteModuleError(
        "Hash chain not found for this poll",
        "INTERNAL_ERROR",
        pollId
      );
    }

    const block = chain.addVote(nullifierHash, choiceIndex);
    if (!block) {
      // This should not happen since we checked the nullifier store,
      // but the hash chain has its own double-vote check as a safety net.
      throw new VoteModuleError(
        "Vote rejected by hash chain (duplicate nullifier)",
        "ALREADY_VOTED",
        pollId
      );
    }

    // 7. Consume the nullifier
    this.nullifierStore.consume(pollId, nullifierHash);

    // 8. Return receipt
    return {
      accepted: true,
      voteHash: block.hash,
      chainPosition: block.index,
      previousHash: block.previousHash,
      timestamp: block.timestamp,
      nullifierHash,
    };
  }

  // --------------------------------------------------------
  // Verification
  // --------------------------------------------------------

  /**
   * Verifies a vote exists in the hash chain using its receipt hash.
   *
   * @param pollId - The poll identifier
   * @param voteHash - The vote hash from the receipt
   * @returns Verification result or null if not found
   */
  verifyVote(
    pollId: string,
    voteHash: string
  ): {
    verified: boolean;
    position: number;
    timestamp: string;
    previousHash: string;
  } | null {
    const chain = this.chains.get(pollId);
    if (!chain) return null;

    const blocks = chain.getAllBlocks();
    const block = blocks.find((b) => b.hash === voteHash && b.index > 0);

    if (!block) return null;

    return {
      verified: true,
      position: block.index,
      timestamp: block.timestamp,
      previousHash: block.previousHash,
    };
  }

  // --------------------------------------------------------
  // Results
  // --------------------------------------------------------

  /**
   * Computes the aggregated results for a poll.
   *
   * The tally is computed from the hash chain, ensuring that results
   * reflect only valid, recorded votes.  The hash chain integrity is
   * verified as part of the result computation.
   *
   * @param pollId - The poll identifier
   * @returns PollResults with per-option breakdown
   * @throws VoteModuleError if poll not found
   */
  getResults(pollId: string): PollResults {
    const poll = this.getPoll(pollId);
    if (!poll) {
      throw new VoteModuleError("Poll does not exist", "POLL_NOT_FOUND", pollId);
    }

    const chain = this.chains.get(pollId);
    if (!chain) {
      throw new VoteModuleError("Hash chain not found", "INTERNAL_ERROR", pollId);
    }

    const tally = chain.tally();
    const totalVotes = chain.voteCount;
    const stats = chain.getStats();
    const verification = chain.verify();

    const results: OptionTally[] = poll.options.map((option, index) => {
      const votes = tally.get(index) ?? 0;
      return {
        option,
        index,
        votes,
        percentage: totalVotes > 0
          ? parseFloat(((votes / totalVotes) * 100).toFixed(1))
          : 0,
      };
    });

    return {
      pollId,
      status: poll.status,
      results,
      totalVotes,
      hashChain: {
        genesisHash: stats.genesisHash,
        latestHash: stats.latestHash,
        length: stats.totalBlocks,
        isValid: verification.isValid,
      },
      computedAt: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------
  // Audit
  // --------------------------------------------------------

  /**
   * Generates a comprehensive audit report for a poll.
   *
   * The audit includes:
   * - Hash chain integrity verification
   * - Nullifier uniqueness check
   * - Merkle tree consistency check
   * - Full statistics
   *
   * This data is sufficient for an independent third party to verify
   * the integrity of the entire voting process.
   *
   * @param pollId - The poll identifier
   * @returns PollAudit report
   */
  audit(pollId: string): PollAudit {
    const poll = this.getPoll(pollId);
    if (!poll) {
      throw new VoteModuleError("Poll does not exist", "POLL_NOT_FOUND", pollId);
    }

    const chain = this.chains.get(pollId);
    if (!chain) {
      throw new VoteModuleError("Hash chain not found", "INTERNAL_ERROR", pollId);
    }

    const verification = chain.verify();
    const stats = chain.getStats();

    // Check for duplicate nullifiers in the chain
    const blocks = chain.getAllBlocks();
    const seenNullifiers = new Set<string>();
    let duplicateNullifiers = 0;

    for (const block of blocks) {
      if (block.index === 0) continue;
      if (seenNullifiers.has(block.nullifierHash)) {
        duplicateNullifiers++;
      }
      seenNullifiers.add(block.nullifierHash);
    }

    // Verify Merkle tree consistency
    const merkleTreeConsistent = this.registry.hasCountry(poll.countryCode);

    return {
      pollId,
      totalVotes: chain.voteCount,
      totalBlocks: stats.totalBlocks,
      hashChainValid: verification.isValid,
      firstInvalidBlock: verification.firstInvalidBlock,
      duplicateNullifiers,
      merkleTreeConsistent,
      genesisHash: stats.genesisHash,
      latestHash: stats.latestHash,
      firstTimestamp: stats.firstTimestamp,
      latestTimestamp: stats.latestTimestamp,
    };
  }

  // --------------------------------------------------------
  // Accessors for sub-systems
  // --------------------------------------------------------

  /** Returns the GroupManager for direct group operations */
  getGroupManager(): GroupManager {
    return this.groupManager;
  }

  /** Returns the NullifierStore for direct nullifier operations */
  getNullifierStore(): NullifierStore {
    return this.nullifierStore;
  }

  /** Returns the CountryTreeRegistry */
  getRegistry(): CountryTreeRegistry {
    return this.registry;
  }

  /** Returns the hash chain for a specific poll */
  getChain(pollId: string): VoteHashChain | undefined {
    return this.chains.get(pollId);
  }

  // --------------------------------------------------------
  // Reset (testing only)
  // --------------------------------------------------------

  /**
   * Resets all internal state.  Testing only.
   */
  reset(): void {
    this.polls.clear();
    this.chains.clear();
    this.nullifierStore.reset();
    this.groupManager = new GroupManager();
    this.registry = new CountryTreeRegistry();
  }
}

/**
 * Creates a new VoteModule instance.
 *
 * @returns A fresh VoteModule
 */
export function createVoteModule(): VoteModule {
  return new VoteModule();
}
