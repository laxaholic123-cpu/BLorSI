import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(cors());
// 20 MB limit to accommodate base64-encoded board photos
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

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
