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

const router = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
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

For each hex (index 0-18), identify:
- resource: exactly one of "grain" (wheat fields), "ore" (mountains/rock), "lumber" (forest), "brick" (hills/clay), "wool" (pasture/sheep), "desert"
- number: the circular number token visible on the tile (2-12), or null if desert or the token is not visible
- confidence: "high" if clearly visible, "low" if uncertain or obscured

Catan tile counts for reference: 1 desert, 4 grain, 3 ore, 4 lumber, 3 brick, 4 wool.
Number token counts: 2×1, 3×2, 4×2, 5×2, 6×2, 8×2, 9×2, 10×2, 11×2, 12×1.

Respond with ONLY a valid JSON array — no markdown fences, no explanation, no extra text:
[{"index":0,"resource":"grain","number":6,"confidence":"high"},{"index":1,...},...]

Include all 19 hexes. Use null for resource or number if genuinely undetectable.`;

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/analyze", async (req, res, next) => {
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
      model: "gpt-5.6-luna",
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

    const raw = completion.choices[0]?.message?.content ?? "[]";
    let parsed: unknown;
    try {
      const cleaned = raw.replace(/```json\n?|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      res.status(422).json({ error: "AI returned invalid JSON", raw });
      return;
    }

    const hexes = normalizeHexes(parsed);
    res.json({ hexes });
  } catch (err) {
    next(err);
  }
});

export default router;
