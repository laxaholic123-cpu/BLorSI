/**
 * normalizePieces (client) — validates the pieces array received from the
 * board-scan API response before it is stored in component state.
 *
 * Rules:
 *  - hexIndex must be a number in 0–18.
 *  - color must be a non-empty string.
 *  - Any entry that fails validation is silently dropped.
 */

export interface DetectedPiece {
  hexIndex: number;
  color: string;
}

export function normalizePieces(raw: unknown): DetectedPiece[] {
  if (!Array.isArray(raw)) return [];

  const result: DetectedPiece[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const p = item as Record<string, unknown>;

    const rawIdx = p['hexIndex'];
    if (typeof rawIdx !== 'number') continue;
    const idx = Math.round(rawIdx);
    if (idx < 0 || idx > 18) continue;

    const color = p['color'];
    if (typeof color !== 'string' || color.trim().length === 0) continue;

    result.push({ hexIndex: idx, color: color.trim() });
  }

  return result;
}
