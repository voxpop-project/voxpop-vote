/**
 * VoxPop Secure Voting Module
 *
 * Privacy-preserving democratic voting using Zero-Knowledge Proofs.
 *
 * @packageDocumentation
 * @license AGPL-3.0-or-later
 * @see https://github.com/voxpop-project/voxpop-vote
 */

// ============================================================
// Core ZKP voting primitives (Semaphore integration)
// ============================================================

export {
  createVoterIdentity,
  restoreVoterIdentity,
  generateVoteProof,
  verifyVoteProof,
  createVoteConfig,
  GroupManager,
} from "./core/semaphore-integration";

export type {
  VoterIdentity,
  VoteProof,
  VoteConfig,
  VerificationResult,
} from "./core/semaphore-integration";

// ============================================================
// Per-country Merkle Tree management
// ============================================================

export {
  MerkleTree,
  CountryTreeRegistry,
  createTreeRegistry,
  merkleHash,
} from "./core/merkle-tree";

export type {
  MerkleProof,
  CountryTree,
  TreeRegistryStats,
  RegistrationResult,
} from "./core/merkle-tree";

// ============================================================
// Hash chain (vote integrity)
// ============================================================

export {
  VoteHashChain,
  createHashChain,
  computeBlockHash,
} from "./core/hash-chain";

export type {
  VoteBlock,
  ChainVerificationResult,
  ChainStats,
} from "./core/hash-chain";

// ============================================================
// Nullifier system (double-vote prevention)
// ============================================================

export {
  generateNullifier,
  generateExternalNullifier,
  verifyNullifier,
  NullifierStore,
  createNullifierStore,
} from "./core/nullifier";

export type {
  NullifierRecord,
  NullifierCheckResult,
  NullifierStats,
} from "./core/nullifier";

// ============================================================
// Vote Module (main orchestrator)
// ============================================================

export {
  VoteModule,
  createVoteModule,
  VoteModuleError,
} from "./core/vote-module";

export type {
  ManagedPoll,
  CreatePollParams as VoteModuleCreatePollParams,
  CastVoteParams,
  VoteReceipt,
  OptionTally,
  PollResults,
  PollAudit,
} from "./core/vote-module";

// ============================================================
// Utility: Generic hash chain
// ============================================================

export {
  HashChain,
  createChain,
  sha256,
  sha256Buffer,
  doubleSha256,
} from "./utils/hash-chain";

export type {
  ChainEntry,
  HashChainVerification,
} from "./utils/hash-chain";

// ============================================================
// Shared type definitions
// ============================================================

export type {
  Poll,
  PollSettings,
  PollStatus,
  Vote,
  SemaphoreProofData,
  ProofVerificationResult,
  MerkleProof as MerkleProofType,
  MerkleTreeSnapshot,
  HashChainBlock,
  ChainVerificationResult as SharedChainVerificationResult,
  NullifierRecord as SharedNullifierRecord,
  OptionResult,
  VoteResult,
  AuditReport,
  VoxPopConfig,
  VoterIdentityExport,
} from "./types";

export { DEFAULT_CONFIG } from "./types";
