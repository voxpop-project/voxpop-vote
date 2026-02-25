/**
 * VoxPop -- Unit Tests for the VoteModule (Main Orchestrator)
 *
 * Tests the end-to-end voting workflow through the VoteModule:
 *   createPoll -> registerVoter -> castVote -> getResults -> audit
 *
 * Also tests error handling, double-vote prevention, cross-country
 * isolation, and poll lifecycle management.
 *
 * @license AGPL-3.0-or-later
 */

import {
  VoteModule,
  createVoteModule,
  VoteModuleError,
} from "../../src/core/vote-module";
import { generateNullifier } from "../../src/core/nullifier";

// ============================================================
// Setup
// ============================================================

describe("VoteModule", () => {
  let vm: VoteModule;

  beforeEach(() => {
    vm = createVoteModule();
  });

  // ============================================================
  // Poll Creation
  // ============================================================

  describe("createPoll", () => {
    it("should create a poll with valid parameters", () => {
      const poll = vm.createPoll({
        title: "Test Referendum",
        options: ["Yes", "No", "Abstain"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      expect(poll.id).toMatch(/^poll_/);
      expect(poll.title).toBe("Test Referendum");
      expect(poll.options).toEqual(["Yes", "No", "Abstain"]);
      expect(poll.countryCode).toBe("FR");
      expect(poll.status).toBe("active");
      expect(poll.requireZkp).toBe(false);
    });

    it("should auto-register the country", () => {
      vm.createPoll({
        title: "German Vote",
        options: ["Ja", "Nein"],
        countryCode: "de",
        durationMinutes: 30,
      });

      const manager = vm.getGroupManager();
      expect(manager.hasGroup("DE")).toBe(true);
    });

    it("should uppercase the country code", () => {
      const poll = vm.createPoll({
        title: "Test",
        options: ["A", "B"],
        countryCode: "fr",
        durationMinutes: 10,
      });

      expect(poll.countryCode).toBe("FR");
    });

    it("should reject empty title", () => {
      expect(() =>
        vm.createPoll({
          title: "",
          options: ["A", "B"],
          countryCode: "FR",
          durationMinutes: 10,
        })
      ).toThrow(VoteModuleError);
    });

    it("should reject fewer than 2 options", () => {
      expect(() =>
        vm.createPoll({
          title: "Bad poll",
          options: ["Only one"],
          countryCode: "FR",
          durationMinutes: 10,
        })
      ).toThrow(VoteModuleError);
    });

    it("should reject non-positive duration", () => {
      expect(() =>
        vm.createPoll({
          title: "Bad poll",
          options: ["A", "B"],
          countryCode: "FR",
          durationMinutes: 0,
        })
      ).toThrow(VoteModuleError);
    });
  });

  // ============================================================
  // Voting
  // ============================================================

  describe("castVote", () => {
    let pollId: string;

    beforeEach(() => {
      const poll = vm.createPoll({
        title: "Referendum",
        options: ["Yes", "No", "Abstain"],
        countryCode: "FR",
        durationMinutes: 60,
      });
      pollId = poll.id;
    });

    it("should accept a valid vote and return a receipt", () => {
      const receipt = vm.castVote({
        pollId,
        nullifierHash: "nullifier-001",
        choiceIndex: 0,
      });

      expect(receipt.accepted).toBe(true);
      expect(receipt.voteHash).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.chainPosition).toBe(1);
      expect(receipt.nullifierHash).toBe("nullifier-001");
      expect(receipt.timestamp).toBeDefined();
    });

    it("should reject a vote on a non-existent poll", () => {
      expect(() =>
        vm.castVote({
          pollId: "nonexistent",
          nullifierHash: "n1",
          choiceIndex: 0,
        })
      ).toThrow(VoteModuleError);

      try {
        vm.castVote({
          pollId: "nonexistent",
          nullifierHash: "n1",
          choiceIndex: 0,
        });
      } catch (e) {
        expect(e).toBeInstanceOf(VoteModuleError);
        expect((e as VoteModuleError).code).toBe("POLL_NOT_FOUND");
      }
    });

    it("should reject a vote with an out-of-range choice", () => {
      expect(() =>
        vm.castVote({
          pollId,
          nullifierHash: "n1",
          choiceIndex: 5,
        })
      ).toThrow(VoteModuleError);

      expect(() =>
        vm.castVote({
          pollId,
          nullifierHash: "n2",
          choiceIndex: -1,
        })
      ).toThrow(VoteModuleError);
    });

    it("should reject a double vote (same nullifier)", () => {
      vm.castVote({
        pollId,
        nullifierHash: "voter-x",
        choiceIndex: 0,
      });

      expect(() =>
        vm.castVote({
          pollId,
          nullifierHash: "voter-x",
          choiceIndex: 1,
        })
      ).toThrow(VoteModuleError);

      try {
        vm.castVote({
          pollId,
          nullifierHash: "voter-x",
          choiceIndex: 1,
        });
      } catch (e) {
        expect((e as VoteModuleError).code).toBe("ALREADY_VOTED");
      }
    });

    it("should allow different voters on the same poll", () => {
      for (let i = 0; i < 10; i++) {
        const receipt = vm.castVote({
          pollId,
          nullifierHash: `voter-${i}`,
          choiceIndex: i % 3,
        });
        expect(receipt.accepted).toBe(true);
      }
    });

    it("should allow the same nullifier on different polls", () => {
      const poll2 = vm.createPoll({
        title: "Another poll",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      const r1 = vm.castVote({
        pollId,
        nullifierHash: "shared-nullifier",
        choiceIndex: 0,
      });

      const r2 = vm.castVote({
        pollId: poll2.id,
        nullifierHash: "shared-nullifier",
        choiceIndex: 1,
      });

      expect(r1.accepted).toBe(true);
      expect(r2.accepted).toBe(true);
    });

    it("should link votes in the hash chain", () => {
      const r1 = vm.castVote({ pollId, nullifierHash: "n1", choiceIndex: 0 });
      const r2 = vm.castVote({ pollId, nullifierHash: "n2", choiceIndex: 1 });
      const r3 = vm.castVote({ pollId, nullifierHash: "n3", choiceIndex: 2 });

      expect(r2.previousHash).toBe(r1.voteHash);
      expect(r3.previousHash).toBe(r2.voteHash);
    });
  });

  // ============================================================
  // Results
  // ============================================================

  describe("getResults", () => {
    it("should return correct tallies", () => {
      const poll = vm.createPoll({
        title: "Tally test",
        options: ["Alpha", "Beta", "Gamma"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      // 3 Alpha, 2 Beta, 1 Gamma
      vm.castVote({ pollId: poll.id, nullifierHash: "v1", choiceIndex: 0 });
      vm.castVote({ pollId: poll.id, nullifierHash: "v2", choiceIndex: 0 });
      vm.castVote({ pollId: poll.id, nullifierHash: "v3", choiceIndex: 0 });
      vm.castVote({ pollId: poll.id, nullifierHash: "v4", choiceIndex: 1 });
      vm.castVote({ pollId: poll.id, nullifierHash: "v5", choiceIndex: 1 });
      vm.castVote({ pollId: poll.id, nullifierHash: "v6", choiceIndex: 2 });

      const results = vm.getResults(poll.id);

      expect(results.totalVotes).toBe(6);
      expect(results.results[0].option).toBe("Alpha");
      expect(results.results[0].votes).toBe(3);
      expect(results.results[0].percentage).toBe(50.0);
      expect(results.results[1].votes).toBe(2);
      expect(results.results[2].votes).toBe(1);
      expect(results.hashChain.isValid).toBe(true);
      expect(results.hashChain.length).toBe(7); // 6 votes + genesis
    });

    it("should return zero results for a poll with no votes", () => {
      const poll = vm.createPoll({
        title: "Empty",
        options: ["X", "Y"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      const results = vm.getResults(poll.id);
      expect(results.totalVotes).toBe(0);
      expect(results.results[0].votes).toBe(0);
      expect(results.results[0].percentage).toBe(0);
    });

    it("should throw for non-existent poll", () => {
      expect(() => vm.getResults("fake")).toThrow(VoteModuleError);
    });
  });

  // ============================================================
  // Verification
  // ============================================================

  describe("verifyVote", () => {
    it("should verify an existing vote by its hash", () => {
      const poll = vm.createPoll({
        title: "Verify test",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      const receipt = vm.castVote({
        pollId: poll.id,
        nullifierHash: "my-nullifier",
        choiceIndex: 0,
      });

      const verification = vm.verifyVote(poll.id, receipt.voteHash);

      expect(verification).not.toBeNull();
      expect(verification!.verified).toBe(true);
      expect(verification!.position).toBe(receipt.chainPosition);
    });

    it("should return null for a non-existent vote hash", () => {
      const poll = vm.createPoll({
        title: "Verify test",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      const result = vm.verifyVote(poll.id, "nonexistent-hash");
      expect(result).toBeNull();
    });

    it("should return null for a non-existent poll", () => {
      const result = vm.verifyVote("fake-poll", "fake-hash");
      expect(result).toBeNull();
    });
  });

  // ============================================================
  // Audit
  // ============================================================

  describe("audit", () => {
    it("should produce a clean audit for a valid poll", () => {
      const poll = vm.createPoll({
        title: "Audit test",
        options: ["Yes", "No"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      vm.castVote({ pollId: poll.id, nullifierHash: "a1", choiceIndex: 0 });
      vm.castVote({ pollId: poll.id, nullifierHash: "a2", choiceIndex: 1 });
      vm.castVote({ pollId: poll.id, nullifierHash: "a3", choiceIndex: 0 });

      const audit = vm.audit(poll.id);

      expect(audit.totalVotes).toBe(3);
      expect(audit.totalBlocks).toBe(4); // 3 votes + genesis
      expect(audit.hashChainValid).toBe(true);
      expect(audit.firstInvalidBlock).toBe(-1);
      expect(audit.duplicateNullifiers).toBe(0);
      expect(audit.merkleTreeConsistent).toBe(true);
      expect(audit.genesisHash).toMatch(/^[a-f0-9]{64}$/);
      expect(audit.latestHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should throw for a non-existent poll", () => {
      expect(() => vm.audit("ghost")).toThrow(VoteModuleError);
    });
  });

  // ============================================================
  // Cross-Country Isolation
  // ============================================================

  describe("Cross-Country Isolation", () => {
    it("should maintain separate vote chains per poll/country", () => {
      const frPoll = vm.createPoll({
        title: "French Vote",
        options: ["Oui", "Non"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      const dePoll = vm.createPoll({
        title: "German Vote",
        options: ["Ja", "Nein"],
        countryCode: "DE",
        durationMinutes: 60,
      });

      vm.castVote({ pollId: frPoll.id, nullifierHash: "fr-1", choiceIndex: 0 });
      vm.castVote({ pollId: frPoll.id, nullifierHash: "fr-2", choiceIndex: 0 });

      vm.castVote({ pollId: dePoll.id, nullifierHash: "de-1", choiceIndex: 1 });

      const frResults = vm.getResults(frPoll.id);
      const deResults = vm.getResults(dePoll.id);

      expect(frResults.totalVotes).toBe(2);
      expect(deResults.totalVotes).toBe(1);
    });

    it("should register separate country groups", () => {
      vm.registerCountry("FR");
      vm.registerCountry("DE");
      vm.registerCountry("BE");

      const manager = vm.getGroupManager();
      expect(manager.listCountries()).toEqual(["BE", "DE", "FR"]);
    });
  });

  // ============================================================
  // Poll Lifecycle
  // ============================================================

  describe("Poll Lifecycle", () => {
    it("should auto-close expired polls", () => {
      const poll = vm.createPoll({
        title: "Short poll",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 0.001, // ~60ms
      });

      // Wait for it to expire
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }

      const fetched = vm.getPoll(poll.id);
      expect(fetched!.status).toBe("closed");
    });

    it("should reject votes on closed polls", () => {
      const poll = vm.createPoll({
        title: "Short poll",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 0.001,
      });

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }

      expect(() =>
        vm.castVote({
          pollId: poll.id,
          nullifierHash: "late-voter",
          choiceIndex: 0,
        })
      ).toThrow(VoteModuleError);
    });

    it("should filter polls by status", () => {
      vm.createPoll({
        title: "Active",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 9999,
      });

      vm.createPoll({
        title: "Expired",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 0.001,
      });

      // Wait for the expired one
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }

      const active = vm.listPolls({ status: "active" });
      const closed = vm.listPolls({ status: "closed" });

      expect(active).toHaveLength(1);
      expect(active[0].title).toBe("Active");

      expect(closed).toHaveLength(1);
      expect(closed[0].title).toBe("Expired");
    });
  });

  // ============================================================
  // Voter Registration
  // ============================================================

  describe("Voter Registration", () => {
    it("should register a voter in a country group", () => {
      vm.registerCountry("FR");
      vm.registerVoter("FR", 12345n);

      const manager = vm.getGroupManager();
      expect(manager.isMember("FR", 12345n)).toBe(true);
    });

    it("should auto-register country on voter registration", () => {
      vm.registerVoter("IT", 99999n);

      const manager = vm.getGroupManager();
      expect(manager.hasGroup("IT")).toBe(true);
    });
  });

  // ============================================================
  // Large Scale
  // ============================================================

  describe("Scale: 50 voters", () => {
    it("should handle 50 votes with valid chain and results", () => {
      const poll = vm.createPoll({
        title: "Scale test",
        options: ["Red", "Blue", "Green", "Yellow"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      for (let i = 0; i < 50; i++) {
        vm.castVote({
          pollId: poll.id,
          nullifierHash: `voter-${i.toString().padStart(3, "0")}`,
          choiceIndex: i % 4,
        });
      }

      const results = vm.getResults(poll.id);
      expect(results.totalVotes).toBe(50);

      // 50 voters evenly distributed: 13, 13, 12, 12
      expect(results.results[0].votes).toBe(13); // 0,4,8,...,48
      expect(results.results[1].votes).toBe(13); // 1,5,9,...,49
      expect(results.results[2].votes).toBe(12);
      expect(results.results[3].votes).toBe(12);

      // Chain integrity
      expect(results.hashChain.isValid).toBe(true);
      expect(results.hashChain.length).toBe(51);

      // Audit
      const audit = vm.audit(poll.id);
      expect(audit.hashChainValid).toBe(true);
      expect(audit.duplicateNullifiers).toBe(0);
    });
  });

  // ============================================================
  // Integration with Nullifier Generation
  // ============================================================

  describe("Integration: generateNullifier + castVote", () => {
    it("should work end-to-end with generated nullifiers", () => {
      const poll = vm.createPoll({
        title: "Full integration",
        options: ["Accept", "Reject"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      // Simulate 5 voters with identity secrets
      const voterSecrets = [100n, 200n, 300n, 400n, 500n];
      const choices = [0, 0, 1, 0, 1]; // 3 Accept, 2 Reject

      for (let i = 0; i < voterSecrets.length; i++) {
        const nullifier = generateNullifier(voterSecrets[i], poll.id);
        const receipt = vm.castVote({
          pollId: poll.id,
          nullifierHash: nullifier,
          choiceIndex: choices[i],
        });
        expect(receipt.accepted).toBe(true);
      }

      const results = vm.getResults(poll.id);
      expect(results.results[0].votes).toBe(3); // Accept
      expect(results.results[1].votes).toBe(2); // Reject

      // Double vote attempt with same secret
      const duplicateNull = generateNullifier(voterSecrets[0], poll.id);
      expect(() =>
        vm.castVote({
          pollId: poll.id,
          nullifierHash: duplicateNull,
          choiceIndex: 1,
        })
      ).toThrow(VoteModuleError);
    });
  });

  // ============================================================
  // Reset
  // ============================================================

  describe("reset", () => {
    it("should clear all state", () => {
      vm.createPoll({
        title: "Will be cleared",
        options: ["A", "B"],
        countryCode: "FR",
        durationMinutes: 60,
      });

      vm.reset();

      expect(vm.listPolls()).toHaveLength(0);
      expect(vm.getGroupManager().listCountries()).toHaveLength(0);
      expect(vm.getNullifierStore().getStats().totalConsumed).toBe(0);
    });
  });
});
