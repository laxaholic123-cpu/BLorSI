/**
 * POST /api/board-scan/analyze
 *
 * Accepts a base64-encoded board photo, passes it to OpenAI vision,
 * and returns a validated 19-hex layout (resource + number per hex).
 *
 * Input validation:
 *   - imageBase64 must be present and ≤ ~15 MB decoded (≈ 20 MB base64)
 *   - mimeType must be a supported image type
 *
 * Response normalisation (via normalizeHexes):
 *   - Always returns exactly 19 hex entries indexed 0–18
 *   - Unknown / invalid AI values are coerced to null with confidence:'low'
 */

import { Router } from "express";
import OpenAI from "openai";
import { normalizeHexes } from "../utils/normalizeHexes.js";
import { normalizePieces } from "../utils/normalizePieces.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * Vision model to call.
 *
 * Previously hardcoded to a model only reachable through Replit's AI gateway,
 * which made the whole feature undeployable anywhere else. Both the model and
 * the base URL are configuration now, so the server can point at Replit's
 * gateway, the OpenAI API directly, or any compatible proxy.
 */
const MODEL = process.env.BOARD_SCAN_MODEL ?? "gpt-4o";

/**
 * How long to wait on the vision model before giving up.
 *
 * Without this the request hangs until the client's own timeout, which is what
 * left players stranded on the "Reading the board…" spinner with no way out.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.BOARD_SCAN_TIMEOUT_MS ?? 45_000);

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
  timeout: REQUEST_TIMEOUT_MS,
  maxRetries: 1,
});

/**
 * Every request here costs real money at the vision provider, so the endpoint is
 * throttled per client. Generous enough that a player correcting a bad scan
 * several times in a row never notices; tight enough that a scripted caller
 * cannot run up a bill.
 */
const scanRateLimit = rateLimit({
  windowMs: Number(process.env.BOARD_SCAN_RATE_WINDOW_MS ?? 60_000),
  max: Number(process.env.BOARD_SCAN_RATE_MAX ?? 10),
});

// ─── Constants ────────────────────────────────────────────────────────────────

/** Accepted MIME types for the board photo. */
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Max base64 string length ≈ 20 MB (decodes to ≤ 15 MB of image data).
 * OpenAI's recommended limit for vision detail:"high" is ~20 MB per image.
 */
const MAX_BASE64_LENGTH = 20 * 1024 * 1024;

// ─── Prompt ───────────────────────────────────────────────────────────────────

const ANALYZE_PROMPT = `You are analyzing a photo of a Catan board game.

The board has 19 hexagonal tiles arranged in a standard 3-4-5-4-3 pattern:
- Row 1 (top, 3 tiles):    hexes 0, 1, 2  — left to right
- Row 2 (4 tiles):          hexes 3, 4, 5, 6
- Row 3 (middle, 5 tiles): hexes 7, 8, 9, 10, 11
- Row 4 (4 tiles):          hexes 12, 13, 14, 15
- Row 5 (bottom, 3 tiles): hexes 16, 17, 18

Respond with ONLY a valid JSON object with exactly two keys — no markdown fences, no explanation:

1. "hexes" — array of 19 objects, one per tile (index 0–18):
   {"index": 0, "resource": "grain", "number": 6, "confidence": "high"}
   - resource: one of "grain" (wheat), "ore" (mountains), "lumber" (forest), "brick" (hills), "wool" (pasture), "desert"
   - number: the circular number token (2–12), or null for desert / not visible
   - confidence: "high" if clearly visible, "low" if uncertain
   Tile counts: 1 desert, 4 grain, 3 ore, 4 lumber, 3 brick, 4 wool.
   Token counts: 2×1, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12×1.
   Use null for resource or number if genuinely undetectable.

2. "pieces" — array of any visible player settlement or city pieces on the board.
   For each visible piece: {"hexIndex": 7, "color": "#E32B2B"}
   - hexIndex: which of the 19 hex tiles (0–18) the piece sits on or adjacent to
   - color: the approximate color of the piece as a CSS hex string (e.g. "#FF0000" for red, "#2255CC" for blue)
   Return an empty array [] if no player pieces are visible.

Example response format:
{"hexes": [{"index":0,"resource":"grain","number":6,"confidence":"high"}, ...], "pieces": [{"hexIndex":7,"color":"#E32B2B"}]}`;

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/analyze", scanRateLimit, async (req, res, next) => {
  const startedAt = Date.now();
  try {
    const { imageBase64, mimeType = "image/jpeg" } = req.body as {
      imageBase64?: unknown;
      mimeType?: unknown;
    };

    // ── Input validation ────────────────────────────────────────────────────

    if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    if (imageBase64.length > MAX_BASE64_LENGTH) {
      res.status(413).json({ error: "Image too large (max ~15 MB)" });
      return;
    }

    const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
    if (!ALLOWED_MIME_TYPES.has(mime)) {
      res
        .status(400)
        .json({
          error: `Unsupported image type '${mime}'. Accepted: jpeg, png, webp, gif`,
        });
      return;
    }

    // ── OpenAI call ─────────────────────────────────────────────────────────

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: ANALYZE_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    // ── Parse & normalise response ──────────────────────────────────────────

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // The raw model output goes to the log, not the response — it is
      // unbounded, attacker-influenceable text and the client has no use for it.
      logger.warn({ model: MODEL, rawPreview: raw.slice(0, 500) }, "Board scan returned invalid JSON");
      res.status(422).json({ error: "The board scan could not be read. Try another photo." });
      return;
    }

    // Support both the new object format { hexes, pieces } and the legacy
    // plain-array format (in case a cached/older client sends the old prompt).
    const parsedObj =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const rawHexes = Array.isArray(parsedObj["hexes"])
      ? parsedObj["hexes"]
      : Array.isArray(parsed)
        ? parsed          // legacy: AI returned a plain hex array
        : [];
    const rawPieces = parsedObj["pieces"] ?? [];

    const hexes = normalizeHexes(rawHexes);
    const pieces = normalizePieces(rawPieces);

    // Usage and latency per scan, so cost is something you can watch on a
    // dashboard rather than discover on an invoice.
    logger.info(
      {
        model: MODEL,
        durationMs: Date.now() - startedAt,
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
        piecesDetected: pieces.length,
      },
      "Board scan complete",
    );

    res.json({ hexes, pieces });
  } catch (err) {
    // A timeout or upstream outage is an expected failure mode here, not a bug.
    // Translate it into something the client can show instead of a bare 500.
    if (err instanceof OpenAI.APIConnectionTimeoutError) {
      logger.warn({ model: MODEL, durationMs: Date.now() - startedAt }, "Board scan timed out");
      res.status(504).json({ error: "The board scan took too long. Try again, or enter the board by hand." });
      return;
    }
    next(err);
  }
});

export default router;
