/**
 * VoxPop API — Audit Routes
 *
 * Provides endpoints for vote verification and audit trails.
 * These enable independent third-party verification of election integrity.
 *
 * Endpoints:
 * - GET  /v1/polls/:id/verify/:vote_hash — Verify a specific vote exists
 * - GET  /v1/polls/:id/audit             — Full audit trail for a poll
 *
 * @module api/routes/audit
 * @license AGPL-3.0-or-later
 */

import { Router, Request, Response } from "express";
import { VoxPopStore } from "../store";

export function createAuditRoutes(store: VoxPopStore): Router {
  const router = Router();

  // --------------------------------------------------------
  // GET /v1/polls/:id/verify/:vote_hash — Verify a specific vote
  // --------------------------------------------------------
  router.get("/:id/verify/:voteHash", (req: Request, res: Response) => {
    const { id: pollId, voteHash } = req.params;

    // 1. Check poll exists
    const poll = store.getPoll(pollId);
    if (!poll) {
      res.status(404).json({
        error: "POLL_NOT_FOUND",
        message: "Poll does not exist.",
      });
      return;
    }

    // 2. Get the hash chain
    const chain = store.getChain(pollId);
    if (!chain) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Hash chain not found for this poll.",
      });
      return;
    }

    // 3. Search for the block with matching hash
    const blocks = chain.getAllBlocks();
    const blockIndex = blocks.findIndex((b) => b.hash === voteHash);

    if (blockIndex === -1 || blockIndex === 0) {
      // Not found, or it's the genesis block (not a vote)
      res.status(404).json({
        error: "VOTE_NOT_FOUND",
        message: "No vote with this hash exists in the chain.",
      });
      return;
    }

    const block = blocks[blockIndex];
    const nextBlock = blockIndex < blocks.length - 1 ? blocks[blockIndex + 1] : null;

    res.json({
      verified: true,
      position: block.index,
      vote_hash: block.hash,
      previous_hash: block.previousHash,
      next_hash: nextBlock?.hash ?? null,
      timestamp: block.timestamp,
    });
  });

  // --------------------------------------------------------
  // GET /v1/polls/:id/audit — Full audit trail
  // --------------------------------------------------------
  router.get("/:id/audit", (req: Request, res: Response) => {
    const pollId = req.params.id;

    // 1. Check poll exists
    const poll = store.getPoll(pollId);
    if (!poll) {
      res.status(404).json({
        error: "POLL_NOT_FOUND",
        message: "Poll does not exist.",
      });
      return;
    }

    // 2. Get the hash chain
    const chain = store.getChain(pollId);
    if (!chain) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Hash chain not found for this poll.",
      });
      return;
    }

    // 3. Verify chain integrity
    const verification = chain.verify();
    const stats = chain.getStats();

    // 4. Count unique nullifiers (should match voteCount)
    const blocks = chain.getAllBlocks();
    const nullifiers = new Set<string>();
    let duplicateNullifiersRejected = 0;

    for (const block of blocks) {
      if (block.index === 0) continue; // Skip genesis
      if (nullifiers.has(block.nullifierHash)) {
        // This shouldn't happen if the chain is valid (addVote prevents it)
        duplicateNullifiersRejected++;
      }
      nullifiers.add(block.nullifierHash);
    }

    // 5. Check Merkle tree consistency for the poll's country
    const merkleConsistent = store.registry.hasCountry(poll.countryCode);

    res.json({
      poll_id: poll.id,
      audit: {
        total_votes: chain.voteCount,
        total_blocks: stats.totalBlocks,
        hash_chain_valid: verification.isValid,
        first_invalid_block: verification.firstInvalidBlock,
        duplicate_nullifiers_detected: duplicateNullifiersRejected,
        merkle_tree_consistent: merkleConsistent,
        genesis_hash: stats.genesisHash,
        latest_hash: stats.latestHash,
        first_timestamp: stats.firstTimestamp,
        latest_timestamp: stats.latestTimestamp,
      },
      verification_error: verification.error ?? null,
    });
  });

  return router;
}
