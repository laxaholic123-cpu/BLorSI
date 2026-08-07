import { describe, expect, it } from "vitest";
import { normalizeHexes } from "../normalizeHexes.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a single well-formed AI hex object. */
const h = (
  index: number,
  resource: string | null,
  number: number | null,
  confidence: "high" | "low" = "high"
) => ({ index, resource, number, confidence });

/** A fully-populated 19-hex array of valid AI output. */
function fullBoard(): ReturnType<typeof h>[] {
  const resources = [
    "grain",
    "ore",
    "lumber",
    "brick",
    "wool",
    "desert",
    "grain",
    "ore",
    "lumber",
    "brick",
    "wool",
    "grain",
    "ore",
    "lumber",
    "brick",
    "wool",
    "grain",
    "grain",
    "ore",
  ];
  const numbers = [
    2, 3, 4, 5, 6, null, 8, 9, 10, 11, 12, 3, 4, 5, 6, 8, 9, 10, 11,
  ];
  return resources.map((r, i) => h(i, r, numbers[i]!, "high"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("normalizeHexes", () => {
  describe("non-array input", () => {
    it("returns 19 low-confidence null slots for null", () => {
      const result = normalizeHexes(null);
      expect(result).toHaveLength(19);
      expect(result.every((r) => r.resource === null && r.number === null)).toBe(
        true
      );
      expect(result.every((r) => r.confidence === "low")).toBe(true);
    });

    it("returns 19 null slots for undefined", () => {
      expect(normalizeHexes(undefined)).toHaveLength(19);
    });

    it("returns 19 null slots for a plain string", () => {
      expect(normalizeHexes("not an array")).toHaveLength(19);
    });

    it("returns 19 null slots for an object", () => {
      expect(normalizeHexes({ index: 0, resource: "grain" })).toHaveLength(19);
    });
  });

  describe("valid full board", () => {
    it("preserves all 19 hexes with correct resource and number", () => {
      const result = normalizeHexes(fullBoard());
      expect(result).toHaveLength(19);
      expect(result[0]!.resource).toBe("grain");
      expect(result[0]!.number).toBe(2);
      expect(result[0]!.confidence).toBe("high");
    });

    it("preserves desert with null number even if AI sent one", () => {
      const board = fullBoard();
      // Desert is at index 5 — set a number on it to confirm it gets stripped
      board[5] = h(5, "desert", 9, "high");
      const result = normalizeHexes(board);
      expect(result[5]!.resource).toBe("desert");
      expect(result[5]!.number).toBe(null);
    });

    it("assigns indices correctly", () => {
      const result = normalizeHexes(fullBoard());
      result.forEach((hex, i) => expect(hex.index).toBe(i));
    });
  });

  describe("partial / malformed AI output", () => {
    it("fills missing indices with null / low-confidence", () => {
      // Only send hexes 0 and 18 — the rest should be empty
      const sparse = [h(0, "grain", 6), h(18, "ore", 3)];
      const result = normalizeHexes(sparse);
      expect(result[0]!.resource).toBe("grain");
      expect(result[18]!.resource).toBe("ore");
      // Middle hex should be null
      expect(result[9]!.resource).toBe(null);
      expect(result[9]!.confidence).toBe("low");
    });

    it("ignores items without a numeric index", () => {
      const result = normalizeHexes([{ resource: "grain", number: 5 }]);
      expect(result.every((r) => r.resource === null)).toBe(true);
    });

    it("ignores out-of-range indices", () => {
      const result = normalizeHexes([
        h(-1, "grain", 6),
        h(19, "ore", 9),
        h(100, "lumber", 4),
      ]);
      expect(result.every((r) => r.resource === null)).toBe(true);
    });

    it("rounds fractional indices", () => {
      const result = normalizeHexes([
        { index: 4.7, resource: "wool", number: 8, confidence: "high" },
      ]);
      expect(result[5]!.resource).toBe("wool");
    });

    it("ignores non-object array items", () => {
      const result = normalizeHexes([null, undefined, "string", 42, true]);
      expect(result.every((r) => r.resource === null)).toBe(true);
    });
  });

  describe("invalid resource / number values", () => {
    it("coerces unknown resource strings to null", () => {
      const result = normalizeHexes([h(0, "stone", 6)]);
      expect(result[0]!.resource).toBe(null);
    });

    it("coerces numeric resource to null", () => {
      const result = normalizeHexes([{ index: 0, resource: 42, number: 6 }]);
      expect(result[0]!.resource).toBe(null);
    });

    it("coerces 7 (illegal Catan number) to null", () => {
      const result = normalizeHexes([h(0, "grain", 7)]);
      expect(result[0]!.number).toBe(null);
    });

    it("coerces out-of-range number 1 to null", () => {
      const result = normalizeHexes([h(0, "grain", 1)]);
      expect(result[0]!.number).toBe(null);
    });

    it("coerces out-of-range number 13 to null", () => {
      const result = normalizeHexes([h(0, "grain", 13)]);
      expect(result[0]!.number).toBe(null);
    });

    it("coerces string number to null", () => {
      const result = normalizeHexes([
        { index: 0, resource: "grain", number: "6" },
      ]);
      expect(result[0]!.number).toBe(null);
    });

    it("accepts all 10 valid Catan numbers", () => {
      const validNums = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
      validNums.forEach((n) => {
        const result = normalizeHexes([h(0, "grain", n)]);
        expect(result[0]!.number).toBe(n);
      });
    });
  });

  describe("confidence", () => {
    it("preserves high confidence", () => {
      const result = normalizeHexes([h(0, "grain", 6, "high")]);
      expect(result[0]!.confidence).toBe("high");
    });

    it("defaults to low for anything other than 'high'", () => {
      const result = normalizeHexes([
        { index: 0, resource: "grain", number: 6, confidence: "medium" },
      ]);
      expect(result[0]!.confidence).toBe("low");
    });

    it("defaults to low when confidence is absent", () => {
      const result = normalizeHexes([{ index: 0, resource: "grain", number: 6 }]);
      expect(result[0]!.confidence).toBe("low");
    });
  });

  describe("duplicate indices", () => {
    it("last entry wins when the same index appears twice", () => {
      const result = normalizeHexes([
        h(0, "grain", 6, "high"),
        h(0, "ore", 9, "low"),
      ]);
      expect(result[0]!.resource).toBe("ore");
      expect(result[0]!.number).toBe(9);
    });
  });
});
