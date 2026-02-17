/**
 * VoxPop API — Error Handling Middleware
 *
 * Centralized error handling for the Express API.
 *
 * @module api/middleware/error-handler
 * @license AGPL-3.0-or-later
 */

import { Request, Response, NextFunction } from "express";

/**
 * Custom API error class.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * 404 handler — catches unmatched routes.
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
}

/**
 * Global error handler — catches thrown errors.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: err.errorCode,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Log unexpected errors
  console.error("[VoxPop API] Unexpected error:", err);

  res.status(500).json({
    error: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
}
