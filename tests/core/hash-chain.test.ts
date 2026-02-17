/**
 * Tests for the VoteHashChain module
 *
 * Covers:
 * - Genesis block creation
 * - Vote addition
 * - Double-vote prevention (nullifier reuse)
 * - Chain integrity verification
 * - Tampering detection
 * - Vote tallying
 * - Chain export/import (audit)
 * - Edge cases
 */

import {
  VoteHashChain,
  createHashChain,
  computeBlockHash,
  VoteBlock,
} from "../../src/core/hash-chain";

// ============================================================
// Genesis Block Tests
// ============================================================

describe("Genesis Block", () => {
  it("should create a chain with a genesis block", () => {
    const chain = new VoteHashChain("poll-001");

    expect(chain.length).toBe(1);
    expect(chain.voteCount).toBe(0);
    expect(chain.pollId).toBe("poll-001");

    const genesis = chain.getBlock(0);
    expect(genesis).toBeDefined();
    expect(genesis!.index).toBe(0);
    expect(genesis!.previousHash).toBe(
      "0000000000000000000000000000000000000000000000000000000000000000"
    );
    expect(genesis!.pollId).toBe("GENESIS");
    expect(genesis!.choiceIndex).toBe(-1);
    expect(genesis!.nullifierHash).toBe("0");
  });

  it("should produce a valid SHA-256 hash for genesis", () => {
    const chain = new VoteHashChain("poll-002");
    const genesis = chain.getBlock(0)!;

    // SHA-256 produces 64 hex characters
    expect(genesis.hash).toMatch(/^[a-f0-9]{64}$/);

    // Recompute and verify
    const recomputed = computeBlockHash(
      genesis.index,
      genesis.previousHash,
      genesis.timestamp,
      genesis.pollId,
      genesis.nullifierHash,
      genesis.choiceIndex
    );
    expect(genesis.hash).toBe(recomputed);
  });

  it("should throw on empty poll ID", () => {
    expect(() => new VoteHashChain("")).toThrow("Poll ID cannot be empty");
    expect(() => new VoteHashChain("  ")).toThrow("Poll ID cannot be empty");
  });
});

// ============================================================
// Vote Addition Tests
// ============================================================

describe("Adding Votes", () => {
  let chain: VoteHashChain;

  beforeEach(() => {
    chain = new VoteHashChain("poll-test");
  });

  it("should add a vote and increment count", () => {
    const block = chain.addVote("nullifier-abc", 0);

    expect(block).not.toBeNull();
    expect(block!.index).toBe(1);
    expect(block!.pollId).toBe("poll-test");
    expect(block!.nullifierHash).toBe("nullifier-abc");
    expect(block!.choiceIndex).toBe(0);
    expect(chain.voteCount).toBe(1);
    expect(chain.length).toBe(2);
  });

  it("should link each vote to the previous block", () => {
    chain.addVote("nullifier-1", 0);
    chain.addVote("nullifier-2", 1);
    chain.addVote("nullifier-3", 2);

    const block1 = chain.getBlock(1)!;
    const block2 = chain.getBlock(2)!;
    const block3 = chain.getBlock(3)!;
    const genesis = chain.getBlock(0)!;

    expect(block1.previousHash).toBe(genesis.hash);
    expect(block2.previousHash).toBe(block1.hash);
    expect(block3.previousHash).toBe(block2.hash);
  });

  it("should produce unique hashes for different votes", () => {
    const block1 = chain.addVote("nullifier-a", 0)!;
    const block2 = chain.addVote("nullifier-b", 1)!;

    expect(block1.hash).not.toBe(block2.hash);
  });

  it("should handle multiple choices correctly", () => {
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);
    chain.addVote("n3", 2);
    chain.addVote("n4", 0);
    chain.addVote("n5", 3);

    expect(chain.voteCount).toBe(5);
  });

  it("should throw on negative choice index", () => {
    expect(() => chain.addVote("nullifier", -1)).toThrow(
      "Choice index must be a non-negative integer"
    );
  });

  it("should throw on non-integer choice index", () => {
    expect(() => chain.addVote("nullifier", 1.5)).toThrow(
      "Choice index must be a non-negative integer"
    );
  });
});

// ============================================================
// Double-Vote Prevention Tests
// ============================================================

describe("Double-Vote Prevention", () => {
  let chain: VoteHashChain;

  beforeEach(() => {
    chain = new VoteHashChain("poll-double");
  });

  it("should reject a vote with a used nullifier", () => {
    const first = chain.addVote("same-nullifier", 0);
    const second = chain.addVote("same-nullifier", 1);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(chain.voteCount).toBe(1);
  });

  it("should track nullifier usage correctly", () => {
    chain.addVote("nullifier-x", 0);

    expect(chain.hasNullifier("nullifier-x")).toBe(true);
    expect(chain.hasNullifier("nullifier-y")).toBe(false);
  });

  it("should allow different nullifiers for different voters", () => {
    const v1 = chain.addVote("voter-1-nullifier", 0);
    const v2 = chain.addVote("voter-2-nullifier", 0);
    const v3 = chain.addVote("voter-3-nullifier", 1);

    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v3).not.toBeNull();
    expect(chain.voteCount).toBe(3);
  });
});

// ============================================================
// Chain Verification Tests
// ============================================================

describe("Chain Verification", () => {
  it("should verify an empty chain (genesis only)", () => {
    const chain = new VoteHashChain("poll-verify");
    const result = chain.verify();

    expect(result.isValid).toBe(true);
    expect(result.blocksChecked).toBe(1);
    expect(result.firstInvalidBlock).toBe(-1);
  });

  it("should verify a chain with multiple votes", () => {
    const chain = new VoteHashChain("poll-multi");

    for (let i = 0; i < 20; i++) {
      chain.addVote(`nullifier-${i}`, i % 4);
    }

    const result = chain.verify();
    expect(result.isValid).toBe(true);
    expect(result.blocksChecked).toBe(21); // 20 votes + genesis
    expect(result.firstInvalidBlock).toBe(-1);
  });
});

// ============================================================
// Tampering Detection Tests
// ============================================================

describe("Tampering Detection", () => {
  it("should detect a modified vote choice", () => {
    const chain = new VoteHashChain("poll-tamper");
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);
    chain.addVote("n3", 2);

    // Tamper with block 2's choice (change vote from 1 to 0)
    const blocks = chain.getAllBlocks();
    blocks[2] = { ...blocks[2], choiceIndex: 0 };

    // Create a chain from tampered blocks
    const tampered = VoteHashChain.fromBlocks("poll-tamper", blocks);
    expect(tampered).toBeNull();
  });

  it("should detect a modified nullifier hash", () => {
    const chain = new VoteHashChain("poll-tamper-2");
    chain.addVote("real-nullifier", 0);

    const blocks = chain.getAllBlocks();
    blocks[1] = { ...blocks[1], nullifierHash: "fake-nullifier" };

    const tampered = VoteHashChain.fromBlocks("poll-tamper-2", blocks);
    expect(tampered).toBeNull();
  });

  it("should detect a broken chain link", () => {
    const chain = new VoteHashChain("poll-tamper-3");
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);

    const blocks = chain.getAllBlocks();
    // Break the link by changing previousHash
    blocks[2] = {
      ...blocks[2],
      previousHash: "deadbeef".repeat(8),
    };

    const tampered = VoteHashChain.fromBlocks("poll-tamper-3", blocks);
    expect(tampered).toBeNull();
  });

  it("should detect a removed block", () => {
    const chain = new VoteHashChain("poll-tamper-4");
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);
    chain.addVote("n3", 2);

    const blocks = chain.getAllBlocks();
    // Remove block at index 2
    blocks.splice(2, 1);

    const tampered = VoteHashChain.fromBlocks("poll-tamper-4", blocks);
    expect(tampered).toBeNull();
  });
});

// ============================================================
// Tally Tests
// ============================================================

describe("Vote Tallying", () => {
  it("should tally votes correctly", () => {
    const chain = new VoteHashChain("poll-tally");

    chain.addVote("n1", 0);
    chain.addVote("n2", 0);
    chain.addVote("n3", 1);
    chain.addVote("n4", 2);
    chain.addVote("n5", 0);

    const tally = chain.tally();
    expect(tally.get(0)).toBe(3);
    expect(tally.get(1)).toBe(1);
    expect(tally.get(2)).toBe(1);
  });

  it("should return empty tally for genesis-only chain", () => {
    const chain = new VoteHashChain("poll-empty");
    const tally = chain.tally();

    expect(tally.size).toBe(0);
  });

  it("should handle single-option votes", () => {
    const chain = new VoteHashChain("poll-single");

    chain.addVote("n1", 0);
    chain.addVote("n2", 0);
    chain.addVote("n3", 0);

    const tally = chain.tally();
    expect(tally.get(0)).toBe(3);
    expect(tally.size).toBe(1);
  });
});

// ============================================================
// Export/Import (Audit) Tests
// ============================================================

describe("Chain Export & Import", () => {
  it("should export and re-import a valid chain", () => {
    const original = new VoteHashChain("poll-export");
    original.addVote("n1", 0);
    original.addVote("n2", 1);
    original.addVote("n3", 2);

    const exported = original.getAllBlocks();
    const imported = VoteHashChain.fromBlocks("poll-export", exported);

    expect(imported).not.toBeNull();
    expect(imported!.voteCount).toBe(3);
    expect(imported!.getStats().latestHash).toBe(
      original.getStats().latestHash
    );
  });

  it("should reconstruct nullifier set on import", () => {
    const original = new VoteHashChain("poll-nullifiers");
    original.addVote("n1", 0);
    original.addVote("n2", 1);

    const exported = original.getAllBlocks();
    const imported = VoteHashChain.fromBlocks("poll-nullifiers", exported)!;

    expect(imported.hasNullifier("n1")).toBe(true);
    expect(imported.hasNullifier("n2")).toBe(true);
    expect(imported.hasNullifier("n3")).toBe(false);

    // Double vote should still be prevented after import
    const result = imported.addVote("n1", 0);
    expect(result).toBeNull();
  });

  it("should reject empty block array", () => {
    const result = VoteHashChain.fromBlocks("poll", []);
    expect(result).toBeNull();
  });

  it("should reject null block array", () => {
    const result = VoteHashChain.fromBlocks("poll", null as unknown as VoteBlock[]);
    expect(result).toBeNull();
  });
});

// ============================================================
// Stats Tests
// ============================================================

describe("Chain Statistics", () => {
  it("should return correct stats", () => {
    const chain = new VoteHashChain("poll-stats");
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);
    chain.addVote("n3", 0);

    const stats = chain.getStats();
    expect(stats.totalBlocks).toBe(4);
    expect(stats.totalVotes).toBe(3);
    expect(stats.genesisHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stats.latestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stats.genesisHash).not.toBe(stats.latestHash);
  });
});

// ============================================================
// computeBlockHash Tests
// ============================================================

describe("computeBlockHash", () => {
  it("should produce deterministic hashes", () => {
    const hash1 = computeBlockHash(1, "prev", "2026-01-01T00:00:00Z", "poll", "null", 0);
    const hash2 = computeBlockHash(1, "prev", "2026-01-01T00:00:00Z", "poll", "null", 0);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different inputs", () => {
    const hash1 = computeBlockHash(1, "prev", "2026-01-01T00:00:00Z", "poll", "null", 0);
    const hash2 = computeBlockHash(1, "prev", "2026-01-01T00:00:00Z", "poll", "null", 1);

    expect(hash1).not.toBe(hash2);
  });

  it("should produce 64-character hex strings", () => {
    const hash = computeBlockHash(0, "abc", "ts", "poll", "null", 0);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================
// Factory Function Tests
// ============================================================

describe("createHashChain factory", () => {
  it("should create a valid chain", () => {
    const chain = createHashChain("my-poll");
    expect(chain).toBeInstanceOf(VoteHashChain);
    expect(chain.pollId).toBe("my-poll");
    expect(chain.length).toBe(1);
  });
});

// ============================================================
// Latest Block & getBlock Tests
// ============================================================

describe("Block Access", () => {
  it("should return the latest block", () => {
    const chain = new VoteHashChain("poll-latest");
    chain.addVote("n1", 0);
    chain.addVote("n2", 1);

    const latest = chain.getLatestBlock();
    expect(latest.index).toBe(2);
    expect(latest.nullifierHash).toBe("n2");
  });

  it("should return undefined for out-of-range index", () => {
    const chain = new VoteHashChain("poll-range");
    expect(chain.getBlock(5)).toBeUndefined();
    expect(chain.getBlock(-1)).toBeUndefined();
  });
});
