/**
 * VoxPop -- Unit Tests for the Nullifier System
 *
 * Tests the cryptographic nullifier generation and the NullifierStore
 * that prevents double-voting while preserving voter anonymity.
 *
 * Covers:
 * - Deterministic nullifier generation
 * - External nullifier derivation
 * - Nullifier verification
 * - NullifierStore consumption and checking
 * - Cross-poll nullifier isolation
 * - Audit and statistics
 *
 * @license AGPL-3.0-or-later
 */

import {
  generateNullifier,
  generateExternalNullifier,
  verifyNullifier,
  NullifierStore,
  createNullifierStore,
} from "../../src/core/nullifier";

// ============================================================
// Nullifier Generation
// ============================================================

describe("generateNullifier", () => {
  it("should produce a 64-character hex string", () => {
    const nullifier = generateNullifier(12345n, "poll-001");
    expect(nullifier).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should be deterministic (same inputs -> same output)", () => {
    const secret = 9876543210n;
    const scope = "referendum-2026";

    const n1 = generateNullifier(secret, scope);
    const n2 = generateNullifier(secret, scope);

    expect(n1).toBe(n2);
  });

  it("should produce different nullifiers for different secrets", () => {
    const scope = "same-poll";
    const n1 = generateNullifier(111n, scope);
    const n2 = generateNullifier(222n, scope);

    expect(n1).not.toBe(n2);
  });

  it("should produce different nullifiers for different scopes", () => {
    const secret = 12345n;
    const n1 = generateNullifier(secret, "poll-1");
    const n2 = generateNullifier(secret, "poll-2");

    expect(n1).not.toBe(n2);
  });

  it("should handle large bigint secrets", () => {
    const largeSecret = BigInt(
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    );
    const nullifier = generateNullifier(largeSecret, "poll");
    expect(nullifier).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================
// External Nullifier
// ============================================================

describe("generateExternalNullifier", () => {
  it("should produce a 64-character hex string", () => {
    const ext = generateExternalNullifier("poll-001");
    expect(ext).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should be deterministic", () => {
    const e1 = generateExternalNullifier("poll-x");
    const e2 = generateExternalNullifier("poll-x");
    expect(e1).toBe(e2);
  });

  it("should differ for different poll IDs", () => {
    const e1 = generateExternalNullifier("poll-1");
    const e2 = generateExternalNullifier("poll-2");
    expect(e1).not.toBe(e2);
  });
});

// ============================================================
// Nullifier Verification
// ============================================================

describe("verifyNullifier", () => {
  it("should return true for a correctly derived nullifier", () => {
    const secret = 42n;
    const scope = "my-poll";
    const nullifier = generateNullifier(secret, scope);

    expect(verifyNullifier(nullifier, secret, scope)).toBe(true);
  });

  it("should return false for a wrong secret", () => {
    const nullifier = generateNullifier(42n, "poll");
    expect(verifyNullifier(nullifier, 99n, "poll")).toBe(false);
  });

  it("should return false for a wrong scope", () => {
    const nullifier = generateNullifier(42n, "poll-a");
    expect(verifyNullifier(nullifier, 42n, "poll-b")).toBe(false);
  });

  it("should return false for a forged nullifier", () => {
    expect(verifyNullifier("deadbeef".repeat(8), 42n, "poll")).toBe(false);
  });
});

// ============================================================
// NullifierStore — Consumption
// ============================================================

describe("NullifierStore — consume", () => {
  let store: NullifierStore;

  beforeEach(() => {
    store = createNullifierStore();
  });

  it("should accept a fresh nullifier", () => {
    const result = store.consume("poll-1", "nullifier-abc");

    expect(result.isFresh).toBe(true);
    expect(result.existingRecord).toBeUndefined();
  });

  it("should reject a duplicate nullifier for the same poll", () => {
    store.consume("poll-1", "nullifier-abc");
    const result = store.consume("poll-1", "nullifier-abc");

    expect(result.isFresh).toBe(false);
    expect(result.existingRecord).toBeDefined();
    expect(result.existingRecord!.nullifierHash).toBe("nullifier-abc");
    expect(result.existingRecord!.pollId).toBe("poll-1");
  });

  it("should allow the same nullifier on different polls", () => {
    const r1 = store.consume("poll-1", "same-nullifier");
    const r2 = store.consume("poll-2", "same-nullifier");

    expect(r1.isFresh).toBe(true);
    expect(r2.isFresh).toBe(true);
  });

  it("should track multiple nullifiers per poll", () => {
    store.consume("poll-1", "n1");
    store.consume("poll-1", "n2");
    store.consume("poll-1", "n3");

    expect(store.countForPoll("poll-1")).toBe(3);
  });

  it("should record timestamps", () => {
    const before = new Date().toISOString();
    store.consume("poll-1", "n1");

    const records = store.getRecordsForPoll("poll-1");
    expect(records).toHaveLength(1);
    expect(records[0].recordedAt >= before).toBe(true);
  });
});

// ============================================================
// NullifierStore — Check (non-consuming)
// ============================================================

describe("NullifierStore — check", () => {
  let store: NullifierStore;

  beforeEach(() => {
    store = createNullifierStore();
  });

  it("should report fresh for an unused nullifier", () => {
    const result = store.check("poll-1", "unknown");
    expect(result.isFresh).toBe(true);
  });

  it("should report not fresh for a consumed nullifier", () => {
    store.consume("poll-1", "used");
    const result = store.check("poll-1", "used");

    expect(result.isFresh).toBe(false);
    expect(result.existingRecord).toBeDefined();
  });

  it("should not consume the nullifier on check", () => {
    store.check("poll-1", "maybe");
    store.check("poll-1", "maybe");
    store.check("poll-1", "maybe");

    // Still fresh because check does not consume
    expect(store.countForPoll("poll-1")).toBe(0);
  });
});

// ============================================================
// NullifierStore — Audit & Stats
// ============================================================

describe("NullifierStore — Audit", () => {
  let store: NullifierStore;

  beforeEach(() => {
    store = createNullifierStore();
  });

  it("should report zero duplicates for a clean store", () => {
    store.consume("poll-1", "n1");
    store.consume("poll-1", "n2");

    expect(store.auditDuplicates("poll-1")).toBe(0);
  });

  it("should return records sorted by timestamp", () => {
    store.consume("poll-1", "n1");
    store.consume("poll-1", "n2");
    store.consume("poll-1", "n3");

    const records = store.getRecordsForPoll("poll-1");
    expect(records).toHaveLength(3);

    for (let i = 1; i < records.length; i++) {
      expect(records[i].recordedAt >= records[i - 1].recordedAt).toBe(true);
    }
  });

  it("should return correct aggregate stats", () => {
    store.consume("poll-1", "a");
    store.consume("poll-1", "b");
    store.consume("poll-2", "c");

    const stats = store.getStats();

    expect(stats.totalConsumed).toBe(3);
    expect(stats.activePollCount).toBe(2);
    expect(stats.perPoll.get("poll-1")).toBe(2);
    expect(stats.perPoll.get("poll-2")).toBe(1);
  });

  it("should list all polls with consumed nullifiers", () => {
    store.consume("poll-a", "n1");
    store.consume("poll-b", "n2");
    store.consume("poll-c", "n3");

    const polls = store.listPolls();
    expect(polls).toContain("poll-a");
    expect(polls).toContain("poll-b");
    expect(polls).toContain("poll-c");
  });

  it("should return empty records for unknown poll", () => {
    expect(store.getRecordsForPoll("nonexistent")).toEqual([]);
  });

  it("should return zero count for unknown poll", () => {
    expect(store.countForPoll("nonexistent")).toBe(0);
  });
});

// ============================================================
// NullifierStore — Reset
// ============================================================

describe("NullifierStore — Reset", () => {
  let store: NullifierStore;

  beforeEach(() => {
    store = createNullifierStore();
  });

  it("should reset a specific poll", () => {
    store.consume("poll-1", "n1");
    store.consume("poll-2", "n2");

    store.resetPoll("poll-1");

    expect(store.countForPoll("poll-1")).toBe(0);
    expect(store.countForPoll("poll-2")).toBe(1);
  });

  it("should reset the entire store", () => {
    store.consume("poll-1", "n1");
    store.consume("poll-2", "n2");

    store.reset();

    expect(store.getStats().totalConsumed).toBe(0);
    expect(store.listPolls()).toHaveLength(0);
  });
});

// ============================================================
// Integration: Generation + Store
// ============================================================

describe("Nullifier Integration", () => {
  it("should prevent double voting via generated nullifiers", () => {
    const store = createNullifierStore();
    const voterSecret = 123456789n;
    const pollId = "referendum-2026";

    // Generate nullifier for this voter + poll
    const nullifier = generateNullifier(voterSecret, pollId);

    // First vote -- accepted
    const first = store.consume(pollId, nullifier);
    expect(first.isFresh).toBe(true);

    // Same voter, same poll -- rejected
    const second = store.consume(pollId, nullifier);
    expect(second.isFresh).toBe(false);

    // Same voter, different poll -- accepted
    const otherPollNull = generateNullifier(voterSecret, "different-poll");
    const other = store.consume("different-poll", otherPollNull);
    expect(other.isFresh).toBe(true);
  });

  it("should allow different voters on the same poll", () => {
    const store = createNullifierStore();
    const pollId = "election-2026";

    const voters = [111n, 222n, 333n, 444n, 555n];

    for (const secret of voters) {
      const nullifier = generateNullifier(secret, pollId);
      const result = store.consume(pollId, nullifier);
      expect(result.isFresh).toBe(true);
    }

    expect(store.countForPoll(pollId)).toBe(5);
  });
});
