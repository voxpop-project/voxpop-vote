/**
 * Tests for Audit Routes
 *
 * Covers:
 * - Vote verification by hash
 * - Full audit trail
 * - Chain integrity reporting
 * - Edge cases (missing poll, empty chain)
 */

import request from "supertest";
import { createTestApp } from "../../src/api/server";
import { Express } from "express";
import { VoxPopStore } from "../../src/api/store";

describe("Audit Routes", () => {
  let app: Express;
  let store: VoxPopStore;
  let pollId: string;

  beforeEach(() => {
    const test = createTestApp();
    app = test.app;
    store = test.store;

    // Create a test poll with some votes
    const poll = store.createPoll({
      title: "Audit Test Poll",
      description: "Testing audit",
      options: ["Yes", "No", "Abstain"],
      countryCode: "FR",
      closesAt: new Date(Date.now() + 86400000).toISOString(),
    });
    pollId = poll.id;

    // Add votes via chain directly
    const chain = store.getChain(pollId)!;
    chain.addVote("nullifier-1", 0);
    chain.addVote("nullifier-2", 0);
    chain.addVote("nullifier-3", 1);
    chain.addVote("nullifier-4", 2);
  });

  // ============================================================
  // GET /v1/polls/:id/verify/:vote_hash — Verify a vote
  // ============================================================

  describe("GET /v1/polls/:id/verify/:vote_hash", () => {
    it("should verify an existing vote", async () => {
      const chain = store.getChain(pollId)!;
      const block = chain.getBlock(1)!; // First vote

      const res = await request(app).get(
        `/v1/polls/${pollId}/verify/${block.hash}`
      );

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.position).toBe(1);
      expect(res.body.vote_hash).toBe(block.hash);
      expect(res.body.previous_hash).toBeDefined();
      expect(res.body.next_hash).toBeDefined(); // Block 2 exists
      expect(res.body.timestamp).toBeDefined();
    });

    it("should return next_hash as null for latest vote", async () => {
      const chain = store.getChain(pollId)!;
      const latest = chain.getLatestBlock();

      const res = await request(app).get(
        `/v1/polls/${pollId}/verify/${latest.hash}`
      );

      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.next_hash).toBeNull();
    });

    it("should return 404 for non-existent vote hash", async () => {
      const res = await request(app).get(
        `/v1/polls/${pollId}/verify/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("VOTE_NOT_FOUND");
    });

    it("should not verify genesis block as a vote", async () => {
      const chain = store.getChain(pollId)!;
      const genesis = chain.getBlock(0)!;

      const res = await request(app).get(
        `/v1/polls/${pollId}/verify/${genesis.hash}`
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("VOTE_NOT_FOUND");
    });

    it("should return 404 for non-existent poll", async () => {
      const res = await request(app).get(
        "/v1/polls/poll_fake/verify/somehash"
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("POLL_NOT_FOUND");
    });
  });

  // ============================================================
  // GET /v1/polls/:id/audit — Full audit trail
  // ============================================================

  describe("GET /v1/polls/:id/audit", () => {
    it("should return full audit trail", async () => {
      const res = await request(app).get(`/v1/polls/${pollId}/audit`);

      expect(res.status).toBe(200);
      expect(res.body.poll_id).toBe(pollId);
      expect(res.body.audit).toBeDefined();
      expect(res.body.audit.total_votes).toBe(4);
      expect(res.body.audit.total_blocks).toBe(5); // 4 votes + genesis
      expect(res.body.audit.hash_chain_valid).toBe(true);
      expect(res.body.audit.first_invalid_block).toBe(-1);
      expect(res.body.audit.duplicate_nullifiers_detected).toBe(0);
      expect(res.body.audit.merkle_tree_consistent).toBe(true);
      expect(res.body.audit.genesis_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.audit.latest_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.verification_error).toBeNull();
    });

    it("should report correct stats for empty poll", async () => {
      const emptyPoll = store.createPoll({
        title: "Empty Poll",
        description: "",
        options: ["A", "B"],
        countryCode: "DE",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const res = await request(app).get(`/v1/polls/${emptyPoll.id}/audit`);

      expect(res.status).toBe(200);
      expect(res.body.audit.total_votes).toBe(0);
      expect(res.body.audit.total_blocks).toBe(1); // Genesis only
      expect(res.body.audit.hash_chain_valid).toBe(true);
    });

    it("should return 404 for non-existent poll", async () => {
      const res = await request(app).get("/v1/polls/poll_fake/audit");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("POLL_NOT_FOUND");
    });
  });
});
