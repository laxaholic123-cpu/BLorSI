/**
 * normalizePieces — validates and normalises the raw AI piece-detection result.
 *
 * Rules enforced:
 *  - Only objects with a numeric hexIndex in 0–18 are kept.
 *  - color must be a non-empty string (CSS hex or name — validated by the client).
 *  - Duplicate hex indices are allowed (multiple pieces on the same hex).
 */

export interface DetectedPiece {
  hexIndex: number;
  color: string;
}

export function normalizePieces(raw: unknown): DetectedPiece[] {
  if (!Array.isArray(raw)) return [];

  const result: DetectedPiece[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;

    const rawIdx = p["hexIndex"];
    if (typeof rawIdx !== "number") continue;
    const idx = Math.round(rawIdx);
    if (idx < 0 || idx > 18) continue;

    const color = p["color"];
    if (typeof color !== "string" || color.trim().length === 0) continue;

    result.push({ hexIndex: idx, color: color.trim() });
  }

  return result;
}
