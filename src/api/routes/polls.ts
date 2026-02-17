/**
 * VoxPop API — Poll Routes
 *
 * CRUD operations for polls (voting sessions).
 *
 * Endpoints:
 * - GET  /v1/polls       — List polls (with filters & pagination)
 * - POST /v1/polls       — Create a new poll
 * - GET  /v1/polls/:id   — Get poll details
 * - GET  /v1/polls/:id/results — Get poll results with tally
 *
 * @module api/routes/polls
 * @license AGPL-3.0-or-later
 */

import { Router, Request, Response } from "express";
import { VoxPopStore, PollStatus } from "../store";

export function createPollRoutes(store: VoxPopStore): Router {
  const router = Router();

  // --------------------------------------------------------
  // GET /v1/polls — List polls
  // --------------------------------------------------------
  router.get("/", (req: Request, res: Response) => {
    const { country, status, page, limit } = req.query;

    const result = store.listPolls({
      country: country as string | undefined,
      status: status as PollStatus | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    res.json({
      polls: result.polls,
      pagination: {
        page: parseInt((page as string) || "1", 10),
        limit: parseInt((limit as string) || "20", 10),
        total: result.total,
      },
    });
  });

  // --------------------------------------------------------
  // POST /v1/polls — Create a new poll
  // --------------------------------------------------------
  router.post("/", (req: Request, res: Response) => {
    const { title, description, options, country, closes_at, settings } =
      req.body;

    // Validation
    if (!title || typeof title !== "string" || title.trim() === "") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Title is required.",
      });
      return;
    }

    if (!options || !Array.isArray(options) || options.length < 2) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "At least 2 options are required.",
      });
      return;
    }

    if (!country || typeof country !== "string") {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Country code is required (ISO 3166-1 alpha-2).",
      });
      return;
    }

    if (!closes_at) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "closes_at date is required (ISO 8601).",
      });
      return;
    }

    const closesAtDate = new Date(closes_at);
    if (isNaN(closesAtDate.getTime())) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "closes_at must be a valid ISO 8601 date.",
      });
      return;
    }

    try {
      const poll = store.createPoll({
        title: title.trim(),
        description: (description || "").trim(),
        options,
        countryCode: country,
        closesAt: closes_at,
        settings: {
          anonymous: settings?.anonymous,
          requireZkp: settings?.require_zkp,
        },
      });

      res.status(201).json({
        id: poll.id,
        status: poll.status,
        created_at: poll.createdAt,
      });
    } catch (error) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message:
          error instanceof Error ? error.message : "Failed to create poll.",
      });
    }
  });

  // --------------------------------------------------------
  // GET /v1/polls/:id — Get poll details
  // --------------------------------------------------------
  router.get("/:id", (req: Request, res: Response) => {
    const poll = store.getPoll(req.params.id);

    if (!poll) {
      res.status(404).json({
        error: "POLL_NOT_FOUND",
        message: "Poll does not exist.",
      });
      return;
    }

    const chain = store.getChain(poll.id);

    res.json({
      id: poll.id,
      title: poll.title,
      description: poll.description,
      options: poll.options,
      country: poll.countryCode,
      status: poll.status,
      created_at: poll.createdAt,
      closes_at: poll.closesAt,
      total_votes: chain?.voteCount ?? 0,
      settings: {
        anonymous: poll.settings.anonymous,
        require_zkp: poll.settings.requireZkp,
      },
    });
  });

  // --------------------------------------------------------
  // GET /v1/polls/:id/results — Get poll results + tally
  // --------------------------------------------------------
  router.get("/:id/results", (req: Request, res: Response) => {
    const poll = store.getPoll(req.params.id);

    if (!poll) {
      res.status(404).json({
        error: "POLL_NOT_FOUND",
        message: "Poll does not exist.",
      });
      return;
    }

    const chain = store.getChain(poll.id);
    if (!chain) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Hash chain not found for this poll.",
      });
      return;
    }

    const tally = chain.tally();
    const totalVotes = chain.voteCount;
    const stats = chain.getStats();

    const results = poll.options.map((option, index) => {
      const votes = tally.get(index) || 0;
      return {
        option,
        index,
        votes,
        percentage: totalVotes > 0 ? +((votes / totalVotes) * 100).toFixed(1) : 0,
      };
    });

    res.json({
      poll_id: poll.id,
      status: poll.status,
      results,
      total_votes: totalVotes,
      hash_chain: {
        genesis_hash: stats.genesisHash,
        latest_hash: stats.latestHash,
        length: stats.totalBlocks,
        valid: chain.verify().isValid,
      },
      closes_at: poll.closesAt,
    });
  });

  return router;
}
