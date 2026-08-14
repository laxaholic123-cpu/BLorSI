import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "../rateLimit.js";

/** Minimal Express req/res doubles — enough for the limiter's surface. */
const makeReq = (ip: string): Request => ({ ip, socket: {} } as unknown as Request);

const makeRes = () => {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response & typeof res, headers };
};

describe("rateLimit", () => {
  it("allows requests up to the limit", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 3 });
    const next = vi.fn() as unknown as NextFunction;

    for (let i = 0; i < 3; i++) {
      const { res } = makeRes();
      limiter(makeReq("1.1.1.1"), res, next);
    }

    expect(next).toHaveBeenCalledTimes(3);
  });

  it("rejects the request past the limit with 429", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 2 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq("2.2.2.2"), makeRes().res, next);
    limiter(makeReq("2.2.2.2"), makeRes().res, next);
    const { res } = makeRes();
    limiter(makeReq("2.2.2.2"), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: expect.stringContaining("Too many scans") });
  });

  it("budgets each client address separately", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;

    limiter(makeReq("3.3.3.3"), makeRes().res, next);
    limiter(makeReq("4.4.4.4"), makeRes().res, next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("refills once the window has elapsed", () => {
    vi.useFakeTimers();
    try {
      const limiter = rateLimit({ windowMs: 1000, max: 1 });
      const next = vi.fn() as unknown as NextFunction;

      limiter(makeReq("5.5.5.5"), makeRes().res, next);
      const blocked = makeRes();
      limiter(makeReq("5.5.5.5"), blocked.res, next);
      expect(blocked.res.statusCode).toBe(429);

      vi.advanceTimersByTime(1001);

      const allowed = makeRes();
      limiter(makeReq("5.5.5.5"), allowed.res, next);
      expect(allowed.res.statusCode).toBe(200);
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("advertises the remaining budget", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 5 });
    const next = vi.fn() as unknown as NextFunction;

    const { res, headers } = makeRes();
    limiter(makeReq("6.6.6.6"), res, next);

    expect(headers["RateLimit-Limit"]).toBe("5");
    expect(headers["RateLimit-Remaining"]).toBe("4");
  });

  it("falls back to the socket address when req.ip is absent", () => {
    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    const next = vi.fn() as unknown as NextFunction;
    const req = { socket: { remoteAddress: "7.7.7.7" } } as unknown as Request;

    limiter(req, makeRes().res, next);
    const { res } = makeRes();
    limiter(req, res, next);

    expect(res.statusCode).toBe(429);
  });
});
