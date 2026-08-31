/**
 * The whole-board snapshot, and the thing it must never do quietly.
 *
 * The interesting tests here are not "does it return buildings" but "does it
 * ADMIT what it cannot draw". A settlement recorded through the number pad has
 * no position, and a board view that silently omits it looks complete while
 * being wrong — which is the failure mode this repo keeps rediscovering.
 */

import {
  boardStateAtTurn,
  cornersHeldBy,
  isBoardCorner,
  isBoardEdge,
  legalMidGameCorners,
  midGameSettlementProblem,
  numbersAtCorner,
} from '@/services/catanBoardState';
import { getAllIntersections } from '@/services/catanBoard';
import { allEdges, neighboursOf } from '@/services/catanPlacement';
import { generateId } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

const CORNERS = getAllIntersections().map(i => i.id);
const EDGES = allEdges().map(e => e.id);

function build(
  over: Partial<CatanPlayerExposureEvent> & { playerId: string; turnNumber: number },
): CatanPlayerExposureEvent {
  return {
    id: generateId(),
    sessionId: 's1',
    timestamp: new Date().toISOString(),
    eventType: 'settlementBuilt',
    affectedNumbers: [6],
    productionWeight: 1,
    robberBlocked: false,
    ...over,
  } as CatanPlayerExposureEvent;
}

describe('board position identity', () => {
  it('accepts every real corner and edge', () => {
    expect(CORNERS).toHaveLength(54);
    expect(EDGES).toHaveLength(72);
    expect(CORNERS.every(isBoardCorner)).toBe(true);
    expect(EDGES.every(isBoardEdge)).toBe(true);
  });

  it('rejects a generated id, which is what the number pad records', () => {
    for (let i = 0; i < 50; i++) expect(isBoardCorner(generateId())).toBe(false);
  });

  it('rejects a well-formed id for a corner that does not exist', () => {
    // The reason ids are checked against real geometry and not by pattern.
    expect(isBoardCorner('9v9')).toBe(false);
    expect(isBoardCorner('40v0')).toBe(false);
  });
});

describe('boardStateAtTurn', () => {
  it('merges every player onto one board', () => {
    const a = CORNERS[0]!;
    const b = CORNERS[20]!;
    const snap = boardStateAtTurn(
      [
        build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [a] }),
        build({ playerId: 'p2', turnNumber: 1, hexIdentifiers: [b] }),
      ],
      ['p1', 'p2'],
    );
    expect(snap.buildings.get(a)?.playerId).toBe('p1');
    expect(snap.buildings.get(b)?.playerId).toBe('p2');
    expect(snap.unplaceable.size).toBe(0);
  });

  it('COUNTS what it cannot draw rather than dropping it silently', () => {
    const real = CORNERS[3]!;
    const snap = boardStateAtTurn(
      [
        build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [real] }),
        build({ playerId: 'p1', turnNumber: 2, hexIdentifiers: [generateId()] }),
        build({ playerId: 'p1', turnNumber: 3, hexIdentifiers: [generateId()] }),
      ],
      ['p1'],
    );
    expect(snap.buildings.size).toBe(1);
    expect(snap.unplaceable.get('p1')).toBe(2);
  });

  it('respects the turn cutoff', () => {
    const a = CORNERS[5]!;
    const b = CORNERS[25]!;
    const events = [
      build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [a] }),
      build({ playerId: 'p1', turnNumber: 9, hexIdentifiers: [b] }),
    ];
    expect(boardStateAtTurn(events, ['p1'], 5).buildings.size).toBe(1);
    expect(boardStateAtTurn(events, ['p1'], 9).buildings.size).toBe(2);
  });

  it('carries a city through as weight 2', () => {
    const a = CORNERS[7]!;
    const snap = boardStateAtTurn(
      [
        build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [a] }),
        build({
          playerId: 'p1', turnNumber: 4, hexIdentifiers: [a],
          eventType: 'cityUpgrade', productionWeight: 2,
        }),
      ],
      ['p1'],
    );
    expect(snap.buildings.get(a)?.weight).toBe(2);
    expect(snap.buildings.size).toBe(1);
  });

  it('keeps only roads that name a real edge', () => {
    const snap = boardStateAtTurn(
      [
        build({
          playerId: 'p1', turnNumber: 1, eventType: 'roadBuilt',
          hexIdentifiers: [EDGES[0]!], affectedNumbers: [], productionWeight: 0,
        }),
        build({
          playerId: 'p1', turnNumber: 1, eventType: 'roadBuilt',
          hexIdentifiers: ['not-an-edge'], affectedNumbers: [], productionWeight: 0,
        }),
      ],
      ['p1'],
    );
    expect(snap.roads.size).toBe(1);
    expect(snap.roads.get(EDGES[0]!)).toBe('p1');
  });
});

describe('midGameSettlementProblem', () => {
  const target = CORNERS[10]!;

  it('allows an empty, isolated corner', () => {
    const snap = boardStateAtTurn([], ['p1']);
    expect(midGameSettlementProblem(target, snap)).toBeNull();
  });

  it('blocks a corner someone already holds', () => {
    const snap = boardStateAtTurn(
      [build({ playerId: 'p2', turnNumber: 1, hexIdentifiers: [target] })],
      ['p2'],
    );
    expect(midGameSettlementProblem(target, snap)).toBe('occupied');
  });

  it('blocks a corner adjacent to any building — the distance rule', () => {
    const neighbour = neighboursOf(target)[0]!;
    const snap = boardStateAtTurn(
      [build({ playerId: 'p2', turnNumber: 1, hexIdentifiers: [neighbour] })],
      ['p2'],
    );
    expect(midGameSettlementProblem(target, snap)).toBe('too_close');
  });

  it('does NOT require a connecting road', () => {
    // Deliberate: roads are optional to record, so requiring connectivity
    // would refuse every legal corner for a player who never logged one.
    const far = CORNERS[40]!;
    const snap = boardStateAtTurn(
      [build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [CORNERS[0]!] })],
      ['p1'],
    );
    expect(midGameSettlementProblem(far, snap)).toBeNull();
  });

  it('rejects an id that is not a corner at all', () => {
    expect(midGameSettlementProblem(generateId(), boardStateAtTurn([], []))).toBe(
      'unknown_corner',
    );
  });
});

describe('legalMidGameCorners', () => {
  it('offers every corner on an empty board', () => {
    expect(legalMidGameCorners(boardStateAtTurn([], []))).toHaveLength(54);
  });

  it('removes the taken corner and its neighbours, and nothing else', () => {
    const target = CORNERS[10]!;
    const snap = boardStateAtTurn(
      [build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [target] })],
      ['p1'],
    );
    const legal = legalMidGameCorners(snap);
    const removed = 1 + neighboursOf(target).length;
    expect(legal).toHaveLength(54 - removed);
    expect(legal).not.toContain(target);
    for (const n of neighboursOf(target)) expect(legal).not.toContain(n);
  });
});

describe('numbersAtCorner', () => {
  const hexNumbers = Array.from({ length: 19 }, (_, i) => i + 2);

  it('derives numbers from the hexes meeting at the corner', () => {
    const interior = getAllIntersections().find(i => i.hexIndices.length === 3)!;
    const got = numbersAtCorner(interior.id, hexNumbers);
    expect(got).toHaveLength(3);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it('drops the desert and never returns a 7', () => {
    const withDesert = hexNumbers.map((n, i) => (i === 0 ? null : n === 7 ? 8 : n));
    const touchingHex0 = getAllIntersections().find(i => i.hexIndices.includes(0))!;
    const got = numbersAtCorner(touchingHex0.id, withDesert);
    expect(got).not.toContain(7);
    expect(got).toHaveLength(touchingHex0.hexIndices.length - 1);
  });

  it('returns nothing for an unknown corner', () => {
    expect(numbersAtCorner('nope', hexNumbers)).toEqual([]);
  });
});

describe('cornersHeldBy', () => {
  it('returns only that player, for road connectivity', () => {
    const a = CORNERS[0]!;
    const b = CORNERS[30]!;
    const snap = boardStateAtTurn(
      [
        build({ playerId: 'p1', turnNumber: 1, hexIdentifiers: [a] }),
        build({ playerId: 'p2', turnNumber: 1, hexIdentifiers: [b] }),
      ],
      ['p1', 'p2'],
    );
    expect([...cornersHeldBy(snap, 'p1')]).toEqual([a]);
    expect([...cornersHeldBy(snap, 'p2')]).toEqual([b]);
  });
});
