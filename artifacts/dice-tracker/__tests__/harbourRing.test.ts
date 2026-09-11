/**
 * The ring constraint — the thing that took harbour positions from "11 to 22
 * noisy blobs" to 90/90 across ten captures.
 *
 * The tests that matter are the structural ones: the family of legal rings is
 * exactly what the coast allows, and a strong false positive cannot drag the
 * answer off a ring because no legal ring contains it.
 */

import {
  COASTAL_RING,
  edgeKey,
  legalRings,
  selectRing,
} from '@/services/vision/harbourRing';
import { PORT_COUNT, COASTAL_EDGE_COUNT, isCoastalEdge } from '@/services/catanBoard';

/** The nine harbours on the reference board, recovered from pixels. */
const TRUTH: [number, number][] = [
  [0, 0], [1, 1], [3, 5], [6, 1], [11, 2], [12, 5], [15, 3], [16, 4], [17, 3],
];

describe('the coastal ring', () => {
  it('is every coastal edge, once', () => {
    expect(COASTAL_RING).toHaveLength(COASTAL_EDGE_COUNT);
    const keys = new Set(COASTAL_RING.map(s => edgeKey(s.hexIndex, s.edge)));
    expect(keys.size).toBe(COASTAL_EDGE_COUNT);
  });

  it('contains only edges that actually face the sea', () => {
    for (const s of COASTAL_RING) {
      expect(isCoastalEdge(s.hexIndex, s.edge)).toBe(true);
    }
  });
});

describe('legalRings', () => {
  const rings = legalRings();

  it('every ring places exactly nine harbours', () => {
    for (const r of rings) expect(r).toHaveLength(PORT_COUNT);
  });

  it('every ring uses gaps of only 3 or 4', () => {
    for (const r of rings) {
      for (let i = 0; i < r.length; i++) {
        const gap = (r[(i + 1) % r.length]! - r[i]! + COASTAL_EDGE_COUNT) % COASTAL_EDGE_COUNT;
        expect([3, 4]).toContain(gap);
      }
    }
  });

  it('every ring uses exactly six 3s and three 4s', () => {
    // Nine gaps summing to 30 with each in {3,4} admits no other split, which
    // is what makes the family small enough to search exhaustively.
    for (const r of rings) {
      const gaps: number[] = [];
      for (let i = 0; i < r.length; i++) {
        gaps.push((r[(i + 1) % r.length]! - r[i]! + COASTAL_EDGE_COUNT) % COASTAL_EDGE_COUNT);
      }
      expect(gaps.filter(g => g === 3)).toHaveLength(6);
      expect(gaps.filter(g => g === 4)).toHaveLength(3);
      expect(gaps.reduce((a, b) => a + b, 0)).toBe(COASTAL_EDGE_COUNT);
    }
  });

  it('has no duplicates, and there are 280 of them', () => {
    const keys = new Set(rings.map(r => r.join(',')));
    expect(keys.size).toBe(rings.length);
    expect(rings).toHaveLength(280);
  });

  it('includes the real board', () => {
    const truthPositions = TRUTH
      .map(([h, e]) => COASTAL_RING.findIndex(s => s.hexIndex === h && s.edge === e))
      .sort((a, b) => a - b);
    expect(truthPositions).not.toContain(-1);
    expect(rings.some(r => r.join(',') === truthPositions.join(','))).toBe(true);
  });
});

describe('selectRing', () => {
  const perfect = () => {
    const m = new Map<string, number>();
    for (const [h, e] of TRUTH) m.set(edgeKey(h, e), 1);
    return m;
  };

  const key = (s: { hexIndex: number; edge: number }) => `${s.hexIndex}:${s.edge}`;
  const TRUTH_KEYS = TRUTH.map(([h, e]) => `${h}:${e}`).sort();

  it('recovers the board from clean evidence', () => {
    const got = selectRing(perfect());
    expect(got.slots.map(key).sort()).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('ignores false positives, because no legal ring can contain them', () => {
    // Dock timbers and glare, scoring lower than real badges as they do in the
    // photos. Adding them must not move the answer.
    const m = perfect();
    m.set(edgeKey(2, 0), 0.55);
    m.set(edgeKey(7, 4), 0.5);
    m.set(edgeKey(2, 2), 0.4);
    const got = selectRing(m);
    expect(got.slots.map(key).sort()).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('recovers a harbour whose badge only FAINTLY registered', () => {
    // Glare washes a badge out to almost nothing. "Almost" is the whole game:
    // 0.05 at the true edge beats 0 at the edge next to it, and that is what
    // picks the right split. This is why the detector scores every coastal
    // edge on a falloff instead of emitting only confident hits.
    const m = perfect();
    m.set(edgeKey(15, 3), 0.05);
    const got = selectRing(m);
    expect(got.slots.map(key).sort()).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('recovers a harbour MISSED entirely, where the coast allows one placement', () => {
    // Its neighbours are 6 apart, and 6 splits only as 3+3, so the gap has
    // exactly one legal filling. Here the structure really does recover a
    // harbour the pixels never showed.
    const m = perfect();
    m.delete(edgeKey(0, 0));
    const got = selectRing(m);
    expect(got.slots.map(key).sort()).toEqual(TRUTH_KEYS);
    expect(got.unsure).toEqual([]);
  });

  it('ADMITS when a missed harbour could sit in either of two places', () => {
    /*
      The honest limit. Around this harbour the neighbours are 7 apart, and 7
      splits as 3+4 or 4+3 — two legal rings, exactly tied, with nothing left to
      separate them. Earlier versions of this test asserted the right answer
      came back anyway; it only ever did so by accident of enumeration order.

      What the selector owes us is not a guess but an admission: eight harbours
      it is sure of, one it is not, and a margin of zero saying so.
    */
    const m = perfect();
    m.delete(edgeKey(15, 3));
    const got = selectRing(m);

    expect(got.margin).toBe(0);
    expect(got.unsure).toHaveLength(1);
    // The eight it never doubted are still exactly right.
    const sure = got.slots.map(key).filter(k => !got.unsure.map(key).includes(k));
    expect(sure.sort()).toEqual(TRUTH_KEYS.filter(k => k !== '15:3'));
  });

  it('has six of nine harbours in an ambiguous span, on this board', () => {
    /*
      Measured, not assumed, and pinned here because it is the number that
      decides the detector's design. If a harbour scores exactly zero, the ring
      constraint alone recovers it only when its neighbours are 6 apart. Six of
      the nine here are 7 apart, so zero-evidence harbours are unrecoverable two
      times out of three — hence dense graded scoring over all thirty edges.
    */
    let ambiguous = 0;
    for (const [h, e] of TRUTH) {
      const m = perfect();
      m.delete(edgeKey(h, e));
      if (selectRing(m).unsure.length > 0) ambiguous++;
    }
    expect(ambiguous).toBe(6);
  });

  it('reports a MARGIN, so a coin-toss read can be shown as one', () => {
    expect(selectRing(perfect()).margin).toBeGreaterThan(0);

    // Evidence on every edge equally: every ring scores the same, so nothing
    // was decided and the margin must say so.
    const flat = new Map<string, number>();
    for (const s of COASTAL_RING) flat.set(edgeKey(s.hexIndex, s.edge), 0.5);
    expect(selectRing(flat).margin).toBe(0);
  });

  it('still returns a legal ring when there is no evidence at all', () => {
    const empty = selectRing(new Map());
    expect(empty.slots).toHaveLength(PORT_COUNT);
    expect(empty.score).toBe(0);
    // Nothing was decided, so nothing is claimed: all nine are flagged.
    expect(empty.unsure).toHaveLength(PORT_COUNT);
    for (const s of empty.slots) expect(isCoastalEdge(s.hexIndex, s.edge)).toBe(true);
  });
});
