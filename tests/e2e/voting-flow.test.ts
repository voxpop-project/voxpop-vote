/**
 * End-to-End Voting Flow Tests
 *
 * Tests the complete lifecycle of a vote through the API:
 *   1. Create a poll
 *   2. Cast votes (multiple voters)
 *   3. Attempt double-vote (must be rejected)
 *   4. View results with tally
 *   5. Verify individual votes by hash
 *   6. Run full audit trail
 *   7. Cross-country isolation
 *   8. Poll lifecycle (active → closed)
 *
 * These tests simulate real-world usage against the running API,
 * validating that all modules (hash chain, store, routes) work
 * together correctly.
 *
 * @module tests/e2e/voting-flow
 * @license AGPL-3.0-or-later
 */

import request from "supertest";
import { createTestApp } from "../../src/api/server";
import { Express } from "express";
import { VoxPopStore } from "../../src/api/store";

describe("E2E: Complete Voting Flow", () => {
  let app: Express;
  let store: VoxPopStore;

  beforeEach(() => {
    const test = createTestApp();
    app = test.app;
    store = test.store;
  });

  // ============================================================
  // Happy Path: Full Voting Lifecycle
  // ============================================================

  describe("Happy Path — Create → Vote → Results → Audit", () => {
    it("should complete a full voting cycle", async () => {
      // ---- Step 1: Create a poll ----
      const createRes = await request(app)
        .post("/v1/polls")
        .send({
          title: "Should we transition to renewable energy by 2030?",
          description: "Municipal referendum on the city energy plan.",
          options: ["Yes", "No", "Abstain"],
          country: "FR",
          closes_at: new Date(Date.now() + 7 * 86400000).toISOString(), // +7 days
          settings: { anonymous: true, require_zkp: true },
        });

      expect(createRes.status).toBe(201);
      const pollId = createRes.body.id;
      expect(pollId).toMatch(/^poll_/);

      // ---- Step 2: Verify poll appears in list ----
      const listRes = await request(app).get("/v1/polls?country=FR");
      expect(listRes.status).toBe(200);
      expect(listRes.body.polls).toHaveLength(1);
      expect(listRes.body.polls[0].id).toBe(pollId);
      expect(listRes.body.polls[0].status).toBe("active");

      // ---- Step 3: Cast 5 votes ----
      const receipts: any[] = [];

      for (let i = 0; i < 5; i++) {
        const choices = [0, 0, 0, 1, 2]; // 3 Yes, 1 No, 1 Abstain
        const voteRes = await request(app)
          .post(`/v1/polls/${pollId}/vote`)
          .send({
            nullifier_hash: `voter-${i}-nullifier-hash`,
            choice_index: choices[i],
          });

        expect(voteRes.status).toBe(200);
        expect(voteRes.body.accepted).toBe(true);
        expect(voteRes.body.receipt.chain_position).toBe(i + 1);
        receipts.push(voteRes.body.receipt);
      }

      // ---- Step 4: Verify chain linking ----
      for (let i = 1; i < receipts.length; i++) {
        expect(receipts[i].previous_hash).toBe(receipts[i - 1].vote_hash);
      }

      // ---- Step 5: Get results ----
      const resultsRes = await request(app).get(`/v1/polls/${pollId}/results`);
      expect(resultsRes.status).toBe(200);
      expect(resultsRes.body.total_votes).toBe(5);

      const results = resultsRes.body.results;
      expect(results[0].option).toBe("Yes");
      expect(results[0].votes).toBe(3);
      expect(results[0].percentage).toBe(60.0);
      expect(results[1].option).toBe("No");
      expect(results[1].votes).toBe(1);
      expect(results[1].percentage).toBe(20.0);
      expect(results[2].option).toBe("Abstain");
      expect(results[2].votes).toBe(1);
      expect(results[2].percentage).toBe(20.0);

      // Hash chain is valid
      expect(resultsRes.body.hash_chain.valid).toBe(true);
      expect(resultsRes.body.hash_chain.length).toBe(6); // 5 votes + genesis

      // ---- Step 6: Verify each vote by hash ----
      for (const receipt of receipts) {
        const verifyRes = await request(app).get(
          `/v1/polls/${pollId}/verify/${receipt.vote_hash}`
        );
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.verified).toBe(true);
        expect(verifyRes.body.vote_hash).toBe(receipt.vote_hash);
      }

      // ---- Step 7: Full audit trail ----
      const auditRes = await request(app).get(`/v1/polls/${pollId}/audit`);
      expect(auditRes.status).toBe(200);
      expect(auditRes.body.audit.total_votes).toBe(5);
      expect(auditRes.body.audit.total_blocks).toBe(6);
      expect(auditRes.body.audit.hash_chain_valid).toBe(true);
      expect(auditRes.body.audit.duplicate_nullifiers_detected).toBe(0);
      expect(auditRes.body.audit.merkle_tree_consistent).toBe(true);
      expect(auditRes.body.verification_error).toBeNull();
    });
  });

  // ============================================================
  // Double-Vote Prevention via API
  // ============================================================

  describe("Double-Vote Prevention", () => {
    it("should reject a second vote with the same nullifier via API", async () => {
      // Create poll
      const poll = await request(app)
        .post("/v1/polls")
        .send({
          title: "Double vote test",
          options: ["A", "B"],
          country: "BE",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      const pollId = poll.body.id;

      // First vote — accepted
      const vote1 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "unique-voter-nullifier", choice_index: 0 });

      expect(vote1.status).toBe(200);
      expect(vote1.body.accepted).toBe(true);

      // Second vote with SAME nullifier — rejected
      const vote2 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "unique-voter-nullifier", choice_index: 1 });

      expect(vote2.status).toBe(409);
      expect(vote2.body.error).toBe("ALREADY_VOTED");

      // Verify only 1 vote counted
      const results = await request(app).get(`/v1/polls/${pollId}/results`);
      expect(results.body.total_votes).toBe(1);
      expect(results.body.results[0].votes).toBe(1); // "A" got the vote
      expect(results.body.results[1].votes).toBe(0); // "B" didn't
    });

    it("should allow the same voter to vote on different polls", async () => {
      // Create 2 polls
      const poll1 = await request(app)
        .post("/v1/polls")
        .send({
          title: "Poll 1",
          options: ["A", "B"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      const poll2 = await request(app)
        .post("/v1/polls")
        .send({
          title: "Poll 2",
          options: ["X", "Y"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      // Same nullifier on different polls — both should be accepted
      // (In real Semaphore, nullifiers are scoped per poll via the scope parameter)
      const v1 = await request(app)
        .post(`/v1/polls/${poll1.body.id}/vote`)
        .send({ nullifier_hash: "same-voter", choice_index: 0 });

      const v2 = await request(app)
        .post(`/v1/polls/${poll2.body.id}/vote`)
        .send({ nullifier_hash: "same-voter", choice_index: 1 });

      expect(v1.status).toBe(200);
      expect(v2.status).toBe(200);
    });
  });

  // ============================================================
  // Cross-Country Isolation
  // ============================================================

  describe("Cross-Country Isolation", () => {
    it("should isolate polls by country code", async () => {
      // Create polls in FR and DE
      const frPoll = await request(app)
        .post("/v1/polls")
        .send({
          title: "French referendum",
          options: ["Oui", "Non"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      const dePoll = await request(app)
        .post("/v1/polls")
        .send({
          title: "German referendum",
          options: ["Ja", "Nein"],
          country: "DE",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      // Vote on each
      await request(app)
        .post(`/v1/polls/${frPoll.body.id}/vote`)
        .send({ nullifier_hash: "fr-voter-1", choice_index: 0 });

      await request(app)
        .post(`/v1/polls/${dePoll.body.id}/vote`)
        .send({ nullifier_hash: "de-voter-1", choice_index: 1 });

      // Filter by country
      const frList = await request(app).get("/v1/polls?country=FR");
      const deList = await request(app).get("/v1/polls?country=DE");
      const allList = await request(app).get("/v1/polls");

      expect(frList.body.polls).toHaveLength(1);
      expect(frList.body.polls[0].title).toBe("French referendum");

      expect(deList.body.polls).toHaveLength(1);
      expect(deList.body.polls[0].title).toBe("German referendum");

      expect(allList.body.polls).toHaveLength(2);

      // Verify each poll has independent vote counts
      const frResults = await request(app).get(
        `/v1/polls/${frPoll.body.id}/results`
      );
      const deResults = await request(app).get(
        `/v1/polls/${dePoll.body.id}/results`
      );

      expect(frResults.body.total_votes).toBe(1);
      expect(deResults.body.total_votes).toBe(1);

      // Each has independent hash chains (latest hashes differ due to different votes)
      expect(frResults.body.hash_chain.latest_hash).not.toBe(
        deResults.body.hash_chain.latest_hash
      );
    });
  });

  // ============================================================
  // Poll Lifecycle: Active → Closed
  // ============================================================

  describe("Poll Lifecycle", () => {
    it("should reject votes on a closed poll", async () => {
      // Create a poll that closes in the past
      const poll = await request(app)
        .post("/v1/polls")
        .send({
          title: "Already expired",
          options: ["A", "B"],
          country: "FR",
          closes_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
        });

      const pollId = poll.body.id;

      // Try to vote — should be rejected
      const vote = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "late-voter", choice_index: 0 });

      expect(vote.status).toBe(410);
      expect(vote.body.error).toBe("POLL_CLOSED");

      // Poll detail should show "closed"
      const detail = await request(app).get(`/v1/polls/${pollId}`);
      expect(detail.body.status).toBe("closed");
    });

    it("should show correct status in poll listing", async () => {
      // Create one active and one closed poll
      await request(app)
        .post("/v1/polls")
        .send({
          title: "Active poll",
          options: ["A", "B"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      await request(app)
        .post("/v1/polls")
        .send({
          title: "Closed poll",
          options: ["A", "B"],
          country: "FR",
          closes_at: new Date(Date.now() - 1000).toISOString(),
        });

      // Filter by status
      const activePolls = await request(app).get("/v1/polls?status=active");
      const closedPolls = await request(app).get("/v1/polls?status=closed");

      expect(activePolls.body.polls).toHaveLength(1);
      expect(activePolls.body.polls[0].title).toBe("Active poll");

      expect(closedPolls.body.polls).toHaveLength(1);
      expect(closedPolls.body.polls[0].title).toBe("Closed poll");
    });
  });

  // ============================================================
  // Large-Scale Vote Simulation
  // ============================================================

  describe("Scale: 100 Voters", () => {
    it("should handle 100 votes with valid chain integrity", async () => {
      const poll = await request(app)
        .post("/v1/polls")
        .send({
          title: "Large scale vote",
          options: ["Alpha", "Beta", "Gamma", "Delta"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      const pollId = poll.body.id;

      // Cast 100 votes
      for (let i = 0; i < 100; i++) {
        const res = await request(app)
          .post(`/v1/polls/${pollId}/vote`)
          .send({
            nullifier_hash: `voter-${i.toString().padStart(3, "0")}`,
            choice_index: i % 4, // Distribute across 4 options
          });

        expect(res.status).toBe(200);
      }

      // Verify results
      const results = await request(app).get(`/v1/polls/${pollId}/results`);
      expect(results.body.total_votes).toBe(100);

      // Each option should have 25 votes (100 / 4)
      expect(results.body.results[0].votes).toBe(25); // Alpha
      expect(results.body.results[1].votes).toBe(25); // Beta
      expect(results.body.results[2].votes).toBe(25); // Gamma
      expect(results.body.results[3].votes).toBe(25); // Delta

      // Chain integrity
      expect(results.body.hash_chain.valid).toBe(true);
      expect(results.body.hash_chain.length).toBe(101); // 100 votes + genesis

      // Full audit
      const audit = await request(app).get(`/v1/polls/${pollId}/audit`);
      expect(audit.body.audit.hash_chain_valid).toBe(true);
      expect(audit.body.audit.total_votes).toBe(100);
      expect(audit.body.audit.duplicate_nullifiers_detected).toBe(0);
    });
  });

  // ============================================================
  // Error Handling E2E
  // ============================================================

  describe("Error Handling", () => {
    it("should return 404 for non-existent routes", async () => {
      const res = await request(app).get("/v1/nonexistent");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("NOT_FOUND");
    });

    it("should handle malformed JSON gracefully", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .set("Content-Type", "application/json")
        .send("{ invalid json");

      expect(res.status).toBe(400);
    });

    it("should return health check", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.version).toBe("0.1.0");
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ============================================================
  // Receipt Verification Flow
  // ============================================================

  describe("Receipt Verification Flow", () => {
    it("should allow a voter to verify their vote after casting", async () => {
      // Create poll
      const poll = await request(app)
        .post("/v1/polls")
        .send({
          title: "Verifiable vote",
          options: ["For", "Against"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      // Cast vote and save receipt
      const vote = await request(app)
        .post(`/v1/polls/${poll.body.id}/vote`)
        .send({ nullifier_hash: "my-secret-nullifier", choice_index: 0 });

      const receipt = vote.body.receipt;

      // Use the vote_hash from receipt to verify
      const verify = await request(app).get(
        `/v1/polls/${poll.body.id}/verify/${receipt.vote_hash}`
      );

      expect(verify.status).toBe(200);
      expect(verify.body.verified).toBe(true);
      expect(verify.body.position).toBe(receipt.chain_position);
      expect(verify.body.vote_hash).toBe(receipt.vote_hash);
      expect(verify.body.previous_hash).toBe(receipt.previous_hash);
      expect(verify.body.timestamp).toBe(receipt.timestamp);
    });

    it("should show a non-existent hash as not found", async () => {
      const poll = await request(app)
        .post("/v1/polls")
        .send({
          title: "Verify test",
          options: ["A", "B"],
          country: "FR",
          closes_at: new Date(Date.now() + 86400000).toISOString(),
        });

      const res = await request(app).get(
        `/v1/polls/${poll.body.id}/verify/0000000000000000000000000000000000000000000000000000000000000000`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("VOTE_NOT_FOUND");
    });
  });

  // ============================================================
  // Multiple Polls Concurrent Voting
  // ============================================================

  describe("Concurrent Polls", () => {
    it("should handle voting on multiple polls simultaneously", async () => {
      // Create 3 polls
      const polls = [];
      for (let p = 0; p < 3; p++) {
        const res = await request(app)
          .post("/v1/polls")
          .send({
            title: `Concurrent poll ${p + 1}`,
            options: ["Yes", "No"],
            country: ["FR", "DE", "BE"][p],
            closes_at: new Date(Date.now() + 86400000).toISOString(),
          });
        polls.push(res.body.id);
      }

      // Vote on all 3 polls with different voters
      for (let v = 0; v < 10; v++) {
        for (let p = 0; p < 3; p++) {
          const res = await request(app)
            .post(`/v1/polls/${polls[p]}/vote`)
            .send({
              nullifier_hash: `poll${p}-voter${v}`,
              choice_index: v % 2,
            });

          expect(res.status).toBe(200);
        }
      }

      // Verify each poll has 10 votes with valid chains
      for (let p = 0; p < 3; p++) {
        const results = await request(app).get(`/v1/polls/${polls[p]}/results`);
        expect(results.body.total_votes).toBe(10);
        expect(results.body.hash_chain.valid).toBe(true);

        // 5 Yes (even voters), 5 No (odd voters)
        expect(results.body.results[0].votes).toBe(5);
        expect(results.body.results[1].votes).toBe(5);

        const audit = await request(app).get(`/v1/polls/${polls[p]}/audit`);
        expect(audit.body.audit.hash_chain_valid).toBe(true);
      }
    });
  });
});
