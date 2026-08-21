/**
 * Unit tests for the board generator.
 *
 * The interesting assertions here are statistical rather than exact. A
 * generator is not a function you can pin with one fixture — the question is
 * whether the knobs do what the label says, across many boards. The numbers
 * below were measured, not guessed, and the margins are wide enough to survive
 * ordinary variation while still failing if a toggle stops working.
 *
 * The strongest check is the cheapest: every generated board is fed to
 * `validateBoardComposition` and `validatePortLayout`, which were written
 * independently of the generator. A generator graded by its own assumptions
 * proves very little.
 */

import {
  generateBoard,
  buildOne,
  measureBoard,
  DEFAULT_GEN_OPTIONS,
  type BoardGenOptions,
} from '../services/boardGenerator';
import { validateBoardComposition } from '../services/boardConstraints';
import {
  validatePortLayout,
  getLandIntersections,
  getAdjacentHexPairs,
  getCoastalEdgesClockwise,
  COASTAL_EDGE_COUNT,
  PORT_COUNT,
  PORT_TYPE_COUNTS,
} from '../services/catanBoard';

const CANDIDATES = 120;
const RUNS = 25;

const boards = (opts: Partial<BoardGenOptions>, runs = RUNS) =>
  Array.from({ length: runs }, (_, i) =>
    generateBoard({ ...opts, seed: 5000 + i, candidates: CANDIDATES }),
  );

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ─── Geometry ─────────────────────────────────────────────────────────────────

describe('board geometry', () => {
  it('finds 24 three-hex intersections', () => {
    // A radius-2 hexagon has 54 corners; 24 of them touch three land hexes.
    // The rest are coastal and can never be the strongest spot on the board.
    expect(getLandIntersections()).toHaveLength(24);
  });

  it('finds 42 adjacent hex pairs, each listed once', () => {
    const pairs = getAdjacentHexPairs();
    expect(pairs).toHaveLength(42);
    const keys = new Set(pairs.map(p => p.join(',')));
    expect(keys.size).toBe(42);
    for (const [a, b] of pairs) expect(a).toBeLessThan(b);
  });

  it('agrees with the declared coastal edge count', () => {
    expect(getCoastalEdgesClockwise()).toHaveLength(COASTAL_EDGE_COUNT);
  });
});

// ─── Legality ─────────────────────────────────────────────────────────────────

describe('every generated board is legal', () => {
  it('passes independent composition validation, balanced and random alike', () => {
    const settings: Array<Partial<BoardGenOptions>> = [
      { numbers: 'balanced', resources: 'spread' },
      { numbers: 'random', resources: 'random' },
    ];
    for (const opts of settings) {
      for (const board of boards(opts)) {
        expect(validateBoardComposition(board.hexes)).toEqual([]);
      }
    }
  });

  it('passes independent port validation', () => {
    for (const board of boards({})) {
      expect(validatePortLayout(board.ports)).toEqual([]);
      expect(board.ports).toHaveLength(PORT_COUNT);
    }
  });

  it('keeps shuffled harbour positions coastal and non-overlapping', () => {
    // Rendering depends on this: a harbour on a non-coastal edge would draw
    // inside the island, and two on one edge would overlap. The default path
    // uses the fixed layout, so this is the only cover for the derived one.
    for (const board of boards({ portPositions: 'random' }, 15)) {
      expect(validatePortLayout(board.ports)).toEqual([]);
      const edges = new Set(board.ports.map(p => `${p.hexIndex}:${p.edge}`));
      expect(edges.size).toBe(PORT_COUNT);
    }
  });

  it('uses each port type exactly as many times as the box contains', () => {
    for (const board of boards({ portTypes: 'shuffled' }, 10)) {
      const counts: Record<string, number> = {};
      for (const p of board.ports) counts[p.type] = (counts[p.type] ?? 0) + 1;
      expect(counts).toEqual({ ...PORT_TYPE_COUNTS });
    }
  });

  it('gives the desert no number and every other hex one', () => {
    for (const board of boards({}, 10)) {
      for (const hex of board.hexes) {
        if (hex.resource === 'desert') expect(hex.number).toBeNull();
        else expect(typeof hex.number).toBe('number');
      }
    }
  });
});

// ─── Reproducibility ──────────────────────────────────────────────────────────

describe('reproducibility', () => {
  it('returns an identical board for the same seed and options', () => {
    const a = generateBoard({ seed: 99, candidates: 50 });
    const b = generateBoard({ seed: 99, candidates: 50 });
    expect(b).toEqual(a);
  });

  it('rebuilds the winning board from its reported seed alone', () => {
    // This is what makes a board shareable: the seed on screen is the seed that
    // produced the board, not the seed that started the search.
    const found = generateBoard({ seed: 12345, candidates: 200 });
    const rebuilt = buildOne(found.seed, DEFAULT_GEN_OPTIONS);
    expect(rebuilt.hexes).toEqual(found.hexes);
    expect(rebuilt.ports).toEqual(found.ports);
  });

  it('produces different boards for different seeds', () => {
    const a = generateBoard({ seed: 1, candidates: 50 });
    const b = generateBoard({ seed: 2, candidates: 50 });
    expect(b.hexes).not.toEqual(a.hexes);
  });
});

// ─── The toggles actually do something ────────────────────────────────────────

describe('balanced vs random numbers', () => {
  it('eliminates adjacent red numbers when balanced', () => {
    // Measured: 0.00 per board across 60 boards.
    const reds = boards({ numbers: 'balanced' }).map(b => b.metrics.redAdjacencies);
    expect(Math.max(...reds)).toBe(0);
  });

  it('produces adjacent reds when random, proving the toggle is real', () => {
    // Measured: 1.27 per board. This assertion is the one that caught selection
    // pressure leaking into "random" mode — it previously measured 0.03, which
    // is not random by any reading.
    const reds = boards({ numbers: 'random', resources: 'random' })
      .map(b => b.metrics.redAdjacencies);
    expect(mean(reds)).toBeGreaterThan(0.4);
  });

  it('scores balanced boards far above random ones', () => {
    // Measured: 93.0 vs 23.3.
    const bal = mean(
      boards({ numbers: 'balanced', resources: 'spread' }).map(b => b.metrics.balanceScore),
    );
    const rnd = mean(
      boards({ numbers: 'random', resources: 'random' }).map(b => b.metrics.balanceScore),
    );
    expect(bal).toBeGreaterThan(80);
    expect(rnd).toBeLessThan(55);
    expect(bal - rnd).toBeGreaterThan(30);
  });

  it('keeps intersections at or under the pip cap when balanced', () => {
    // Measured: 0.07 over-cap intersections per board, against 3.97 when random.
    const over = mean(boards({ numbers: 'balanced' }).map(b => b.metrics.intersectionsOverCap));
    expect(over).toBeLessThan(0.5);
  });
});

describe('resource spread', () => {
  it('reduces same-resource adjacency compared to random', () => {
    // Measured: 0.72 vs 5.63 per board.
    const spread = mean(
      boards({ resources: 'spread' }).map(b => b.metrics.sameResourceAdjacencies),
    );
    const random = mean(
      boards({ resources: 'random', numbers: 'random' }).map(
        b => b.metrics.sameResourceAdjacencies,
      ),
    );
    expect(spread).toBeLessThan(2);
    expect(random).toBeGreaterThan(spread * 2);
  });
});

describe('desert placement', () => {
  it('pins the desert to the centre hex when asked', () => {
    for (const board of boards({ desert: 'center' }, 10)) {
      expect(board.hexes[9]!.resource).toBe('desert');
    }
  });

  it('moves the desert around when randomised', () => {
    const positions = new Set(
      boards({ desert: 'random' }, 20).map(b =>
        b.hexes.findIndex(h => h.resource === 'desert'),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('port affinity', () => {
  it('places 2:1 ports differently for near and far', () => {
    const near = generateBoard({
      seed: 7, portTypes: 'shuffled', portAffinity: 'near', candidates: 50,
    });
    const far = generateBoard({
      seed: 7, portTypes: 'shuffled', portAffinity: 'far', candidates: 50,
    });
    const key = (b: typeof near) =>
      b.ports
        .filter(p => p.type !== 'generic')
        .map(p => `${p.type}@${p.hexIndex}.${p.edge}`)
        .sort()
        .join('|');
    expect(key(far)).not.toBe(key(near));
  });

  it('keeps the canonical trade rates when port types are standard', () => {
    // Same positions, same types — only the land changes between seeds.
    const a = generateBoard({ seed: 3, portTypes: 'standard', candidates: 20 });
    const b = generateBoard({ seed: 8, portTypes: 'standard', candidates: 20 });
    expect(b.ports).toEqual(a.ports);
  });
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe('measureBoard', () => {
  it('reports every violation even when the player asked for chaos', () => {
    // Selection ignores disabled constraints; reporting never does.
    const board = generateBoard({
      numbers: 'random', resources: 'random', seed: 4, candidates: 1,
    });
    const m = measureBoard(board.hexes, board.ports);
    expect(m).toEqual(board.metrics);
    expect(m.hottestIntersection).not.toBeNull();
    expect(m.hottestIntersection!.hexIndices).toHaveLength(3);
  });

  it('totals pips across exactly the five producing resources', () => {
    const board = generateBoard({ seed: 11, candidates: 20 });
    const keys = Object.keys(board.metrics.pipsByResource).sort();
    expect(keys).toEqual(['brick', 'grain', 'lumber', 'ore', 'wool']);
    // The full token bag is 58 pips regardless of arrangement.
    const total = Object.values(board.metrics.pipsByResource).reduce((a, b) => a + b, 0);
    expect(total).toBe(58);
  });
});
