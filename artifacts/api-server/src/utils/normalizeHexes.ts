/**
 * normalizeHexes — validates and normalises the raw AI response into exactly
 * 19 well-typed hex definitions.
 *
 * Rules enforced:
 *  - Result is always a 19-element array indexed 0–18.
 *  - Missing indices are filled with resource:null, number:null, confidence:'low'.
 *  - Only known resource strings are accepted; anything else becomes null.
 *  - Only legal Catan number tokens (2–12 excl. 7) are accepted; anything else becomes null.
 *  - Desert hexes always have number:null regardless of what the AI returned.
 *  - confidence is 'high' only when the AI explicitly said so.
 */

export interface NormalizedHex {
  index: number;
  resource: string | null;
  number: number | null;
  confidence: "high" | "low";
}

export const VALID_RESOURCES = new Set([
  "grain",
  "ore",
  "lumber",
  "brick",
  "wool",
  "desert",
]);

export const VALID_NUMBERS = new Set([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

export function normalizeHexes(rawHexes: unknown): NormalizedHex[] {
  // Initialise all 19 slots as unknown / low-confidence
  const result: NormalizedHex[] = Array.from({ length: 19 }, (_, i) => ({
    index: i,
    resource: null,
    number: null,
    confidence: "low",
  }));

  if (!Array.isArray(rawHexes)) return result;

  for (const item of rawHexes) {
    if (typeof item !== "object" || item === null) continue;
    const h = item as Record<string, unknown>;

    const rawIdx = h["index"];
    if (typeof rawIdx !== "number") continue;
    const idx = Math.round(rawIdx);
    if (idx < 0 || idx > 18) continue;

    const rawResource = h["resource"];
    const resource =
      typeof rawResource === "string" && VALID_RESOURCES.has(rawResource)
        ? rawResource
        : null;

    // Desert tiles must not carry a number token
    const isDesert = resource === "desert";
    const rawNumber = h["number"];
    const number =
      !isDesert &&
      typeof rawNumber === "number" &&
      VALID_NUMBERS.has(rawNumber)
        ? rawNumber
        : null;

    const confidence = h["confidence"] === "high" ? "high" : "low";

    result[idx] = { index: idx, resource, number, confidence };
  }

  return result;
}
