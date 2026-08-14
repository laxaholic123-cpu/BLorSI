/**
 * Board geometry and port layout tests.
 *
 * The coastal-edge set is derived from axial coordinates rather than written
 * down, so these tests exist to pin the derivation against facts about the
 * physical board: 19 hexes, 12 of them on the perimeter, 30 coastal edges,
 * 9 ports.
 */

import {
  ALL_EDGES,
  COASTAL_EDGE_COUNT,
  EDGE_OFFSETS,
  HEX_AXIAL,
  HEX_COUNT,
  PORT_COUNT,
  STANDARD_PORT_LAYOUT,
  axialToIndex,
  describePort,
  getCoastalEdgesClockwise,
  getNeighborIndex,
  isCoastalEdge,
  portsForHex,
  validatePortLayout,
} from '@/services/catanBoard';
import type { CatanPortDef, HexEdge } from '@/types/models';

describe('board coordinates', () => {
  it('has 19 hexes', () => {
    expect(HEX_AXIAL).toHaveLength(HEX_COUNT);
  });

  it('lays out rows of 3-4-5-4-3', () => {
    const byRow = new Map<number, number>();
    for (const { r } of HEX_AXIAL) byRow.set(r, (byRow.get(r) ?? 0) + 1);
    expect([-2, -1, 0, 1, 2].map(r => byRow.get(r))).toEqual([3, 4, 5, 4, 3]);
  });

  it('stays inside a radius-2 hexagon', () => {
    for (const { q, r } of HEX_AXIAL) {
      expect(Math.abs(q)).toBeLessThanOrEqual(2);
      expect(Math.abs(r)).toBeLessThanOrEqual(2);
      expect(Math.abs(q + r)).toBeLessThanOrEqual(2);
    }
  });

  it('has no duplicate coordinates', () => {
    const keys = new Set(HEX_AXIAL.map(a => `${a.q},${a.r}`));
    expect(keys.size).toBe(HEX_COUNT);
  });

  it('round-trips index → axial → index', () => {
    for (let i = 0; i < HEX_COUNT; i++) {
      const a = HEX_AXIAL[i]!;
      expect(axialToIndex(a.q, a.r)).toBe(i);
    }
  });

  it('returns null for coordinates off the board', () => {
    expect(axialToIndex(3, 0)).toBeNull();
    expect(axialToIndex(0, -3)).toBeNull();
    expect(axialToIndex(-1, -2)).toBeNull(); // |q+r| = 3
  });
});

describe('adjacency', () => {
  it('is symmetric — if A neighbours B across an edge, B neighbours A', () => {
    for (let i = 0; i < HEX_COUNT; i++) {
      for (const edge of ALL_EDGES) {
        const neighbor = getNeighborIndex(i, edge);
        if (neighbor === null) continue;
        // The opposing edge is three steps around the hex.
        const opposite = ((edge + 3) % 6) as HexEdge;
        expect(getNeighborIndex(neighbor, opposite)).toBe(i);
      }
    }
  });

  it('gives the centre hex six neighbours', () => {
    const centre = axialToIndex(0, 0)!;
    const neighbors = ALL_EDGES.map(e => getNeighborIndex(centre, e));
    expect(neighbors.every(n => n !== null)).toBe(true);
  });

  it('uses six distinct edge offsets', () => {
    const keys = new Set(EDGE_OFFSETS.map(o => `${o.q},${o.r}`));
    expect(keys.size).toBe(6);
  });
});

describe('coastal edges', () => {
  it('totals 30 across the whole board', () => {
    let count = 0;
    for (let i = 0; i < HEX_COUNT; i++) {
      for (const edge of ALL_EDGES) if (isCoastalEdge(i, edge)) count++;
    }
    expect(count).toBe(COASTAL_EDGE_COUNT);
  });

  it('leaves the seven interior hexes with no sea frontage', () => {
    const interior = [4, 5, 8, 9, 10, 13, 14];
    for (const i of interior) {
      for (const edge of ALL_EDGES) {
        expect(isCoastalEdge(i, edge)).toBe(false);
      }
    }
  });

  it('gives corner hexes three coastal edges and side hexes two', () => {
    const corners = [0, 2, 7, 11, 16, 18];
    const sides = [1, 3, 6, 12, 15, 17];
    const coastalCount = (i: number) => ALL_EDGES.filter(e => isCoastalEdge(i, e)).length;
    for (const i of corners) expect(coastalCount(i)).toBe(3);
    for (const i of sides) expect(coastalCount(i)).toBe(2);
  });

  it('walks all 30 edges clockwise without repeating one', () => {
    const walk = getCoastalEdgesClockwise();
    expect(walk).toHaveLength(COASTAL_EDGE_COUNT);
    const keys = new Set(walk.map(e => `${e.hexIndex}:${e.edge}`));
    expect(keys.size).toBe(COASTAL_EDGE_COUNT);
  });

  it('only visits edges that actually face the sea', () => {
    for (const { hexIndex, edge } of getCoastalEdgesClockwise()) {
      expect(isCoastalEdge(hexIndex, edge)).toBe(true);
    }
  });

  it('rejects an out-of-range hex index', () => {
    expect(isCoastalEdge(-1, 0)).toBe(false);
    expect(isCoastalEdge(19, 0)).toBe(false);
  });
});

describe('STANDARD_PORT_LAYOUT', () => {
  it('has nine ports', () => {
    expect(STANDARD_PORT_LAYOUT).toHaveLength(PORT_COUNT);
  });

  it('places every port on a coastal edge', () => {
    for (const port of STANDARD_PORT_LAYOUT) {
      expect(isCoastalEdge(port.hexIndex, port.edge)).toBe(true);
    }
  });

  it('matches the game\'s component counts', () => {
    expect(validatePortLayout(STANDARD_PORT_LAYOUT)).toEqual([]);
  });

  it('spreads ports across distinct hexes', () => {
    const hexes = new Set(STANDARD_PORT_LAYOUT.map(p => p.hexIndex));
    expect(hexes.size).toBe(PORT_COUNT);
  });
});

describe('validatePortLayout', () => {
  const valid = () => STANDARD_PORT_LAYOUT.map(p => ({ ...p }));

  it('rejects a port on an inland edge', () => {
    const ports = valid();
    ports[0] = { hexIndex: 9, edge: 0, type: 'generic' }; // centre hex
    const problems = validatePortLayout(ports);
    expect(problems.some(p => p.kind === 'not_coastal')).toBe(true);
  });

  it('rejects two ports sharing an edge', () => {
    const ports = valid();
    ports[1] = { ...ports[0]!, type: ports[1]!.type };
    const problems = validatePortLayout(ports);
    expect(problems.some(p => p.kind === 'duplicate_edge')).toBe(true);
  });

  it('rejects the wrong number of ports', () => {
    const problems = validatePortLayout(valid().slice(0, 8));
    expect(problems.some(p => p.kind === 'wrong_count')).toBe(true);
  });

  it('rejects two 2:1 ports for the same resource', () => {
    const ports = valid();
    const oreIndex = ports.findIndex(p => p.type === 'ore');
    const woolIndex = ports.findIndex(p => p.type === 'wool');
    ports[woolIndex] = { ...ports[woolIndex]!, type: 'ore' };
    expect(oreIndex).toBeGreaterThanOrEqual(0);
    const problems = validatePortLayout(ports);
    expect(problems.some(p => p.kind === 'wrong_count')).toBe(true);
  });

  it('accepts a rearranged but legal layout', () => {
    // Same nine port types, moved to different coastal edges.
    const coastal = getCoastalEdgesClockwise();
    const types = STANDARD_PORT_LAYOUT.map(p => p.type);
    const rearranged: CatanPortDef[] = types.map((type, i) => ({
      hexIndex: coastal[i * 3]!.hexIndex,
      edge: coastal[i * 3]!.edge,
      type,
    }));
    expect(validatePortLayout(rearranged)).toEqual([]);
  });
});

describe('portsForHex', () => {
  it('finds the port on a hex that has one', () => {
    const found = portsForHex(STANDARD_PORT_LAYOUT, STANDARD_PORT_LAYOUT[0]!.hexIndex);
    expect(found).toHaveLength(1);
  });

  it('returns nothing for an interior hex', () => {
    expect(portsForHex(STANDARD_PORT_LAYOUT, 9)).toHaveLength(0);
  });
});

describe('describePort', () => {
  it('renders trade rates the way the board prints them', () => {
    expect(describePort('generic')).toBe('3:1 any');
    expect(describePort('ore')).toBe('2:1 ore');
  });
});
