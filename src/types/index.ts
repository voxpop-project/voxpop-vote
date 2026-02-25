/**
 * VoxPop Secure Voting Module -- Core Type Definitions
 *
 * Centralised TypeScript interfaces used across the entire voting system.
 * Every module imports its types from here to guarantee a single source of
 * truth and consistent serialisation across API boundaries.
 *
 * @module types
 * @license AGPL-3.0-or-later
 */

// ============================================================
// Voter Identity
// ============================================================

/**
 * A voter's anonymous Semaphore identity.
 *
 * The `commitment` is the only value ever stored on-chain or in a Merkle
 * tree.  The `trapdoor` and `nullifier` values are secrets that remain
 * exclusively on the voter's device.
 */
export interface VoterIdentity {
  /** Hex-encoded private trapdoor (kept secret by the voter) */
  trapdoor: bigint;
  /** Hex-encoded private nullifier secret (kept secret by the voter) */
  nullifierSecret: bigint;
  /**
   * Public identity commitment = Poseidon(nullifierSecret, trapdoor).
   * This is the value added to the country Merkle tree.
   */
  commitment: bigint;
}

/**
 * Minimal portable representation of a voter identity for export/restore.
 * Contains only the private secrets -- the commitment is deterministically
 * re-derived.
 */
export interface VoterIdentityExport {
  /** Base64-encoded identity secret */
  secret: string;
  /** ISO 8601 timestamp of when the identity was created */
  createdAt: string;
}

// ============================================================
// Polls
// ============================================================

/** The lifecycle state of a poll. */
export type PollStatus = "upcoming" | "active" | "closed";

/**
 * Defines a voting session (poll / referendum / election).
 */
export interface Poll {
  /** Unique poll identifier (uuid or prefixed string) */
  id: string;
  /** Human-readable title */
  title: string;
  /** Longer description / question text */
  description: string;
  /** Available voting options (minimum 2) */
  options: string[];
  /** ISO 3166-1 alpha-2 country code -- determines which Merkle tree is used */
  countryCode: string;
  /** Current lifecycle state */
  status: PollStatus;
  /** ISO 8601 -- when the poll was created */
  createdAt: string;
  /** ISO 8601 -- when the poll stops accepting votes */
  closesAt: string;
  /** Poll behaviour settings */
  settings: PollSettings;
}

export interface PollSettings {
  /** Require voters to remain anonymous (always true for now) */
  anonymous: boolean;
  /** Require a valid Semaphore ZKP for each vote */
  requireZkp: boolean;
  /** Minimum number of voters for results to be revealed */
  minQuorum?: number;
}

/**
 * Parameters for creating a new poll.  Mirrors `Poll` but without
 * server-assigned fields (id, status, createdAt).
 */
export interface CreatePollParams {
  title: string;
  description?: string;
  options: string[];
  countryCode: string;
  /** Duration in minutes (used to derive closesAt) */
  durationMinutes: number;
  settings?: Partial<PollSettings>;
}

// ============================================================
// Votes
// ============================================================

/**
 * A single cast vote together with its ZKP.
 *
 * The proof demonstrates group membership without revealing identity.
 * The nullifier prevents the same voter from voting twice on the same poll.
 */
export interface Vote {
  /** The poll this vote belongs to */
  pollId: string;
  /** Zero-based index of the chosen option */
  choiceIndex: number;
  /** Deterministic nullifier hash = hash(identityNullifier, pollId) */
  nullifierHash: bigint;
  /** The attached zero-knowledge proof */
  proof: SemaphoreProofData;
  /** ISO 8601 timestamp of when the vote was cast (client-side) */
  timestamp: string;
}

// ============================================================
// Zero-Knowledge Proofs
// ============================================================

/**
 * Serialisable representation of a Semaphore ZK-SNARK proof.
 *
 * Maps directly to the output of `@semaphore-protocol/proof`'s
 * `generateProof()`.  All numeric values are serialised as strings
 * to avoid JSON precision loss.
 */
export interface SemaphoreProofData {
  /** Merkle tree root at the time the proof was generated */
  merkleTreeRoot: string;
  /** Depth of the Merkle tree */
  merkleTreeDepth: number;
  /** The scope used to derive the nullifier (typically the poll ID) */
  scope: string;
  /** The deterministic nullifier */
  nullifier: string;
  /** The vote signal (choice index encoded as bigint string) */
  message: string;
  /** The Groth16 proof points */
  points: string[];
}

/**
 * Result of verifying a zero-knowledge proof.
 */
export interface ProofVerificationResult {
  /** Whether the proof is cryptographically valid */
  isValid: boolean;
  /** The nullifier hash extracted from the proof */
  nullifierHash: bigint;
  /** Human-readable error if verification failed */
  error?: string;
}

// ============================================================
// Merkle Trees
// ============================================================

/**
 * A Merkle inclusion proof -- demonstrates that a leaf exists at a given
 * position in the tree without revealing the full tree.
 */
export interface MerkleProof {
  /** The leaf value being proved */
  leaf: string;
  /** Sibling hashes along the path from leaf to root */
  pathElements: string[];
  /** Binary path indices (0 = left child, 1 = right child) */
  pathIndices: number[];
  /** The Merkle root at the time the proof was generated */
  root: string;
}

/**
 * Snapshot of a country's Merkle tree for audit purposes.
 */
export interface MerkleTreeSnapshot {
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  /** Merkle root hash */
  root: string;
  /** Tree depth (log2 of capacity) */
  depth: number;
  /** Number of leaves (registered voters) */
  leafCount: number;
  /** ISO 8601 timestamp */
  snapshotAt: string;
}

// ============================================================
// Hash Chain (Vote Integrity)
// ============================================================

/**
 * A single block in the vote hash chain.
 *
 * Each block links to the previous one via `previousHash`, forming a
 * tamper-evident append-only ledger.
 */
export interface HashChainBlock {
  /** Sequential index (0 = genesis) */
  index: number;
  /** SHA-256 hash of the previous block */
  previousHash: string;
  /** SHA-256 hash of this block's content */
  hash: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** The poll this block belongs to */
  pollId: string;
  /** Nullifier hash of the voter (no identity leakage) */
  nullifierHash: string;
  /** Zero-based choice index (-1 for genesis) */
  choiceIndex: number;
}

/**
 * Result of verifying an entire hash chain.
 */
export interface ChainVerificationResult {
  /** Whether every block in the chain is valid */
  isValid: boolean;
  /** Total number of blocks checked */
  blocksChecked: number;
  /** Index of the first corrupted block (-1 if all valid) */
  firstInvalidBlock: number;
  /** Human-readable error description */
  error?: string;
}

// ============================================================
// Nullifiers
// ============================================================

/**
 * Entry in the nullifier store -- records that a specific nullifier has
 * been used for a specific poll.
 */
export interface NullifierRecord {
  /** The nullifier hash (hex string) */
  nullifierHash: string;
  /** The poll where this nullifier was consumed */
  pollId: string;
  /** ISO 8601 timestamp of when the nullifier was recorded */
  recordedAt: string;
}

// ============================================================
// Vote Results
// ============================================================

/**
 * Aggregated result for a single option in a poll.
 */
export interface OptionResult {
  /** The option label */
  option: string;
  /** Zero-based option index */
  index: number;
  /** Number of votes this option received */
  votes: number;
  /** Percentage of total votes (0-100, one decimal) */
  percentage: number;
}

/**
 * Full result set for a completed (or in-progress) poll.
 */
export interface VoteResult {
  /** The poll identifier */
  pollId: string;
  /** Current poll status */
  status: PollStatus;
  /** Per-option breakdown */
  results: OptionResult[];
  /** Total number of valid votes */
  totalVotes: number;
  /** Hash chain integrity summary */
  hashChain: {
    genesisHash: string;
    latestHash: string;
    length: number;
    isValid: boolean;
  };
  /** ISO 8601 -- when these results were computed */
  computedAt: string;
}

// ============================================================
// Audit
// ============================================================

/**
 * Comprehensive audit report for a poll, suitable for independent
 * third-party verification.
 */
export interface AuditReport {
  pollId: string;
  /** Total votes recorded in the hash chain */
  totalVotes: number;
  /** Total blocks (votes + genesis) */
  totalBlocks: number;
  /** Hash chain integrity check result */
  hashChainValid: boolean;
  /** Index of first corrupted block (-1 if clean) */
  firstInvalidBlock: number;
  /** Number of duplicate nullifiers detected (should be 0) */
  duplicateNullifiers: number;
  /** Whether the Merkle tree for the poll's country is consistent */
  merkleTreeConsistent: boolean;
  /** Genesis block hash */
  genesisHash: string;
  /** Latest block hash */
  latestHash: string;
  /** Timestamp range */
  firstTimestamp: string;
  latestTimestamp: string;
  /** Verification error message (null if clean) */
  verificationError: string | null;
}

// ============================================================
// Configuration
// ============================================================

/**
 * Runtime configuration for the VoxPop voting module.
 */
export interface VoxPopConfig {
  /** Merkle tree depth (determines max voters per country = 2^depth) */
  merkleTreeDepth: number;
  /** Hash algorithm for the hash chain */
  hashAlgorithm: "sha256";
  /** Whether to enforce full ZKP verification on vote submission */
  enforceZkp: boolean;
  /** Minimum number of group members before proofs can be generated */
  minGroupSize: number;
  /** Supported country codes */
  supportedCountries: string[];
}

/**
 * Sensible defaults for local development and testing.
 */
export const DEFAULT_CONFIG: VoxPopConfig = {
  merkleTreeDepth: 20, // supports ~1M voters per country
  hashAlgorithm: "sha256",
  enforceZkp: false, // disabled for MVP
  minGroupSize: 1,
  supportedCountries: [
    "FR", "DE", "BE", "NL", "LU", "IT", "ES", "PT",
    "AT", "CH", "IE", "EE", "LT", "LV", "FI", "SE",
    "DK", "NO", "PL", "CZ", "SK", "HU", "RO", "BG",
    "HR", "SI", "GR", "CY", "MT",
  ],
};
