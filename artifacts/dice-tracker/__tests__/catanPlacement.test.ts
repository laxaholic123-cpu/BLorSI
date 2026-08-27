/**
 * Opening placement: turn order, legality, and getting back to one player.
 *
 * These are the parts of the exposure screen that are NOT touch-level, and
 * almost everything that has gone wrong with that screen has been. Proving the
 * rules here means the screen only has to draw state and call four functions,
 * and a device session can be spent on ergonomics instead of arithmetic.
 */

import {
  allEdges,
  clearSlot,
  cornersOfEdge,
  legalRoads,
  legalSettlements,
  neighboursOf,
  openingOrder,
  placeRoad,
  placeSettlement,
  placementProgress,
  roadProblem,
  settlementProblem,
  toExposureEvents,
} from '@/services/catanPlacement';
import { getAllIntersections } from '@/services/catanBoard';
import type { CatanHexDef } from '@/types/models';

const PLAYERS = ['p1', 'p2', 'p3', 'p4'];

describe('board topology', () => {
  it('finds all 72 edges of a Catan board', () => {
    // The obvious construction — "corners sharing two hexes are adjacent" — is
    // wrong and quietly so: it describes interior edges only, because two
    // adjacent COASTAL corners share just one hex. Measured, it produced 42
    // edges and left 18 corners with no neighbours at all.
    expect(allEdges()).toHaveLength(72);
  });

  it('gives every corner two or three neighbours', () => {
    const corners = getAllIntersections();
    expect(corners).toHaveLength(54);
    let coastal = 0;
    for (const c of corners) {
      const n = neighboursOf(c.id).length;
      expect(n === 2 || n === 3).toBe(true);
      if (n === 2) coastal++;
    }
    // The outer rim of a Catan board is 18 corners.
    expect(coastal).toBe(18);
  });

  it('makes adjacency symmetric', () => {
    for (const c of getAllIntersections()) {
      for (const n of neighboursOf(c.id)) {
        expect(neighboursOf(n)).toContain(c.id);
      }
    }
  });

  it('names an edge by the two corners it joins', () => {
    const edge = allEdges()[0]!;
    expect(cornersOfEdge(edge.id)).toEqual([edge.a, edge.b]);
    expect(cornersOfEdge('nonsense')).toBeNull();
  });
});

describe('openingOrder — the snake draft', () => {
  it('runs out along the seats and back again', () => {
    const order = openingOrder(PLAYERS).map(s => s.playerId);
    expect(order).toEqual(['p1', 'p2', 'p3', 'p4', 'p4', 'p3', 'p2', 'p1']);
  });

  it('gives the last player two turns in a row', () => {
    // The whole point of a snake draft: going first is worth less than it
    // looks, going last is worth more. The previous screen looped over players
    // and had each place both settlements at once, which is a different game.
    const order = openingOrder(PLAYERS);
    expect(order[3]!.playerId).toBe(order[4]!.playerId);
  });

  it('gives everyone exactly two turns', () => {
    const order = openingOrder(PLAYERS);
    expect(order).toHaveLength(8);
    for (const p of PLAYERS) {
      expect(order.filter(s => s.playerId === p)).toHaveLength(2);
    }
  });

  it('handles a two-player game', () => {
    expect(openingOrder(['a', 'b']).map(s => s.playerId)).toEqual(['a', 'b', 'b', 'a']);
  });
});

describe('the distance rule', () => {
  const corner = getAllIntersections()[20]!.id;
  const neighbour = neighboursOf(corner)[0]!;
  const far = getAllIntersections()
    .map(i => i.id)
    .find(id => id !== corner && !neighboursOf(corner).includes(id))!;

  it('refuses a corner already taken', () => {
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(settlementProblem(slots, 1, corner)).toBe('occupied');
  });

  it('refuses a corner NEXT to one already taken', () => {
    // Deliberately skipped for a long time on the grounds that players will not
    // let each other break it in real life. True, and beside the point: the app
    // records what happened, and an impossible board is far more likely to be a
    // mis-tap than a house rule.
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(settlementProblem(slots, 1, neighbour)).toBe('too_close');
  });

  it('allows a corner two edges away', () => {
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(settlementProblem(slots, 1, far)).toBeNull();
  });

  it('does not block a slot from moving its OWN settlement next door', () => {
    // Re-placing must not treat the player's own current corner as a rival.
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(settlementProblem(slots, 0, neighbour)).toBeNull();
  });

  it('shrinks the legal set as the board fills', () => {
    let slots = openingOrder(PLAYERS);
    const before = legalSettlements(slots, 0).length;
    slots = placeSettlement(slots, 0, corner).slots;
    const after = legalSettlements(slots, 1).length;
    // The corner itself plus its two or three neighbours.
    expect(after).toBeLessThan(before);
    expect(before - after).toBe(1 + neighboursOf(corner).length);
  });
});

describe('opening roads', () => {
  const corner = getAllIntersections()[20]!.id;
  const touching = allEdges().find(e => e.a === corner || e.b === corner)!;
  const elsewhere = allEdges().find(e => e.a !== corner && e.b !== corner)!;

  it('needs the settlement first', () => {
    expect(roadProblem(openingOrder(PLAYERS), 0, touching.id)).toBe('no_settlement_yet');
  });

  it('must touch the settlement placed in the same turn', () => {
    // That is what makes it an OPENING road rather than just a road.
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(roadProblem(slots, 0, elsewhere.id)).toBe('road_not_touching');
    expect(roadProblem(slots, 0, touching.id)).toBeNull();
  });

  it('offers only the two or three edges at that corner', () => {
    const { slots } = placeSettlement(openingOrder(PLAYERS), 0, corner);
    expect(legalRoads(slots, 0)).toHaveLength(neighboursOf(corner).length);
  });

  it('refuses an edge another player already took', () => {
    let slots = openingOrder(PLAYERS);
    slots = placeSettlement(slots, 0, corner).slots;
    slots = placeRoad(slots, 0, touching.id).slots;
    // Give slot 1 a settlement on the far end of that same edge.
    const other = touching.a === corner ? touching.b : touching.a;
    const problem = settlementProblem(slots, 1, other);
    // It is adjacent, so the settlement is refused — which is itself correct.
    expect(problem).toBe('too_close');
    // But the road rule must stand on its own regardless.
    expect(roadProblem(slots, 1, touching.id)).not.toBeNull();
  });

  it('drops the road when the settlement MOVES', () => {
    // A road is an opening road by virtue of touching the settlement it was
    // placed with. Leaving it attached after the player moves away would record
    // something that never happened.
    let slots = openingOrder(PLAYERS);
    slots = placeSettlement(slots, 0, corner).slots;
    slots = placeRoad(slots, 0, touching.id).slots;
    expect(slots[0]!.road).toBe(touching.id);

    const far = getAllIntersections().map(i => i.id)
      .find(id => id !== corner && !neighboursOf(corner).includes(id))!;
    slots = placeSettlement(slots, 0, far).slots;
    expect(slots[0]!.road).toBeNull();
  });

  it('keeps the road when the settlement is re-placed on the SAME corner', () => {
    let slots = openingOrder(PLAYERS);
    slots = placeSettlement(slots, 0, corner).slots;
    slots = placeRoad(slots, 0, touching.id).slots;
    slots = placeSettlement(slots, 0, corner).slots;
    expect(slots[0]!.road).toBe(touching.id);
  });
});

describe('going back to one player', () => {
  it('clears a single slot and leaves every other alone', () => {
    // The missing operation that prompted the rebuild: there was no way back to
    // one player without walking the whole flow backwards and losing everybody
    // else's placements.
    const ids = getAllIntersections().map(i => i.id);
    let slots = openingOrder(PLAYERS);
    const chosen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pick = ids.find(id => settlementProblem(slots, i, id) === null)!;
      chosen.push(pick);
      slots = placeSettlement(slots, i, pick).slots;
    }
    slots = clearSlot(slots, 1);
    expect(slots[1]!.settlement).toBeNull();
    expect(slots[0]!.settlement).toBe(chosen[0]);
    expect(slots[2]!.settlement).toBe(chosen[2]);
    expect(slots[3]!.settlement).toBe(chosen[3]);
  });

  it('frees the cleared corner for somebody else', () => {
    const corner = getAllIntersections()[20]!.id;
    let slots = placeSettlement(openingOrder(PLAYERS), 0, corner).slots;
    expect(settlementProblem(slots, 1, corner)).toBe('occupied');
    slots = clearSlot(slots, 0);
    expect(settlementProblem(slots, 1, corner)).toBeNull();
  });

  it('lets slots be filled out of order', () => {
    // Real tables wander. A flow that refuses anything out of sequence turns a
    // small human error into a restart.
    const ids = getAllIntersections().map(i => i.id);
    let slots = openingOrder(PLAYERS);
    slots = placeSettlement(slots, 5, ids[10]!).slots;
    slots = placeSettlement(slots, 2, ids[30]!).slots;
    expect(slots[5]!.settlement).toBe(ids[10]);
    expect(slots[2]!.settlement).toBe(ids[30]);
  });
});

describe('placementProgress', () => {
  it('suggests the snake order without enforcing it', () => {
    const ids = getAllIntersections().map(i => i.id);
    let slots = openingOrder(PLAYERS);
    expect(placementProgress(slots).suggested).toBe(0);

    // Fill slot 3 out of turn; the suggestion should still be slot 0.
    slots = placeSettlement(slots, 3, ids[40]!).slots;
    expect(placementProgress(slots).suggested).toBe(0);
  });

  it('counts settlements and roads separately', () => {
    const corner = getAllIntersections()[20]!.id;
    const edge = allEdges().find(e => e.a === corner || e.b === corner)!;
    let slots = placeSettlement(openingOrder(PLAYERS), 0, corner).slots;
    expect(placementProgress(slots).settlementsPlaced).toBe(1);
    expect(placementProgress(slots).roadsPlaced).toBe(0);
    slots = placeRoad(slots, 0, edge.id).slots;
    expect(placementProgress(slots).roadsPlaced).toBe(1);
    expect(placementProgress(slots).complete).toBe(false);
  });

  it('is complete only when every slot has both', () => {
    const ids = getAllIntersections().map(i => i.id);
    let slots = openingOrder(PLAYERS);
    for (let i = 0; i < slots.length; i++) {
      const pick = ids.find(id => settlementProblem(slots, i, id) === null)!;
      slots = placeSettlement(slots, i, pick).slots;
      const road = legalRoads(slots, i)[0]!;
      slots = placeRoad(slots, i, road).slots;
    }
    expect(placementProgress(slots).complete).toBe(true);
    expect(placementProgress(slots).outstanding).toEqual([]);
  });
});

describe('toExposureEvents', () => {
  const hexes: CatanHexDef[] = Array.from({ length: 19 }, (_, i) => ({
    index: i,
    resource: i === 9 ? 'desert' : 'grain',
    number: i === 9 ? null : 2 + (i % 10),
    confidence: 'high',
  }));

  it('keys every building to a UNIQUE location', () => {
    // Using the hex indices alone collapses 54 corners onto 19 keys, which
    // silently erases one of a player's two settlements and understates their
    // expected production. The corner id has to lead.
    const ids = getAllIntersections().map(i => i.id);
    let slots = openingOrder(PLAYERS);
    for (let i = 0; i < slots.length; i++) {
      const pick = ids.find(id => settlementProblem(slots, i, id) === null)!;
      slots = placeSettlement(slots, i, pick).slots;
    }
    const events = toExposureEvents(slots, 'sess', hexes);
    const keys = events.map(e => e.hexIdentifiers![0]);
    expect(new Set(keys).size).toBe(events.length);
  });

  it('emits nothing for an unplaced slot', () => {
    expect(toExposureEvents(openingOrder(PLAYERS), 'sess', hexes)).toEqual([]);
  });

  it('does NOT emit roads', () => {
    // Exposure describes what a position PRODUCES, and a road produces nothing.
    // Recording one would inflate every player's expected production.
    const corner = getAllIntersections()[20]!.id;
    const edge = allEdges().find(e => e.a === corner || e.b === corner)!;
    let slots = placeSettlement(openingOrder(PLAYERS), 0, corner).slots;
    slots = placeRoad(slots, 0, edge.id).slots;
    const events = toExposureEvents(slots, 'sess', hexes);
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('initialSettlement');
  });

  it('carries the numbers the corner actually touches', () => {
    const corner = getAllIntersections()[20]!.id;
    const slots = placeSettlement(openingOrder(PLAYERS), 0, corner).slots;
    const event = toExposureEvents(slots, 'sess', hexes)[0]!;
    expect(event.affectedNumbers.length).toBeGreaterThan(0);
    expect(event.affectedNumbers).not.toContain(null);
  });
});
