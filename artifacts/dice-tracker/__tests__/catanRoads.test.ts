/**
 * Roads, and the Longest Road.
 *
 * Longest Road is the only part of a Catan score that is a graph problem rather
 * than a count, and three details separate the real rule from the obvious
 * implementation. Each one changes the answer, so each one is tested here on a
 * hand-built network where the correct answer can be worked out by eye.
 *
 * The board's real corner ids are not used for the graph tests. Synthetic ids
 * make the shape of each network legible in the test itself — a diagram in the
 * comment matches the edges in the code — which matters more here than
 * realism, because what is being checked is the algorithm, not the board.
 */

import {
  LONGEST_ROAD_MINIMUM,
  allRoads,
  buildProblem,
  longestRoad,
  longestRoadByPlayer,
  longestRoadHolder,
  roadEvent,
  roadsOf,
} from '@/services/catanRoads';
import type { CatanPlayerExposureEvent } from '@/types/models';

/** An edge id in the same shape the placement service produces. */
const e = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const road = (...pairs: [string, string][]) => new Set(pairs.map(([a, b]) => e(a, b)));

describe('longestRoad — counting a chain', () => {
  it('is zero with no roads', () => {
    expect(longestRoad(new Set())).toBe(0);
  });

  it('counts a straight run', () => {
    // A-B-C-D-E : four roads in a line.
    expect(longestRoad(road(['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']))).toBe(4);
  });

  it('counts the longest ARM of a fork, not every road owned', () => {
    //     D
    //     |
    // A-B-C-E-F
    // Six roads, but the longest line through them is five.
    const net = road(['A', 'B'], ['B', 'C'], ['C', 'D'], ['C', 'E'], ['E', 'F']);
    expect(net.size).toBe(5);
    expect(longestRoad(net)).toBe(4);
  });

  it('walks a loop all the way round', () => {
    // A square: four roads, and all four are one continuous route.
    expect(longestRoad(road(['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'A']))).toBe(4);
  });

  it('lets a route revisit a JUNCTION but not a road', () => {
    // A figure-of-eight through B. A simple-path implementation — no repeated
    // vertices — gets 4 here; the real rule is a trail, so all six roads are one
    // continuous route through B twice.
    //   A-B-C
    //   |   |
    //   F-B-D  (B shared)
    const net = road(
      ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'B'], ['B', 'F'], ['F', 'A'],
    );
    expect(net.size).toBe(6);
    expect(longestRoad(net)).toBe(6);
  });

  it('takes the longer of two disconnected networks', () => {
    const net = road(['A', 'B'], ['B', 'C'], ['X', 'Y']);
    expect(longestRoad(net)).toBe(2);
  });
});

describe('longestRoad — an opponent breaks it', () => {
  // A-B-C-D-E, four roads. An opponent settles at C.
  const chain = road(['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']);

  it('cuts the road at an opponent building', () => {
    // The route may END at C but not continue through, so the best is A-B-C.
    expect(longestRoad(chain, new Set(['C']))).toBe(2);
  });

  it('is unaffected by a building at either END', () => {
    // Blocking the far end of a road cuts nothing — there was nothing beyond it.
    expect(longestRoad(chain, new Set(['E']))).toBe(4);
    expect(longestRoad(chain, new Set(['A']))).toBe(4);
  });

  it("is the reason a settlement gets placed in someone's way", () => {
    // Five roads is the threshold; a single well-placed settlement takes it away.
    const five = road(['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F']);
    expect(longestRoad(five)).toBe(5);
    expect(longestRoad(five, new Set(['C']))).toBeLessThan(LONGEST_ROAD_MINIMUM);
  });
});

describe('buildProblem — where a road may go', () => {
  const own = road(['A', 'B']);
  const none = new Set<string>();

  it('allows a road touching one of your own roads', () => {
    expect(buildProblem(e('B', 'C'), own, none, none)).toBeNull();
  });

  it('allows a road touching one of your own buildings', () => {
    expect(buildProblem(e('X', 'Y'), none, new Set(['X']), none)).toBeNull();
  });

  it('refuses a road connected to nothing of yours', () => {
    // What stops a player claiming a distant stretch of board they never
    // reached.
    expect(buildProblem(e('X', 'Y'), own, none, none)).toBe('disconnected');
  });

  it('refuses an edge somebody already built on', () => {
    expect(buildProblem(e('B', 'C'), own, none, road(['B', 'C']))).toBe('occupied');
  });

  it('refuses something that is not an edge', () => {
    expect(buildProblem('nonsense', own, none, none)).toBe('unknown_edge');
  });
});

describe('roadsOf — reading the event log', () => {
  const ev = (
    id: string, playerId: string, edgeId: string, turn: number, built: boolean,
  ): CatanPlayerExposureEvent =>
    roadEvent('s', playerId, edgeId, turn, built, id);

  it("collects one player's roads and nobody else's", () => {
    const events = [
      ev('1', 'p1', e('A', 'B'), 1, true),
      ev('2', 'p2', e('C', 'D'), 1, true),
      ev('3', 'p1', e('B', 'C'), 2, true),
    ];
    expect(roadsOf(events, 'p1')).toEqual(road(['A', 'B'], ['B', 'C']));
    expect(roadsOf(events, 'p2')).toEqual(road(['C', 'D']));
  });

  it('lets a later removal undo an earlier build', () => {
    // Append-only log, so an undo is a later event rather than a deletion.
    const events = [
      ev('1', 'p1', e('A', 'B'), 1, true),
      ev('2', 'p1', e('A', 'B'), 3, false),
    ];
    expect(roadsOf(events, 'p1').size).toBe(0);
  });

  it('reads the board as it stood at an earlier turn', () => {
    const events = [
      ev('1', 'p1', e('A', 'B'), 1, true),
      ev('2', 'p1', e('B', 'C'), 5, true),
    ];
    expect(roadsOf(events, 'p1', 3).size).toBe(1);
    expect(roadsOf(events, 'p1', 9).size).toBe(2);
  });

  it('maps every road on the board to its owner', () => {
    const events = [
      ev('1', 'p1', e('A', 'B'), 1, true),
      ev('2', 'p2', e('C', 'D'), 1, true),
    ];
    const owners = allRoads(events, ['p1', 'p2']);
    expect(owners.get(e('A', 'B'))).toBe('p1');
    expect(owners.get(e('C', 'D'))).toBe('p2');
  });

  it('produces road events that cannot affect production', () => {
    const built = ev('1', 'p1', e('A', 'B'), 1, true);
    expect(built.productionWeight).toBe(0);
    expect(built.affectedNumbers).toEqual([]);
    expect(built.eventType).toBe('roadBuilt');
  });
});

describe('longestRoadHolder', () => {
  it('gives it to nobody below the threshold', () => {
    expect(longestRoadHolder(new Map([['p1', 4], ['p2', 3]]))).toBeNull();
  });

  it('gives it to a clear leader at or above the threshold', () => {
    const claim = longestRoadHolder(new Map([['p1', 6], ['p2', 5]]))!;
    expect(claim.playerId).toBe('p1');
    expect(claim.length).toBe(6);
  });

  it('gives it to nobody on a tie', () => {
    // In the real game the card stays where it is until somebody breaks the
    // tie. With no card to track, "nobody" is the honest answer — picking a
    // player arbitrarily would invent a two-point swing.
    expect(longestRoadHolder(new Map([['p1', 6], ['p2', 6]]))).toBeNull();
  });

  it('handles an empty table', () => {
    expect(longestRoadHolder(new Map())).toBeNull();
  });
});

describe('longestRoadByPlayer', () => {
  it("breaks each player's road on OTHER players' buildings only", () => {
    // p1 holds A-B-C-D-E and has their own settlement at C. Their own building
    // never breaks their own road; only an opponent's does.
    const events = [
      roadEvent('s', 'p1', e('A', 'B'), 1, true, '1'),
      roadEvent('s', 'p1', e('B', 'C'), 1, true, '2'),
      roadEvent('s', 'p1', e('C', 'D'), 1, true, '3'),
      roadEvent('s', 'p1', e('D', 'E'), 1, true, '4'),
    ];
    const ownBuilding = longestRoadByPlayer(events, ['p1', 'p2'],
      new Map([['p1', new Set(['C'])], ['p2', new Set<string>()]]));
    expect(ownBuilding.get('p1')).toBe(4);

    const rivalBuilding = longestRoadByPlayer(events, ['p1', 'p2'],
      new Map([['p1', new Set<string>()], ['p2', new Set(['C'])]]));
    expect(rivalBuilding.get('p1')).toBe(2);
  });

  it('reports zero for a player with no roads', () => {
    const lengths = longestRoadByPlayer([], ['p1'], new Map());
    expect(lengths.get('p1')).toBe(0);
  });
});
