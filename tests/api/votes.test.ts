/**
 * Tests for Vote Routes
 *
 * Covers:
 * - Successful vote submission
 * - Double-vote prevention (409)
 * - Poll not found (404)
 * - Poll closed (410)
 * - Validation errors (400)
 * - Vote receipt verification
 */

import request from "supertest";
import { createTestApp } from "../../src/api/server";
import { Express } from "express";
import { VoxPopStore } from "../../src/api/store";

describe("Vote Routes", () => {
  let app: Express;
  let store: VoxPopStore;
  let pollId: string;

  beforeEach(() => {
    const test = createTestApp();
    app = test.app;
    store = test.store;

    // Create a test poll
    const poll = store.createPoll({
      title: "Vote Test Poll",
      description: "Testing votes",
      options: ["Yes", "No", "Abstain"],
      countryCode: "FR",
      closesAt: new Date(Date.now() + 86400000).toISOString(), // +24h
    });
    pollId = poll.id;
  });

  // ============================================================
  // POST /v1/polls/:id/vote — Cast a Vote
  // ============================================================

  describe("POST /v1/polls/:id/vote", () => {
    it("should accept a valid vote and return receipt", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({
          nullifier_hash: "abc123def456",
          choice_index: 0,
        });

      expect(res.status).toBe(200);
      expect(res.body.accepted).toBe(true);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.vote_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.receipt.nullifier).toBe("abc123def456");
      expect(res.body.receipt.chain_position).toBe(1);
      expect(res.body.receipt.previous_hash).toBeDefined();
      expect(res.body.receipt.timestamp).toBeDefined();
    });

    it("should record vote in hash chain", async () => {
      await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-1", choice_index: 0 });

      const chain = store.getChain(pollId)!;
      expect(chain.voteCount).toBe(1);
    });

    it("should reject double vote (same nullifier)", async () => {
      // First vote
      const first = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "same-nullifier", choice_index: 0 });

      expect(first.status).toBe(200);

      // Second vote with same nullifier
      const second = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "same-nullifier", choice_index: 1 });

      expect(second.status).toBe(409);
      expect(second.body.error).toBe("ALREADY_VOTED");
    });

    it("should allow different voters", async () => {
      const v1 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-1", choice_index: 0 });

      const v2 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-2", choice_index: 1 });

      const v3 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-3", choice_index: 2 });

      expect(v1.status).toBe(200);
      expect(v2.status).toBe(200);
      expect(v3.status).toBe(200);

      const chain = store.getChain(pollId)!;
      expect(chain.voteCount).toBe(3);
    });

    it("should return 404 for non-existent poll", async () => {
      const res = await request(app)
        .post("/v1/polls/poll_nonexistent/vote")
        .send({ nullifier_hash: "test", choice_index: 0 });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("POLL_NOT_FOUND");
    });

    it("should return 410 for closed poll", async () => {
      // Create a poll that already closed
      const closedPoll = store.createPoll({
        title: "Closed Poll",
        description: "",
        options: ["A", "B"],
        countryCode: "FR",
        closesAt: new Date(Date.now() - 86400000).toISOString(), // -24h (already closed)
      });

      const res = await request(app)
        .post(`/v1/polls/${closedPoll.id}/vote`)
        .send({ nullifier_hash: "test", choice_index: 0 });

      expect(res.status).toBe(410);
      expect(res.body.error).toBe("POLL_CLOSED");
    });

    it("should reject missing nullifier_hash", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ choice_index: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_NULLIFIER");
    });

    it("should reject empty nullifier_hash", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "  ", choice_index: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("INVALID_NULLIFIER");
    });

    it("should reject out-of-range choice_index", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "test", choice_index: 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject negative choice_index", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "test", choice_index: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject missing choice_index", async () => {
      const res = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should increment chain position for each vote", async () => {
      const v1 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-a", choice_index: 0 });

      const v2 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-b", choice_index: 1 });

      expect(v1.body.receipt.chain_position).toBe(1);
      expect(v2.body.receipt.chain_position).toBe(2);
    });

    it("should link votes via previous_hash", async () => {
      const v1 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-x", choice_index: 0 });

      const v2 = await request(app)
        .post(`/v1/polls/${pollId}/vote`)
        .send({ nullifier_hash: "voter-y", choice_index: 1 });

      // v2's previous_hash should be v1's vote_hash
      expect(v2.body.receipt.previous_hash).toBe(v1.body.receipt.vote_hash);
    });
  });
});
