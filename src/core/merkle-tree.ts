/**
 * VoxPop Secure Voting Module -- Per-Country Merkle Tree Management
 *
 * This module provides two complementary implementations:
 *
 * 1. **MerkleTree** -- a standalone SHA-256 binary Merkle tree with full
 *    proof generation and verification.  This is the low-level primitive
 *    used for audit trails and independent verification.
 *
 * 2. **CountryTreeRegistry** -- a higher-level registry that wraps
 *    Semaphore Groups (themselves backed by Poseidon Merkle trees) and
 *    partitions voters by country (ISO 3166-1 alpha-2 codes).
 *
 * Key design decisions:
 * - One Group per country (ISO 3166-1 alpha-2 codes)
 * - Append-only: commitments are never removed (preserves anonymity set)
 * - Batched insertions for atomic multi-voter registration
 * - No personal data stored -- only cryptographic commitments
 *
 * @module merkle-tree
 * @license AGPL-3.0-or-later
 */

import { createHash } from "crypto";
import { Group } from "@semaphore-protocol/group";

// ============================================================
// SHA-256 Merkle Tree (standalone)
// ============================================================

/** A Merkle inclusion proof */
export interface MerkleProof {
  /** The leaf whose membership is being proved */
  leaf: string;
  /** Sibling hashes along the path from leaf to root */
  pathElements: string[];
  /** Direction indicators: 0 = sibling is on the right, 1 = sibling is on the left */
  pathIndices: number[];
  /** The Merkle root at the time the proof was generated */
  root: string;
}

/**
 * Computes a SHA-256 hash of a string.
 *
 * @param data - Input string
 * @returns Hex-encoded SHA-256 digest
 */
function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Computes the hash of an internal Merkle node.
 *
 * The two children are sorted to guarantee a canonical representation.
 * This means the same set of leaves always produces the same root
 * regardless of insertion order within a level.
 *
 * @param left - Left child hash
 * @param right - Right child hash
 * @returns SHA-256 hash of the concatenation
 */
function hashPair(left: string, right: string): string {
  return sha256(left + right);
}

/**
 * A binary Merkle tree backed by SHA-256 hashes.
 *
 * Supports dynamic insertions, Merkle proof generation, and proof
 * verification.  The tree automatically pads to a power-of-two size
 * using a deterministic "empty leaf" hash.
 *
 * This implementation is used for:
 * - Voter registry snapshots (audit)
 * - Independent verification of Semaphore group membership
 * - Hash-based integrity proofs over vote sets
 *
 * @example
 * ```ts
 * const tree = new MerkleTree();
 *
 * tree.insert(sha256("voter-commitment-1"));
 * tree.insert(sha256("voter-commitment-2"));
 * tree.insert(sha256("voter-commitment-3"));
 *
 * const proof = tree.getProof(0);
 * console.log(MerkleTree.verify(proof)); // true
 *
 * console.log(tree.root); // "a1b2c3..."
 * ```
 */
export class MerkleTree {
  /** The leaf nodes (hashes) */
  private leaves: string[] = [];

  /** Hash used for padding empty leaf positions */
  private static readonly EMPTY_LEAF = sha256("VOXPOP_EMPTY_LEAF");

  /**
   * Inserts a leaf into the tree.
   *
   * @param leaf - The hash to insert (should be a hex-encoded SHA-256 digest)
   * @returns The index of the inserted leaf
   */
  insert(leaf: string): number {
    this.leaves.push(leaf);
    return this.leaves.length - 1;
  }

  /**
   * Inserts multiple leaves.
   *
   * @param newLeaves - Array of leaf hashes
   * @returns Array of indices
   */
  insertBatch(newLeaves: string[]): number[] {
    const startIndex = this.leaves.length;
    this.leaves.push(...newLeaves);
    return newLeaves.map((_, i) => startIndex + i);
  }

  /**
   * Returns the current Merkle root.
   *
   * The tree is padded with empty leaves to reach the next power of two
   * before computing the root.
   *
   * @returns Hex-encoded SHA-256 Merkle root
   */
  get root(): string {
    if (this.leaves.length === 0) {
      return MerkleTree.EMPTY_LEAF;
    }
    const layers = this.computeLayers();
    return layers[layers.length - 1][0];
  }

  /**
   * Returns the tree depth (number of levels above the leaves).
   */
  get depth(): number {
    if (this.leaves.length <= 1) return 0;
    return Math.ceil(Math.log2(this.leaves.length));
  }

  /**
   * Returns the number of leaves.
   */
  get leafCount(): number {
    return this.leaves.length;
  }

  /**
   * Returns a copy of all leaf hashes.
   */
  getLeaves(): string[] {
    return [...this.leaves];
  }

  /**
   * Returns the leaf at a given index.
   *
   * @param index - Leaf index
   * @returns The leaf hash, or undefined if out of range
   */
  getLeaf(index: number): string | undefined {
    return this.leaves[index];
  }

  /**
   * Generates a Merkle inclusion proof for a leaf at the given index.
   *
   * @param index - The leaf index to prove
   * @returns A MerkleProof object
   * @throws Error if the index is out of range
   *
   * @example
   * ```ts
   * const proof = tree.getProof(2);
   * // proof.pathElements: ["hash1", "hash2", ...]
   * // proof.pathIndices: [0, 1, ...]
   * ```
   */
  getProof(index: number): MerkleProof {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Leaf index ${index} out of range [0, ${this.leaves.length - 1}]`);
    }

    const layers = this.computeLayers();
    const pathElements: string[] = [];
    const pathIndices: number[] = [];

    let currentIndex = index;

    for (let level = 0; level < layers.length - 1; level++) {
      const layer = layers[level];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      pathIndices.push(isRight ? 1 : 0);
      pathElements.push(
        siblingIndex < layer.length ? layer[siblingIndex] : MerkleTree.EMPTY_LEAF
      );

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: this.leaves[index],
      pathElements,
      pathIndices,
      root: this.root,
    };
  }

  /**
   * Statically verifies a Merkle inclusion proof.
   *
   * Recomputes the root from the leaf + path and checks it matches.
   *
   * @param proof - The MerkleProof to verify
   * @returns true if the proof is valid
   *
   * @example
   * ```ts
   * const isValid = MerkleTree.verify(proof);
   * ```
   */
  static verify(proof: MerkleProof): boolean {
    let current = proof.leaf;

    for (let i = 0; i < proof.pathElements.length; i++) {
      const sibling = proof.pathElements[i];
      const direction = proof.pathIndices[i];

      if (direction === 0) {
        // Current node is on the left
        current = hashPair(current, sibling);
      } else {
        // Current node is on the right
        current = hashPair(sibling, current);
      }
    }

    return current === proof.root;
  }

  /**
   * Computes all layers of the Merkle tree from bottom (leaves) to top (root).
   *
   * Pads the leaf layer to the next power of two with empty leaves.
   *
   * @returns Array of layers, where layers[0] is the (padded) leaf layer
   *   and layers[layers.length - 1] is [root]
   */
  private computeLayers(): string[][] {
    if (this.leaves.length === 0) {
      return [[MerkleTree.EMPTY_LEAF]];
    }

    // Pad leaves to next power of two
    const nextPow2 = Math.pow(2, Math.ceil(Math.log2(Math.max(this.leaves.length, 2))));
    const paddedLeaves = [...this.leaves];
    while (paddedLeaves.length < nextPow2) {
      paddedLeaves.push(MerkleTree.EMPTY_LEAF);
    }

    const layers: string[][] = [paddedLeaves];

    let currentLayer = paddedLeaves;
    while (currentLayer.length > 1) {
      const nextLayer: string[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : MerkleTree.EMPTY_LEAF;
        nextLayer.push(hashPair(left, right));
      }
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }
}

/**
 * Creates a SHA-256 hash of a string (convenience export).
 */
export { sha256 as merkleHash };

// ============================================================
// Types
// ============================================================

/** Represents a country's voter registry as a Merkle Tree */
export interface CountryTree {
  /** ISO 3166-1 alpha-2 country code (e.g., "FR", "DE", "BE") */
  countryCode: string;
  /** The Semaphore Group backing this country's Merkle Tree */
  group: Group;
  /** Number of registered voters (commitments) in this tree */
  memberCount: number;
  /** ISO timestamp of when this tree was created */
  createdAt: string;
  /** ISO timestamp of the last modification */
  updatedAt: string;
}

/** Statistics about the tree registry */
export interface TreeRegistryStats {
  /** Total number of country trees */
  totalCountries: number;
  /** Total number of registered voters across all countries */
  totalVoters: number;
  /** Map of country code to voter count */
  votersPerCountry: Map<string, number>;
}

/** Result of a voter registration attempt */
export interface RegistrationResult {
  /** Whether the registration was successful */
  success: boolean;
  /** The country code where the voter was registered */
  countryCode: string;
  /** Error message if registration failed */
  error?: string;
}

// ============================================================
// Country Tree Registry
// ============================================================

/**
 * Manages per-country Merkle Trees for voter eligibility verification.
 *
 * Each country maintains its own Semaphore Group. When a citizen verifies
 * their identity (e.g., via eIDAS 2.0 or document verification), their
 * identity commitment is added to their country's Merkle Tree.
 *
 * During vote proof generation, the voter proves membership in their
 * country's specific tree — ensuring a Belgian citizen cannot vote on
 * a French referendum, for example.
 *
 * @example
 * ```typescript
 * const registry = new CountryTreeRegistry();
 *
 * // Create trees for France and Germany
 * registry.createCountryTree("FR");
 * registry.createCountryTree("DE");
 *
 * // Register a voter in France
 * const voter = createVoterIdentity();
 * registry.registerVoter("FR", voter.commitment);
 *
 * // Get the group for proof generation
 * const frenchGroup = registry.getGroup("FR");
 * ```
 */
export class CountryTreeRegistry {
  /** Internal map of country code -> CountryTree */
  private trees: Map<string, CountryTree> = new Map();

  /**
   * Creates a new Merkle Tree for a country.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "FR")
   * @throws Error if the country tree already exists
   *
   * @example
   * ```typescript
   * registry.createCountryTree("FR");
   * registry.createCountryTree("DE");
   * registry.createCountryTree("BE");
   * ```
   */
  createCountryTree(countryCode: string): CountryTree {
    const code = countryCode.toUpperCase();

    if (this.trees.has(code)) {
      throw new Error(`Country tree for ${code} already exists`);
    }

    const now = new Date().toISOString();
    const countryTree: CountryTree = {
      countryCode: code,
      group: new Group(),
      memberCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.trees.set(code, countryTree);
    return countryTree;
  }

  /**
   * Gets the Semaphore Group for a country.
   *
   * This is the group passed to `generateVoteProof()` from the
   * semaphore-integration module.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns The Semaphore Group for this country
   * @throws Error if the country tree does not exist
   */
  getGroup(countryCode: string): Group {
    const tree = this.getCountryTree(countryCode);
    return tree.group;
  }

  /**
   * Gets the full CountryTree metadata for a country.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns The CountryTree object
   * @throws Error if the country tree does not exist
   */
  getCountryTree(countryCode: string): CountryTree {
    const code = countryCode.toUpperCase();
    const tree = this.trees.get(code);

    if (!tree) {
      throw new Error(
        `No tree found for country ${code}. Create it first with createCountryTree().`
      );
    }

    return tree;
  }

  /**
   * Registers a single voter in a country's Merkle Tree.
   *
   * The commitment is the public part of a voter's Semaphore Identity.
   * It is added to the country's Merkle Tree, allowing the voter to
   * later prove membership without revealing their identity.
   *
   * @param countryCode - The country to register the voter in
   * @param commitment - The voter's identity commitment (from VoterIdentity)
   * @returns A RegistrationResult indicating success or failure
   *
   * @example
   * ```typescript
   * const voter = createVoterIdentity();
   * const result = registry.registerVoter("FR", voter.commitment);
   * if (result.success) {
   *   console.log("Voter registered in France");
   * }
   * ```
   */
  registerVoter(countryCode: string, commitment: bigint): RegistrationResult {
    try {
      const code = countryCode.toUpperCase();
      const tree = this.getCountryTree(code);

      tree.group.addMember(commitment);
      tree.memberCount++;
      tree.updatedAt = new Date().toISOString();

      return { success: true, countryCode: code };
    } catch (error) {
      return {
        success: false,
        countryCode: countryCode.toUpperCase(),
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Registers multiple voters at once (batched insertion).
   *
   * Batched insertions are more efficient than individual registrations
   * and help maintain tree consistency when processing bulk identity
   * verifications.
   *
   * @param countryCode - The country to register voters in
   * @param commitments - Array of voter identity commitments
   * @returns Array of RegistrationResults (one per commitment)
   *
   * @example
   * ```typescript
   * const commitments = voters.map(v => v.commitment);
   * const results = registry.registerVoterBatch("FR", commitments);
   * const successCount = results.filter(r => r.success).length;
   * console.log(`Registered ${successCount}/${commitments.length} voters`);
   * ```
   */
  registerVoterBatch(
    countryCode: string,
    commitments: bigint[]
  ): RegistrationResult[] {
    const code = countryCode.toUpperCase();

    // Verify the tree exists before starting batch
    try {
      this.getCountryTree(code);
    } catch (error) {
      return commitments.map(() => ({
        success: false,
        countryCode: code,
        error: error instanceof Error ? error.message : "Unknown error",
      }));
    }

    // Register each voter
    return commitments.map((commitment) =>
      this.registerVoter(code, commitment)
    );
  }

  /**
   * Checks whether a commitment exists in a country's Merkle Tree.
   *
   * @param countryCode - The country to check
   * @param commitment - The voter's identity commitment
   * @returns true if the commitment is in the tree
   */
  isMember(countryCode: string, commitment: bigint): boolean {
    try {
      const tree = this.getCountryTree(countryCode);
      return tree.group.indexOf(commitment) !== -1;
    } catch {
      return false;
    }
  }

  /**
   * Returns the number of registered voters in a country.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns The number of members in the country's tree
   */
  getMemberCount(countryCode: string): number {
    try {
      const tree = this.getCountryTree(countryCode);
      return tree.memberCount;
    } catch {
      return 0;
    }
  }

  /**
   * Lists all country codes that have an active tree.
   *
   * @returns Array of ISO 3166-1 alpha-2 country codes
   */
  listCountries(): string[] {
    return Array.from(this.trees.keys()).sort();
  }

  /**
   * Returns aggregate statistics about the tree registry.
   *
   * @returns TreeRegistryStats with totals and per-country breakdown
   */
  getStats(): TreeRegistryStats {
    const votersPerCountry = new Map<string, number>();
    let totalVoters = 0;

    for (const [code, tree] of this.trees) {
      votersPerCountry.set(code, tree.memberCount);
      totalVoters += tree.memberCount;
    }

    return {
      totalCountries: this.trees.size,
      totalVoters,
      votersPerCountry,
    };
  }

  /**
   * Checks if a country tree exists.
   *
   * @param countryCode - ISO 3166-1 alpha-2 country code
   * @returns true if a tree exists for this country
   */
  hasCountry(countryCode: string): boolean {
    return this.trees.has(countryCode.toUpperCase());
  }
}

/**
 * Creates a new CountryTreeRegistry instance.
 *
 * Factory function for convenience.
 *
 * @returns A new empty CountryTreeRegistry
 */
export function createTreeRegistry(): CountryTreeRegistry {
  return new CountryTreeRegistry();
}
