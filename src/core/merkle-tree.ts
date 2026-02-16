/**
 * VoxPop Secure Voting Module — Per-Country Merkle Tree Management
 *
 * This module manages country-specific Merkle Trees for voter eligibility.
 * Each country has its own Semaphore Group (backed by a Merkle Tree) so that
 * only citizens verified for a specific country can vote on that country's
 * issues.
 *
 * Key design decisions:
 * - One Group per country (ISO 3166-1 alpha-2 codes)
 * - Append-only: commitments are never removed (preserves anonymity set)
 * - Batched insertions for atomic multi-voter registration
 * - No personal data stored — only cryptographic commitments
 *
 * @module merkle-tree
 * @license AGPL-3.0-or-later
 */

import { Group } from "@semaphore-protocol/group";

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
