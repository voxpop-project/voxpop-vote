/**
 * VoxPop API — In-Memory Store
 *
 * Provides in-memory storage for polls, vote chains, and voter registries.
 * This is the MVP store — will be replaced by PostgreSQL later.
 *
 * @module api/store
 * @license AGPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { VoteHashChain } from "../core/hash-chain";
import { CountryTreeRegistry } from "../core/merkle-tree";

// ============================================================
// Types
// ============================================================

export type PollStatus = "active" | "closed" | "upcoming";

export interface Poll {
  id: string;
  title: string;
  description: string;
  options: string[];
  countryCode: string;
  status: PollStatus;
  createdAt: string;
  closesAt: string;
  settings: {
    anonymous: boolean;
    requireZkp: boolean;
  };
}

export interface PollWithStats extends Poll {
  totalVotes: number;
}

// ============================================================
// Store
// ============================================================

/**
 * In-memory store for the VoxPop MVP.
 *
 * Holds polls, hash chains (one per poll), and the voter registry.
 * All data is lost on restart — this is intentional for the MVP.
 */
export class VoxPopStore {
  /** Poll data keyed by poll ID */
  private polls: Map<string, Poll> = new Map();

  /** Hash chain per poll (for vote integrity) */
  private chains: Map<string, VoteHashChain> = new Map();

  /** Global voter registry (per-country Merkle Trees) */
  readonly registry: CountryTreeRegistry;

  constructor() {
    this.registry = new CountryTreeRegistry();
  }

  // --------------------------------------------------------
  // Polls
  // --------------------------------------------------------

  createPoll(params: {
    title: string;
    description: string;
    options: string[];
    countryCode: string;
    closesAt: string;
    settings?: { anonymous?: boolean; requireZkp?: boolean };
  }): Poll {
    const id = `poll_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const closesAt = new Date(params.closesAt);

    const poll: Poll = {
      id,
      title: params.title,
      description: params.description,
      options: params.options,
      countryCode: params.countryCode.toUpperCase(),
      status: closesAt > new Date() ? "active" : "closed",
      createdAt: now,
      closesAt: params.closesAt,
      settings: {
        anonymous: params.settings?.anonymous ?? true,
        requireZkp: params.settings?.requireZkp ?? true,
      },
    };

    this.polls.set(id, poll);

    // Create hash chain for this poll
    const chain = new VoteHashChain(id);
    this.chains.set(id, chain);

    // Ensure country tree exists
    if (!this.registry.hasCountry(poll.countryCode)) {
      this.registry.createCountryTree(poll.countryCode);
    }

    return poll;
  }

  getPoll(id: string): Poll | undefined {
    const poll = this.polls.get(id);
    if (poll) {
      // Auto-update status based on time
      const now = new Date();
      if (poll.status === "active" && new Date(poll.closesAt) <= now) {
        poll.status = "closed";
      }
    }
    return poll;
  }

  listPolls(filters?: {
    country?: string;
    status?: PollStatus;
    page?: number;
    limit?: number;
  }): { polls: PollWithStats[]; total: number } {
    let polls = Array.from(this.polls.values());

    // Auto-update statuses
    const now = new Date();
    for (const poll of polls) {
      if (poll.status === "active" && new Date(poll.closesAt) <= now) {
        poll.status = "closed";
      }
    }

    // Filters
    if (filters?.country) {
      const code = filters.country.toUpperCase();
      polls = polls.filter((p) => p.countryCode === code);
    }
    if (filters?.status) {
      polls = polls.filter((p) => p.status === filters.status);
    }

    const total = polls.length;

    // Pagination
    const page = filters?.page ?? 1;
    const limit = Math.min(filters?.limit ?? 20, 100);
    const start = (page - 1) * limit;
    polls = polls.slice(start, start + limit);

    // Add vote counts
    const pollsWithStats: PollWithStats[] = polls.map((poll) => ({
      ...poll,
      totalVotes: this.getChain(poll.id)?.voteCount ?? 0,
    }));

    return { polls: pollsWithStats, total };
  }

  // --------------------------------------------------------
  // Chains
  // --------------------------------------------------------

  getChain(pollId: string): VoteHashChain | undefined {
    return this.chains.get(pollId);
  }

  // --------------------------------------------------------
  // Reset (for testing)
  // --------------------------------------------------------

  reset(): void {
    this.polls.clear();
    this.chains.clear();
  }
}

/** Singleton store instance */
let storeInstance: VoxPopStore | null = null;

/**
 * Gets the global store instance (singleton).
 */
export function getStore(): VoxPopStore {
  if (!storeInstance) {
    storeInstance = new VoxPopStore();
  }
  return storeInstance;
}

/**
 * Creates a fresh store (for testing).
 */
export function createStore(): VoxPopStore {
  return new VoxPopStore();
}
