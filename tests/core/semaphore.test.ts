/**
 * VoxPop — Unit Tests for Semaphore Integration & Merkle Tree
 *
 * These tests verify the core ZKP voting primitives:
 * - Identity creation and restoration
 * - Per-country Merkle Tree management
 * - Vote configuration creation
 *
 * Note: Full proof generation/verification tests require the Semaphore
 * WASM circuits and are tested in integration tests (tests/integration/).
 *
 * @license AGPL-3.0-or-later
 */

import {
  createVoterIdentity,
  restoreVoterIdentity,
  createVoteConfig,
  VoterIdentity,
} from "../../src/core/semaphore-integration";

import {
  CountryTreeRegistry,
  createTreeRegistry,
} from "../../src/core/merkle-tree";

// ============================================================
// Semaphore Identity Tests
// ============================================================

describe("Semaphore Identity", () => {
  it("should create a new voter identity with a valid commitment", () => {
    const voter = createVoterIdentity();

    expect(voter).toBeDefined();
    expect(voter.identity).toBeDefined();
    expect(voter.commitment).toBeDefined();
    expect(typeof voter.commitment).toBe("bigint");
    expect(voter.commitment).toBeGreaterThan(0n);
  });

  it("should create unique identities each time", () => {
    const voter1 = createVoterIdentity();
    const voter2 = createVoterIdentity();

    // Two independently created identities must have different commitments
    expect(voter1.commitment).not.toBe(voter2.commitment);
  });

  it("should restore an identity from its exported secret", () => {
    const original = createVoterIdentity();
    const secret = original.identity.export();

    const restored = restoreVoterIdentity(secret);

    // Restored identity must produce the same commitment
    expect(restored.commitment).toBe(original.commitment);
  });
});

// ============================================================
// Vote Configuration Tests
// ============================================================

describe("Vote Configuration", () => {
  it("should create a valid vote config with correct timestamps", () => {
    const before = new Date();

    const config = createVoteConfig({
      voteId: "test-vote-001",
      title: "Test Referendum",
      choices: ["yes", "no", "abstain"],
      countryCode: "fr",
      durationMinutes: 60,
    });

    const after = new Date();

    expect(config.voteId).toBe("test-vote-001");
    expect(config.title).toBe("Test Referendum");
    expect(config.choices).toEqual(["yes", "no", "abstain"]);
    expect(config.countryCode).toBe("FR"); // Should be uppercased

    // Verify timestamps are within expected range
    const startTime = new Date(config.startTime);
    const endTime = new Date(config.endTime);

    expect(startTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(startTime.getTime()).toBeLessThanOrEqual(after.getTime());

    // Duration should be 60 minutes
    const durationMs = endTime.getTime() - startTime.getTime();
    expect(durationMs).toBe(60 * 60 * 1000);
  });

  it("should uppercase country codes", () => {
    const config = createVoteConfig({
      voteId: "test-vote-002",
      title: "Lowercase Test",
      choices: ["a", "b"],
      countryCode: "de",
      durationMinutes: 30,
    });

    expect(config.countryCode).toBe("DE");
  });
});

// ============================================================
// Per-Country Merkle Tree Tests
// ============================================================

describe("CountryTreeRegistry", () => {
  let registry: CountryTreeRegistry;

  beforeEach(() => {
    registry = createTreeRegistry();
  });

  it("should create a country tree", () => {
    const tree = registry.createCountryTree("FR");

    expect(tree.countryCode).toBe("FR");
    expect(tree.memberCount).toBe(0);
    expect(tree.group).toBeDefined();
  });

  it("should uppercase country codes", () => {
    const tree = registry.createCountryTree("fr");
    expect(tree.countryCode).toBe("FR");
  });

  it("should prevent duplicate country trees", () => {
    registry.createCountryTree("FR");

    expect(() => registry.createCountryTree("FR")).toThrow(
      "Country tree for FR already exists"
    );
  });

  it("should register a voter in a country tree", () => {
    registry.createCountryTree("FR");
    const voter = createVoterIdentity();

    const result = registry.registerVoter("FR", voter.commitment);

    expect(result.success).toBe(true);
    expect(result.countryCode).toBe("FR");
    expect(registry.getMemberCount("FR")).toBe(1);
  });

  it("should verify voter membership", () => {
    registry.createCountryTree("FR");
    const voter = createVoterIdentity();

    registry.registerVoter("FR", voter.commitment);

    expect(registry.isMember("FR", voter.commitment)).toBe(true);
    expect(registry.isMember("FR", 12345n)).toBe(false);
  });

  it("should isolate voters between countries", () => {
    registry.createCountryTree("FR");
    registry.createCountryTree("DE");

    const frenchVoter = createVoterIdentity();
    const germanVoter = createVoterIdentity();

    registry.registerVoter("FR", frenchVoter.commitment);
    registry.registerVoter("DE", germanVoter.commitment);

    // French voter is NOT in the German tree
    expect(registry.isMember("FR", frenchVoter.commitment)).toBe(true);
    expect(registry.isMember("DE", frenchVoter.commitment)).toBe(false);

    // German voter is NOT in the French tree
    expect(registry.isMember("DE", germanVoter.commitment)).toBe(true);
    expect(registry.isMember("FR", germanVoter.commitment)).toBe(false);
  });

  it("should register voters in batch", () => {
    registry.createCountryTree("BE");

    const voters = [
      createVoterIdentity(),
      createVoterIdentity(),
      createVoterIdentity(),
    ];
    const commitments = voters.map((v) => v.commitment);

    const results = registry.registerVoterBatch("BE", commitments);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(registry.getMemberCount("BE")).toBe(3);
  });

  it("should return correct statistics", () => {
    registry.createCountryTree("FR");
    registry.createCountryTree("DE");
    registry.createCountryTree("BE");

    // Register voters: 3 in FR, 2 in DE, 0 in BE
    for (let i = 0; i < 3; i++) {
      registry.registerVoter("FR", createVoterIdentity().commitment);
    }
    for (let i = 0; i < 2; i++) {
      registry.registerVoter("DE", createVoterIdentity().commitment);
    }

    const stats = registry.getStats();

    expect(stats.totalCountries).toBe(3);
    expect(stats.totalVoters).toBe(5);
    expect(stats.votersPerCountry.get("FR")).toBe(3);
    expect(stats.votersPerCountry.get("DE")).toBe(2);
    expect(stats.votersPerCountry.get("BE")).toBe(0);
  });

  it("should list all country codes sorted", () => {
    registry.createCountryTree("DE");
    registry.createCountryTree("FR");
    registry.createCountryTree("BE");

    expect(registry.listCountries()).toEqual(["BE", "DE", "FR"]);
  });

  it("should check if a country exists", () => {
    registry.createCountryTree("FR");

    expect(registry.hasCountry("FR")).toBe(true);
    expect(registry.hasCountry("DE")).toBe(false);
    expect(registry.hasCountry("fr")).toBe(true); // case insensitive
  });

  it("should fail gracefully when registering to non-existent country", () => {
    const voter = createVoterIdentity();
    const result = registry.registerVoter("XX", voter.commitment);

    expect(result.success).toBe(false);
    expect(result.error).toContain("No tree found for country XX");
  });
});
