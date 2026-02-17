/**
 * Tests for Poll Routes
 *
 * Covers:
 * - List polls (with filters & pagination)
 * - Create polls (with validation)
 * - Get poll details
 * - Get poll results with tally
 */

import request from "supertest";
import { createTestApp } from "../../src/api/server";
import { Express } from "express";
import { VoxPopStore } from "../../src/api/store";

describe("Poll Routes", () => {
  let app: Express;
  let store: VoxPopStore;

  beforeEach(() => {
    const test = createTestApp();
    app = test.app;
    store = test.store;
  });

  // ============================================================
  // POST /v1/polls — Create Poll
  // ============================================================

  describe("POST /v1/polls", () => {
    const validPoll = {
      title: "Should we invest in renewable energy?",
      description: "Municipal energy plan 2026-2030.",
      options: ["Yes", "No", "Abstain"],
      country: "FR",
      closes_at: new Date(Date.now() + 86400000).toISOString(), // +24h
    };

    it("should create a poll and return 201", async () => {
      const res = await request(app).post("/v1/polls").send(validPoll);

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(/^poll_/);
      expect(res.body.status).toBe("active");
      expect(res.body.created_at).toBeDefined();
    });

    it("should reject missing title", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({ ...validPoll, title: "" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject fewer than 2 options", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({ ...validPoll, options: ["Only one"] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject missing country", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({ ...validPoll, country: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject missing closes_at", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({ ...validPoll, closes_at: undefined });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should reject invalid date format", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({ ...validPoll, closes_at: "not-a-date" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("should accept custom settings", async () => {
      const res = await request(app)
        .post("/v1/polls")
        .send({
          ...validPoll,
          settings: { anonymous: false, require_zkp: false },
        });

      expect(res.status).toBe(201);
    });
  });

  // ============================================================
  // GET /v1/polls — List Polls
  // ============================================================

  describe("GET /v1/polls", () => {
    beforeEach(() => {
      // Create some test polls
      store.createPoll({
        title: "Poll FR 1",
        description: "",
        options: ["A", "B"],
        countryCode: "FR",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
      store.createPoll({
        title: "Poll BE 1",
        description: "",
        options: ["A", "B"],
        countryCode: "BE",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
      store.createPoll({
        title: "Poll FR 2",
        description: "",
        options: ["A", "B"],
        countryCode: "FR",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    });

    it("should list all polls", async () => {
      const res = await request(app).get("/v1/polls");

      expect(res.status).toBe(200);
      expect(res.body.polls).toHaveLength(3);
      expect(res.body.pagination.total).toBe(3);
    });

    it("should filter by country", async () => {
      const res = await request(app).get("/v1/polls?country=FR");

      expect(res.status).toBe(200);
      expect(res.body.polls).toHaveLength(2);
      expect(res.body.polls.every((p: any) => p.countryCode === "FR")).toBe(true);
    });

    it("should filter by status", async () => {
      const res = await request(app).get("/v1/polls?status=active");

      expect(res.status).toBe(200);
      expect(res.body.polls.every((p: any) => p.status === "active")).toBe(true);
    });

    it("should paginate results", async () => {
      const res = await request(app).get("/v1/polls?page=1&limit=2");

      expect(res.status).toBe(200);
      expect(res.body.polls).toHaveLength(2);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.total).toBe(3);
    });

    it("should return empty for page out of range", async () => {
      const res = await request(app).get("/v1/polls?page=100");

      expect(res.status).toBe(200);
      expect(res.body.polls).toHaveLength(0);
    });
  });

  // ============================================================
  // GET /v1/polls/:id — Get Poll Details
  // ============================================================

  describe("GET /v1/polls/:id", () => {
    it("should return poll details", async () => {
      const poll = store.createPoll({
        title: "Test Poll",
        description: "A test poll",
        options: ["Yes", "No"],
        countryCode: "FR",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const res = await request(app).get(`/v1/polls/${poll.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(poll.id);
      expect(res.body.title).toBe("Test Poll");
      expect(res.body.options).toEqual(["Yes", "No"]);
      expect(res.body.country).toBe("FR");
      expect(res.body.total_votes).toBe(0);
      expect(res.body.settings).toBeDefined();
    });

    it("should return 404 for non-existent poll", async () => {
      const res = await request(app).get("/v1/polls/poll_nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("POLL_NOT_FOUND");
    });
  });

  // ============================================================
  // GET /v1/polls/:id/results — Get Results
  // ============================================================

  describe("GET /v1/polls/:id/results", () => {
    it("should return results with tally", async () => {
      const poll = store.createPoll({
        title: "Results Test",
        description: "",
        options: ["Yes", "No", "Abstain"],
        countryCode: "FR",
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });

      // Add some votes
      const chain = store.getChain(poll.id)!;
      chain.addVote("nullifier-1", 0); // Yes
      chain.addVote("nullifier-2", 0); // Yes
      chain.addVote("nullifier-3", 1); // No

      const res = await request(app).get(`/v1/polls/${poll.id}/results`);

      expect(res.status).toBe(200);
      expect(res.body.poll_id).toBe(poll.id);
      expect(res.body.total_votes).toBe(3);
      expect(res.body.results).toHaveLength(3);
      expect(res.body.results[0].votes).toBe(2); // Yes
      expect(res.body.results[0].percentage).toBe(66.7);
      expect(res.body.results[1].votes).toBe(1); // No
      expect(res.body.results[2].votes).toBe(0); // Abstain
      expect(res.body.hash_chain).toBeDefined();
      expect(res.body.hash_chain.valid).toBe(true);
    });

    it("should return 404 for non-existent poll", async () => {
      const res = await request(app).get("/v1/polls/poll_fake/results");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("POLL_NOT_FOUND");
    });
  });
});
