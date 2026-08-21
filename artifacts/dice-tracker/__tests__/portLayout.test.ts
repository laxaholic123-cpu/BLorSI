/**
 * Unit tests for the transcribed harbour layout.
 *
 * `STANDARD_PORT_LAYOUT` was read off a physical board rather than derived, so
 * these tests exist to stop it drifting back into something merely plausible.
 * The previous placeholder passed every structural check — right count, right
 * spacing, all coastal — and was still wrong, because its TYPES alternated in a
 * pattern no real nine-harbour frame can have. So the order is pinned here
 * explicitly, not just the shape.
 */

import {
  STANDARD_PORT_LAYOUT,
  PORT_COUNT,
  PORT_TYPE_COUNTS,
  getCoastalEdgesClockwise,
  validatePortLayout,
  isCoastalEdge,
  intersectionIdsForPort,
} from '../services/catanBoard';

const walk = getCoastalEdgesClockwise();
const walkIndex = new Map(walk.map((w, i) => [`${w.hexIndex}:${w.edge}`, i]));

const inWalkOrder = () =>
  [...STANDARD_PORT_LAYOUT]
    .map(p => ({ ...p, w: walkIndex.get(`${p.hexIndex}:${p.edge}`)! }))
    .sort((a, b) => a.w - b.w);

describe('the layout is legal', () => {
  it('passes port validation', () => {
    expect(validatePortLayout(STANDARD_PORT_LAYOUT)).toEqual([]);
  });

  it('has nine harbours, every one on a coastal edge', () => {
    expect(STANDARD_PORT_LAYOUT).toHaveLength(PORT_COUNT);
    for (const p of STANDARD_PORT_LAYOUT) {
      expect(isCoastalEdge(p.hexIndex, p.edge)).toBe(true);
      expect(walkIndex.has(`${p.hexIndex}:${p.edge}`)).toBe(true);
    }
  });

  it('uses four 3:1 and one 2:1 per resource', () => {
    const counts: Record<string, number> = {};
    for (const p of STANDARD_PORT_LAYOUT) counts[p.type] = (counts[p.type] ?? 0) + 1;
    expect(counts).toEqual({ ...PORT_TYPE_COUNTS });
  });

  it('never puts two harbours on one settlement corner', () => {
    // Adjacent harbours would let one settlement claim both trade rates.
    const corners = STANDARD_PORT_LAYOUT.flatMap(p => intersectionIdsForPort(p));
    expect(new Set(corners).size).toBe(corners.length);
  });
});

describe('spacing around the coast', () => {
  it('separates harbours by three or four coastal edges', () => {
    const sorted = inWalkOrder();
    const gaps = sorted.map((p, i) => {
      const next = sorted[(i + 1) % sorted.length]!;
      return (next.w - p.w + walk.length) % walk.length;
    });
    expect(gaps.reduce((a, b) => a + b, 0)).toBe(walk.length);
    expect(Math.min(...gaps)).toBe(3);
    expect(Math.max(...gaps)).toBe(4);
  });
});

describe('the transcribed order', () => {
  it('matches the board it was read from, clockwise from the ore-4 harbour', () => {
    // Reported as: 3:1, 2:1 brick, 2:1 lumber, 3:1, 2:1 grain, 2:1 ore, 3:1,
    // 2:1 wool, 3:1 — starting above the ore 4 (hex 18).
    const sorted = inWalkOrder();
    const start = sorted.findIndex(p => p.hexIndex === 18 && p.edge === 3);
    expect(start).toBeGreaterThanOrEqual(0);

    const clockwise = [...sorted.slice(start), ...sorted.slice(0, start)].map(p => p.type);
    expect(clockwise).toEqual([
      'generic', 'brick', 'lumber', 'generic', 'grain',
      'ore', 'generic', 'wool', 'generic',
    ]);
  });

  it('does not alternate tidily, which is how the placeholder gave itself away', () => {
    // Four generic and five specific around nine positions cannot alternate
    // perfectly — an odd cycle forces at least one same-type neighbour. The
    // placeholder sat exactly at that minimum, which is the tell: it was
    // constructed to look even rather than transcribed. The real frame has
    // three same-type pairs (two 2:1 runs, plus a 3:1 meeting a 3:1 on the
    // wrap), because harbours were placed to suit the island, not a pattern.
    const sorted = inWalkOrder();
    const start = sorted.findIndex(p => p.hexIndex === 18 && p.edge === 3);
    const types = [...sorted.slice(start), ...sorted.slice(0, start)]
      .map(p => (p.type === 'generic' ? 'G' : 'S'));

    let sameNeighbours = 0;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === types[(i + 1) % types.length]) sameNeighbours++;
    }
    expect(sameNeighbours).toBe(3);
    // Read clockwise from the ore-4 harbour, which is the order it was
    // transcribed in. Walk order is a rotation of this and reads differently.
    expect(types.join('')).toBe('GSSGSSGSG');
  });
});
