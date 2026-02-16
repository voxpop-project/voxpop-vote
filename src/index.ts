/**
 * VoxPop Secure Voting Module
 *
 * Privacy-preserving democratic voting using Zero-Knowledge Proofs.
 *
 * @packageDocumentation
 * @license AGPL-3.0-or-later
 * @see https://github.com/voxpop-project/voxpop-vote
 */

// Core ZKP voting primitives
export {
  createVoterIdentity,
  restoreVoterIdentity,
  generateVoteProof,
  verifyVoteProof,
  createVoteConfig,
} from "./core/semaphore-integration";

export type {
  VoterIdentity,
  VoteProof,
  VoteConfig,
  VerificationResult,
} from "./core/semaphore-integration";

// Per-country Merkle Tree management
export {
  CountryTreeRegistry,
  createTreeRegistry,
} from "./core/merkle-tree";

export type {
  CountryTree,
  TreeRegistryStats,
  RegistrationResult,
} from "./core/merkle-tree";
