/**
 * Unit tests for settlement-corner geometry.
 *
 * These matter more than they look. Exposure entry now derives a player's
 * numbers from whichever hexes the tapped corner touches, so a wrong corner
 * mapping does not throw — it silently credits a player with production they
 * never had, and every luck figure downstream inherits the error. That is the
 * exact failure mode this repo keeps running into, so the mapping is pinned
 * from several directions rather than spot-checked.
 */

import {
  getAllIntersections,
  getLandIntersections,
  intersectionIdAt,
  intersectionIdsForPort,
  hexesAtIntersection,
  hexesForIntersectionId,
  portForIntersection,
  getNeighborIndex,
  isCoastalEdge,
  STANDARD_PORT_LAYOUT,
  HEX_COUNT,
  ALL_EDGES,
} from '../services/catanBoard';
import { generateBoard } from '../services/boardGenerator';

describe('corner enumeration', () => {
  const all = getAllIntersections();

  it('finds 54 corners', () => {
    // A radius-2 hex board has 54 settlement spots. This is the number every
    // Catan player knows, which makes it a good independent check.
    expect(all).toHaveLength(54);
  });

  it('gives every corner between one and three hexes', () => {
    for (const ix of all) {
      expect(ix.hexIndices.length).toBeGreaterThanOrEqual(1);
      expect(ix.hexIndices.length).toBeLessThanOrEqual(3);
    }
  });

  it('has exactly 24 three-hex corners, matching getLandIntersections', () => {
    const triples = all.filter(ix => ix.hexIndices.length === 3);
    expect(triples).toHaveLength(getLandIntersections().length);

    // Interior corners are the one case where the hex set IS unique, so the
    // two enumerations can be compared that way.
    const fromAll = new Set(triples.map(ix => ix.hexIndices.join('-')));
    const fromLand = new Set(getLandIntersections().map(ix => ix.hexIndices.join('-')));
    expect(fromAll).toEqual(fromLand);
  });

  it('gives every corner a unique id', () => {
    expect(new Set(all.map(ix => ix.id)).size).toBe(all.length);
    for (const ix of all) {
      expect([...ix.hexIndices].sort((a, b) => a - b)).toEqual(ix.hexIndices);
    }
  });

  it('does not identify corners by their hex set', () => {
    // The regression this file exists for. Several coastal corners touch the
    // same hexes as each other — three outer vertices of hex 0 touch only hex
    // 0 — so keying on the hex set silently merges distinct board positions.
    // 54 unique ids against 48 unique hex sets is the proof it no longer does.
    const bySet = new Set(all.map(ix => ix.hexIndices.join('-')));
    expect(bySet.size).toBeLessThan(all.length);
    expect(all.length).toBe(54);
  });
});

describe('corner identity is consistent from every hex that touches it', () => {
  it('agrees no matter which hex you ask from', () => {
    // The rule that makes the id canonical: three hexes meeting at a corner
    // must all name it identically, or a settlement placed from one hex would
    // be a different location than the same settlement placed from another.
    for (let hexIndex = 0; hexIndex < HEX_COUNT; hexIndex++) {
      for (let vertex = 0; vertex < 6; vertex++) {
        const id = intersectionIdAt(hexIndex, vertex);
        const hexes = hexesAtIntersection(hexIndex, vertex);
        expect(hexes).toContain(hexIndex);

        for (const other of hexes) {
          // Somewhere on `other` there is a vertex naming this same corner.
          const matches: string[] = [];
          for (let v = 0; v < 6; v++) matches.push(intersectionIdAt(other, v));
          expect(matches).toContain(id);
        }
      }
    }
  });

  it('only lists hexes that are genuinely adjacent to each other', () => {
    for (const ix of getAllIntersections()) {
      for (const a of ix.hexIndices) {
        for (const b of ix.hexIndices) {
          if (a === b) continue;
          const neighbours = ALL_EDGES.map(e => getNeighborIndex(a, e));
          expect(neighbours).toContain(b);
        }
      }
    }
  });
});

describe('harbour to corner mapping', () => {
  it('gives each harbour two distinct corners, both on its own hex', () => {
    for (const port of STANDARD_PORT_LAYOUT) {
      const [a, b] = intersectionIdsForPort(port);
      expect(a).not.toBe(b);
      for (const id of [a, b]) {
        expect(hexesForIntersectionId(id)).toContain(port.hexIndex);
      }
    }
  });

  it('places harbour corners on the coast, never inland', () => {
    // A harbour serving a corner with three land hexes would be a harbour in
    // the middle of the island.
    for (const port of STANDARD_PORT_LAYOUT) {
      expect(isCoastalEdge(port.hexIndex, port.edge)).toBe(true);
      for (const id of intersectionIdsForPort(port)) {
        expect(hexesForIntersectionId(id).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('finds the harbour back from either of its corners', () => {
    for (const port of STANDARD_PORT_LAYOUT) {
      for (const id of intersectionIdsForPort(port)) {
        expect(portForIntersection(id, STANDARD_PORT_LAYOUT)).toBe(port.type);
      }
    }
  });

  it('reports no harbour for a corner that has none', () => {
    const ported = new Set(STANDARD_PORT_LAYOUT.flatMap(p => intersectionIdsForPort(p)));
    const bare = getAllIntersections().find(ix => !ported.has(ix.id))!;
    expect(portForIntersection(bare.id, STANDARD_PORT_LAYOUT)).toBeUndefined();
  });
});

describe('numbers derived from a tapped corner', () => {
  // This mirrors exactly what catan-exposure-quick does on a corner tap.
  const numbersAt = (id: string, hexes: ReturnType<typeof generateBoard>['hexes']) =>
    hexesForIntersectionId(id)
      .map(h => hexes[h]?.number ?? null)
      .filter((n): n is number => n !== null);

  it('never yields more numbers than the corner has hexes', () => {
    const { hexes } = generateBoard({ seed: 31, candidates: 20 });
    for (const ix of getAllIntersections()) {
      expect(numbersAt(ix.id, hexes).length).toBeLessThanOrEqual(ix.hexIndices.length);
      expect(numbersAt(ix.id, hexes).length).toBeLessThanOrEqual(3);
    }
  });

  it('drops the desert, which carries no token', () => {
    const { hexes } = generateBoard({ seed: 31, desert: 'center', candidates: 20 });
    const desertIndex = hexes.findIndex(h => h.resource === 'desert');
    const touching = getAllIntersections().filter(ix => ix.hexIndices.includes(desertIndex));
    expect(touching.length).toBeGreaterThan(0);
    for (const ix of touching) {
      // One fewer number than hexes, because the desert contributes nothing.
      expect(numbersAt(ix.id, hexes)).toHaveLength(ix.hexIndices.length - 1);
    }
  });

  it('yields no numbers at all for a corner touching only the desert', () => {
    // Real and reachable whenever the desert is randomised onto the outer ring.
    // Such a corner is still a settlement someone owns, which is why exposure
    // entry tracks board placements by position rather than by production — a
    // barren corner used to be unmarkable, unremovable, and duplicated on every
    // further tap.
    const lone = getAllIntersections().find(ix => ix.hexIndices.length === 1)!;
    expect(lone).toBeDefined();

    const desertHex = lone.hexIndices[0]!;
    const painted = Array.from({ length: 19 }, (_, i) => ({
      index: i,
      resource: (i === desertHex ? 'desert' : 'wool') as 'desert' | 'wool',
      number: i === desertHex ? null : 5,
      confidence: 'high' as const,
    }));

    expect(numbersAt(lone.id, painted)).toEqual([]);
  });

  it('keeps duplicates when two hexes at a corner share a token', () => {
    // A corner between two 9s produces twice on a 9. Collapsing that to a set
    // would under-report the player's exposure — the same bug the number pad's
    // multiset rule exists to avoid.
    const { hexes } = generateBoard({ numbers: 'random', seed: 5, candidates: 1 });
    const dupCorner = getAllIntersections().find(ix => {
      const ns = numbersAt(ix.id, hexes);
      return new Set(ns).size < ns.length;
    });
    if (dupCorner) {
      const ns = numbersAt(dupCorner.id, hexes);
      expect(ns.length).toBeGreaterThan(new Set(ns).size);
    }
    // If this seed happens to produce no duplicate corner the test above is
    // vacuous rather than wrong, so assert the mechanism directly too, on a
    // corner known to touch three hexes.
    const triple = getAllIntersections().find(ix => ix.hexIndices.length === 3)!;
    const painted = Array.from({ length: 19 }, (_, i) => ({
      index: i,
      resource: 'wool' as const,
      number: triple.hexIndices.includes(i) ? 9 : 5,
      confidence: 'high' as const,
    }));
    expect(numbersAt(triple.id, painted)).toEqual([9, 9, 9]);
  });
});
