/**
 * Unit tests for the board reader diagnostics.
 *
 * These score the thing that decides what gets built next, so a scoring bug
 * would be worse than no scoring at all — it would send the next fix at the
 * wrong half of the pipeline with a number attached, which is more persuasive
 * than a hunch and no more correct.
 *
 * Delete alongside services/vision/diagnostics.ts.
 */

import {
  scoreReading,
  buildDiagnosticPayload,
  summariseForHumans,
  type ReadingSnapshot,
} from '../services/vision/diagnostics';
import type { CatanHexDef } from '../types/models';

const hex = (
  index: number,
  resource: CatanHexDef['resource'],
  number: number | null,
): CatanHexDef => ({ index, resource, number, confidence: 'high' });

/** A small but complete board: one desert, the rest wool 5. */
const truth: CatanHexDef[] = Array.from({ length: 19 }, (_, i) =>
  i === 9 ? hex(i, 'desert', null) : hex(i, 'wool', 5),
);

describe('scoreReading', () => {
  it('scores a perfect read as everything correct', () => {
    const s = scoreReading(truth, truth);
    expect(s.correct).toBe(19);
    expect(s.total).toBe(19);
    expect(s.resourceCorrect).toBe(19);
    expect(s.numberCorrect).toBe(19);
    expect(s.mismatches).toEqual([]);
  });

  it('separates a terrain error from a token error', () => {
    // The whole point of scoring the two axes apart: terrain comes from colour
    // and texture ranking, tokens from pip and hole counting. A read that gets
    // every terrain right and half the tokens wrong is a different bug from one
    // that gets neither, and a single combined score hides that completely.
    const got = [...truth];
    got[0] = hex(0, 'ore', 5); // terrain wrong, token right
    got[1] = hex(1, 'wool', 8); // terrain right, token wrong

    const s = scoreReading(got, truth);
    expect(s.correct).toBe(17);
    expect(s.resourceCorrect).toBe(18);
    expect(s.numberCorrect).toBe(18);

    const byIndex = Object.fromEntries(s.mismatches.map(m => [m.index, m]));
    expect(byIndex[0]!.wrong).toBe('resource');
    expect(byIndex[1]!.wrong).toBe('number');
  });

  it('marks a tile wrong on both axes as both', () => {
    const got = [...truth];
    got[3] = hex(3, 'brick', 11);
    const s = scoreReading(got, truth);
    expect(s.mismatches).toHaveLength(1);
    expect(s.mismatches[0]!.wrong).toBe('both');
    expect(s.mismatches[0]!.gotResource).toBe('brick');
    expect(s.mismatches[0]!.wantResource).toBe('wool');
  });

  it('counts a missing tile as wrong rather than skipping it', () => {
    // A read that returns fewer tiles must not score better than one that
    // returns them and gets them wrong.
    const got = truth.slice(0, 10);
    const s = scoreReading(got, truth);
    expect(s.correct).toBe(10);
    expect(s.total).toBe(19);
    expect(s.mismatches).toHaveLength(9);
  });

  it('treats the desert as a real answer, not as an absence', () => {
    // The desert legitimately has no token. Reading it as some other terrain
    // with no token is still wrong, and scoring must say so.
    const got = [...truth];
    got[9] = hex(9, 'wool', null);
    const s = scoreReading(got, truth);
    expect(s.correct).toBe(18);
    expect(s.mismatches[0]!.wrong).toBe('resource');
    expect(s.mismatches[0]!.wantNumber).toBeNull();
  });
});

describe('diagnostic payload', () => {
  const snapshot = (label: string, correct: number): ReadingSnapshot => ({
    label,
    corners: [
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
    ],
    hexes: truth.map(h => ({
      index: h.index, resource: h.resource, number: h.number, confidence: 'high',
    })),
    usable: true,
    coverage: 1,
    score: {
      correct, total: 19, resourceCorrect: correct, numberCorrect: correct, mismatches: [],
    },
  });

  it('carries everything needed to rerun the read offline', () => {
    const payload = buildDiagnosticPayload({
      bufferWidth: 1400,
      bufferHeight: 1050,
      groundTruth: truth,
      readings: [snapshot('guide corners', 8), snapshot('marked corners', 18)],
    });

    expect(payload.kind).toBe('board-reader-diagnostic');
    expect(payload.buffer).toEqual({ width: 1400, height: 1050 });
    expect(payload.groundTruth).toHaveLength(19);
    expect(payload.readings).toHaveLength(2);
    // Corners are normalised, so they survive any display size and can be
    // scaled back to pixels by tools/ without knowing the phone.
    for (const r of payload.readings) {
      expect(r.corners).toHaveLength(4);
      for (const c of r.corners) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1);
      }
    }
    // Must survive the round trip through the share sheet.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it('summarises both readings so the answer is visible without parsing JSON', () => {
    const payload = buildDiagnosticPayload({
      bufferWidth: 1400,
      bufferHeight: 1050,
      groundTruth: truth,
      readings: [snapshot('guide corners', 8), snapshot('marked corners', 18)],
    });
    const text = summariseForHumans(payload);
    expect(text).toContain('guide corners: 8/19');
    expect(text).toContain('marked corners: 18/19');
  });

  it('says so plainly when there is no ground truth to score against', () => {
    const bare = { ...snapshot('marked corners', 0) };
    delete (bare as { score?: unknown }).score;
    const payload = buildDiagnosticPayload({
      bufferWidth: 100, bufferHeight: 100, groundTruth: null, readings: [bare],
    });
    expect(payload.groundTruth).toBeNull();
    expect(summariseForHumans(payload)).toContain('no ground truth set');
  });

  it('reports an unusable read instead of scoring it as zero', () => {
    // Zero and "the board was not in frame" mean different things, and only one
    // of them is evidence about the reader.
    const payload = buildDiagnosticPayload({
      bufferWidth: 100,
      bufferHeight: 100,
      groundTruth: truth,
      readings: [{
        label: 'guide corners', corners: [], hexes: [],
        usable: false, coverage: 0, reason: 'Board not in view',
      }],
    });
    expect(summariseForHumans(payload)).toContain('unusable (Board not in view)');
  });
});
