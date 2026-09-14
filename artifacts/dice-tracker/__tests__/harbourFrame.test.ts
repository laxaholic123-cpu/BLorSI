/**
 * Harbour positions come from the FRAME, not from anywhere on the coast.
 *
 * Reported from a device: under golden light the harbour positions came back
 * wrong, and "the location options for the port do not actually change and it
 * is painted on the board ring". Only the tokens move. The ring search that
 * shipped had 280 candidates to be fooled among and collapsed from 90/90 to
 * 48/90 under a simulated warm cast; the frame has two, and held 10/10 boards
 * under every cast (tools/light_probe.py).
 */

import { isCoastalEdge, PORT_COUNT, COASTAL_EDGE_COUNT } from '@/services/catanBoard';
import {
  COASTAL_RING,
  MIN_FRAME_MARGIN,
  edgeKey,
  framePositionSets,
  selectFrame,
} from '@/services/vision/harbourRing';

/** The reference board, read off ten captures. */
const TRUTH: [number, number][] = [
  [0, 0], [1, 1], [3, 5], [6, 1], [11, 2], [12, 5], [15, 3], [16, 4], [17, 3],
];
const TRUTH_KEYS = TRUTH.map(([h, e]) => `${h}:${e}`).sort();
const keys = (slots: { hexIndex: number; edge: number }[]) =>
  slots.map(s => `${s.hexIndex}:${s.edge}`).sort();

const evidenceFor = (pairs: [number, number][], score = 1) =>
  new Map(pairs.map(([h, e]) => [edgeKey(h, e), score]));

describe('framePositionSets', () => {
  const sets = framePositionSets();

  it('is exactly two sets of nine', () => {
    // Measured, and the whole reason this is robust: six rotations of the
    // painted frame collapse to two position sets.
    expect(sets).toHaveLength(2);
    for (const s of sets) expect(s).toHaveLength(PORT_COUNT);
  });

  it('shares no position between the two sets', () => {
    const a = new Set(sets[0]);
    expect(sets[1]!.filter(p => a.has(p))).toEqual([]);
  });

  it('puts every harbour on an edge that faces the sea', () => {
    for (const s of sets) {
      for (const p of s) {
        const slot = COASTAL_RING[p]!;
        expect(isCoastalEdge(slot.hexIndex, slot.edge)).toBe(true);
      }
    }
  });

  it('spaces harbours 3, 3, 4 around the coast', () => {
    for (const s of sets) {
      const gaps = s.map((p, i) => (s[(i + 1) % s.length]! - p + COASTAL_EDGE_COUNT) % COASTAL_EDGE_COUNT);
      expect([...gaps].sort()).toEqual([3, 3, 3, 3, 3, 3, 4, 4, 4]);
    }
  });

  it('contains the real board photographed in all ten captures', () => {
    const truthPositions = TRUTH
      .map(([h, e]) => COASTAL_RING.findIndex(s => s.hexIndex === h && s.edge === e))
      .sort((a, b) => a - b)
      .join(',');
    expect(sets.map(s => s.join(','))).toContain(truthPositions);
  });
});

describe('selectFrame', () => {
  it('reads the board from clean evidence, and says so', () => {
    const got = selectFrame(evidenceFor(TRUTH));
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.margin).toBeGreaterThanOrEqual(MIN_FRAME_MARGIN);
    expect(got.unsure).toEqual([]);
  });

  it('confirms from only a few badges — two candidates need little evidence', () => {
    // Golden light washed most of the badges out on the device. Three found is
    // enough to know which of two disjoint sets is on the table.
    const got = selectFrame(evidenceFor(TRUTH.slice(0, 3)));
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('picks the right set from ONE badge but does not claim it is confirmed', () => {
    // One badge does point at the right set — but a single blob could be a
    // dock timber, so the screen must not say "read" on that alone.
    const got = selectFrame(evidenceFor(TRUTH.slice(0, 1)));
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toHaveLength(PORT_COUNT);
  });

  it('marks ALL nine unsure when nothing was found, never a subset', () => {
    // With two disjoint candidates the question is which set, not which
    // harbour. Ringing three amber would imply the other six were known.
    const got = selectFrame(new Map());
    expect(got.margin).toBe(0);
    expect(got.unsure).toHaveLength(PORT_COUNT);
  });

  it('ignores a strong false positive on the other set', () => {
    const other = framePositionSets().find(
      s => s.join(',') !== TRUTH.map(([h, e]) => COASTAL_RING.findIndex(r => r.hexIndex === h && r.edge === e)).sort((a, b) => a - b).join(','),
    )!;
    const decoy = COASTAL_RING[other[0]!]!;
    const m = evidenceFor(TRUTH);
    m.set(edgeKey(decoy.hexIndex, decoy.edge), 1);
    const got = selectFrame(m);
    expect(keys(got.slots)).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });
});
