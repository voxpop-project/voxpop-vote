/**
 * VoxPop API — Rate Limiting Middleware
 *
 * Simple in-memory rate limiter for the MVP.
 * Tracks requests per IP address with configurable limits and windows.
 *
 * @module api/middleware/rate-limiter
 * @license AGPL-3.0-or-later
 */

import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterConfig {
  /** Maximum number of requests in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

/**
 * Creates a rate limiter middleware.
 *
 * @param config - Rate limiter configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // 10 requests per hour
 * router.use(createRateLimiter({ maxRequests: 10, windowMs: 3600000 }));
 * ```
 */
export function createRateLimiter(config: RateLimiterConfig) {
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup every 5 minutes to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Allow garbage collection of the interval if the process exits
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = store.get(key);

    // Create new entry or reset if window expired
    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + config.windowMs,
      };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    res.setHeader("X-RateLimit-Limit", config.maxRequests);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > config.maxRequests) {
      res.status(429).json({
        error: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
        details: {
          retry_after_ms: entry.resetAt - now,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Pre-configured rate limiters matching the API design spec.
 */
export const rateLimiters = {
  /** Vote submission: 3 requests per minute */
  vote: createRateLimiter({ maxRequests: 3, windowMs: 60 * 1000 }),

  /** Poll creation: 10 requests per hour */
  pollCreate: createRateLimiter({ maxRequests: 10, windowMs: 60 * 60 * 1000 }),

  /** Read endpoints: 100 requests per minute */
  read: createRateLimiter({ maxRequests: 100, windowMs: 60 * 1000 }),

  /** Verification: 50 requests per minute */
  verify: createRateLimiter({ maxRequests: 50, windowMs: 60 * 1000 }),
};
