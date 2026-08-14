import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// req.ip must reflect the real client, not the proxy, or the board-scan rate
// limiter would see every request as coming from a single address.
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

// Fail loudly at boot rather than on the first player's scan attempt.
if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  logger.warn(
    "AI_INTEGRATIONS_OPENAI_API_KEY is not set — POST /api/board-scan/analyze will fail. " +
      "Set it, along with AI_INTEGRATIONS_OPENAI_BASE_URL and BOARD_SCAN_MODEL if not using the OpenAI default.",
  );
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// The native app sends no Origin header, so restricting origins costs it
// nothing — it only stops arbitrary websites from spending your AI budget from
// a visitor's browser. Unset means allow all, which is the right default for
// local development and for the Expo web build served from another port.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",").map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins?.length ? { origin: allowedOrigins } : undefined));

// 20 MB limit to accommodate base64-encoded board photos
app.use(express.json({ limit: "20mb" }));
// No route consumes form encoding, and accepting 20 MB of it is free surface area.
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

// ─── JSON error handler ────────────────────────────────────────────────────────
// Must be registered after all routes. Express identifies error middleware by
// the four-argument signature (err, req, res, next). Without this, Express's
// default handler sends text/html, which the mobile client cannot JSON-parse.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status)
      : 500;
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : "Internal server error";
  logger.error({ err }, "Unhandled error");
  res.status(Number.isFinite(status) && status >= 100 ? status : 500).json({ error: message });
});

export default app;
