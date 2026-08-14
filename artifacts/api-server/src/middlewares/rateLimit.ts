/**
 * Minimal fixed-window rate limiter.
 *
 * The board-scan route forwards every request to a paid vision model, so an
 * unthrottled public endpoint is a direct route into the project's AI bill.
 * This is deliberately hand-rolled rather than pulling in a dependency: there is
 * exactly one route to protect, the logic is small enough to audit at a glance,
 * and it keeps the server's supply-chain surface at zero new packages.
 *
 * Limitations, stated plainly:
 *  - In-memory, so the budget is per process. Behind multiple instances each one
 *    enforces its own window. Fine for a single server; swap in a shared store
 *    if this is ever scaled horizontally.
 *  - Keyed on remote address. Behind a proxy, set `trust proxy` on the Express
 *    app so req.ip reflects the real client rather than the proxy.
 */

import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests permitted per key per window. */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit({ windowMs, max }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  // Drop expired buckets periodically so a stream of unique addresses cannot
  // grow the map without bound. unref() keeps this timer from holding the
  // process open during shutdown or tests.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  if (typeof sweeper.unref === "function") sweeper.unref();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many scans. Please wait a moment and try again." });
      return;
    }

    next();
  };
}
