/**
 * VoxPop API — Vote Routes
 *
 * Handles vote submission with ZKP verification and hash chain recording.
 *
 * Endpoints:
 * - POST /v1/polls/:id/vote — Cast a vote with ZKP proof
 *
 * @module api/routes/votes
 * @license AGPL-3.0-or-later
 */

import { Router, Request, Response } from "express";
import { VoxPopStore } from "../store";

/**
 * Vote submission request body.
 *
 * In the full implementation, this will contain the actual Semaphore proof
 * (pi_a, pi_b, pi_c). For the MVP, we accept a simplified format with
 * a nullifier hash and choice index, optionally with a proof object.
 */
interface VoteRequest {
  /** The nullifier hash (prevents double voting) */
  nullifier_hash: string;
  /** The index of the chosen option (0-based) */
  choice_index: number;
  /** Optional: full Semaphore proof (for future ZKP verification) */
  proof?: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
  };
  /** Optional: Merkle tree root (for future group membership verification) */
  merkle_tree_root?: string;
}

export function createVoteRoutes(store: VoxPopStore): Router {
  const router = Router();

  // --------------------------------------------------------
  // POST /v1/polls/:id/vote — Cast a vote
  // --------------------------------------------------------
  router.post("/:id/vote", async (req: Request, res: Response) => {
    const pollId = req.params.id;
    const { nullifier_hash, choice_index, proof } = req.body as VoteRequest;

    // 1. Check poll exists
    const poll = store.getPoll(pollId);
    if (!poll) {
      res.status(404).json({
        error: "POLL_NOT_FOUND",
        message: "Poll does not exist.",
      });
      return;
    }

    // 2. Check poll is active
    if (poll.status === "closed") {
      res.status(410).json({
        error: "POLL_CLOSED",
        message: "This poll is no longer accepting votes.",
      });
      return;
    }

    // 3. Validate nullifier_hash
    if (!nullifier_hash || typeof nullifier_hash !== "string" || nullifier_hash.trim() === "") {
      res.status(400).json({
        error: "INVALID_NULLIFIER",
        message: "A valid nullifier_hash is required.",
      });
      return;
    }

    // 4. Validate choice_index
    if (
      choice_index === undefined ||
      choice_index === null ||
      !Number.isInteger(choice_index) ||
      choice_index < 0 ||
      choice_index >= poll.options.length
    ) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: `choice_index must be an integer between 0 and ${poll.options.length - 1}.`,
      });
      return;
    }

    // 5. Get the hash chain for this poll
    const chain = store.getChain(pollId);
    if (!chain) {
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Hash chain not found for this poll.",
      });
      return;
    }

    // 6. If ZKP is required and proof is provided, verify it
    //    (Full ZKP verification will be wired in Phase C/D)
    if (poll.settings.requireZkp && proof) {
      // TODO: Wire Semaphore verifyProof here
      // For MVP, we accept the proof object but skip cryptographic verification.
      // The hash chain still records the nullifier for double-vote prevention.
    }

    // 7. Add vote to hash chain (also checks for double voting via nullifier)
    const block = chain.addVote(nullifier_hash.trim(), choice_index);

    if (!block) {
      res.status(409).json({
        error: "ALREADY_VOTED",
        message: "A vote with this nullifier has already been recorded.",
      });
      return;
    }

    // 8. Return receipt
    res.status(200).json({
      accepted: true,
      receipt: {
        vote_hash: block.hash,
        nullifier: nullifier_hash,
        chain_position: block.index,
        previous_hash: block.previousHash,
        timestamp: block.timestamp,
      },
    });
  });

  return router;
}
