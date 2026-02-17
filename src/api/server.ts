/**
 * VoxPop API — Express Server
 *
 * Assembles all routes, middleware, and starts the HTTP server.
 *
 * Usage:
 *   Development: npx ts-node src/api/server.ts
 *   Or import createApp() for testing without starting the listener.
 *
 * @module api/server
 * @license AGPL-3.0-or-later
 */

import express, { Express } from "express";
import cors from "cors";
import { createPollRoutes } from "./routes/polls";
import { createVoteRoutes } from "./routes/votes";
import { createAuditRoutes } from "./routes/audit";
import { notFoundHandler, errorHandler } from "./middleware/error-handler";
import { rateLimiters } from "./middleware/rate-limiter";
import { VoxPopStore, getStore, createStore } from "./store";

// ============================================================
// App Factory
// ============================================================

interface AppOptions {
  /** Optional store (defaults to singleton) */
  store?: VoxPopStore;
  /** Disable rate limiting (for testing) */
  disableRateLimiting?: boolean;
}

/**
 * Creates and configures the Express app.
 *
 * @param options - App configuration options
 * @returns Configured Express app
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const appStore = options.store ?? getStore();
  const useRateLimiting = !options.disableRateLimiting;

  // --------------------------------------------------------
  // Global Middleware
  // --------------------------------------------------------

  // Parse JSON bodies
  app.use(express.json());

  // CORS
  app.use(
    cors({
      origin: [
        "https://app.voxpop-app.com",
        "https://voxpop-app.com",
        "http://localhost:3000",
        "http://localhost:3001",
      ],
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
    })
  );

  // --------------------------------------------------------
  // Health Check
  // --------------------------------------------------------

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // --------------------------------------------------------
  // API v1 Routes
  // --------------------------------------------------------

  // Polls — CRUD
  if (useRateLimiting) app.use("/v1/polls", rateLimiters.read);
  app.use("/v1/polls", createPollRoutes(appStore));

  // Votes — Submit (rate limited separately per the design spec)
  if (useRateLimiting) app.use("/v1/polls", rateLimiters.vote);
  app.use("/v1/polls", createVoteRoutes(appStore));

  // Audit — Verification & audit trail
  if (useRateLimiting) app.use("/v1/polls", rateLimiters.verify);
  app.use("/v1/polls", createAuditRoutes(appStore));

  // --------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Creates a fresh app with a fresh store (for testing).
 */
export function createTestApp(): { app: Express; store: VoxPopStore } {
  const store = createStore();
  const app = createApp({ store, disableRateLimiting: true });
  return { app, store };
}

// ============================================================
// Start Server (only when run directly)
// ============================================================

const isDirectRun =
  require.main === module ||
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js");

if (isDirectRun) {
  const PORT = parseInt(process.env.PORT || "3001", 10);
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       🗳️  VoxPop API Server v0.1.0       ║
╠══════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}/v1      ║
║  Health:  http://localhost:${PORT}/health   ║
╠══════════════════════════════════════════╣
║  Routes:                                 ║
║  GET  /v1/polls           — List polls   ║
║  POST /v1/polls           — Create poll  ║
║  GET  /v1/polls/:id       — Poll detail  ║
║  POST /v1/polls/:id/vote  — Cast vote    ║
║  GET  /v1/polls/:id/results — Results    ║
║  GET  /v1/polls/:id/audit   — Audit      ║
║  GET  /v1/polls/:id/verify/:hash         ║
╚══════════════════════════════════════════╝
    `);
  });
}
