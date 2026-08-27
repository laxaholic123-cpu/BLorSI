/**
 * Opening placement: whose turn, where is legal, and what has been placed.
 *
 * WHY A SERVICE AND NOT JUST A SCREEN
 * -----------------------------------
 * Almost everything that has gone wrong with the exposure screen has been
 * touch-level — dead taps, gestures stolen by a scroll container, handles
 * snapping back — and none of it is testable without a device. The rules and
 * the turn order are not touch-level at all, so they live here where they can
 * be proved on a laptop, and the screen becomes a thin thing that draws state
 * and calls four functions.
 *
 * WHAT A REAL OPENING LOOKS LIKE
 * ------------------------------
 * A snake draft. Players place one settlement and one road each in seat order,
 * then the LAST player places again immediately and the order runs back — so
 * the player who went first also goes last. That is the whole point of it:
 * going first is worth less than it looks, and going last is worth more.
 *
 * The previous screen looped over players and had each place both settlements
 * at once, which is a different game.
 *
 * ORDER IS A SEQUENCE, NOT A LOOP
 * -------------------------------
 * Every slot is addressable, and any slot can be filled, changed or cleared at
 * any time. Real tables do not proceed in a clean line — somebody misremembers
 * whose turn it was, two people place at once while the box is being unpacked,
 * a player changes their mind before anyone has rolled. A strict wizard makes
 * those situations unrecoverable, which is exactly the complaint that prompted
 * this: no way back to one player without losing everybody else's placements.
 *
 * So `openingOrder` says what SHOULD happen next, and nothing enforces it.
 */

import {
  getAllIntersections,
  hexesForIntersectionId,
  intersectionIdAt,
} from '@/services/catanBoard';
import type { CatanHexDef, CatanPlayerExposureEvent } from '@/types/models';

// ─── Board topology ───────────────────────────────────────────────────────────

/** An edge of the board: the pair of corners it joins. */
export interface BoardEdge {
  /** Stable id, the two corner ids sorted and joined. */
  id: string;
  a: string;
  b: string;
}

/**
 * Every edge on the board — 72 of them.
 *
 * Built from consecutive vertices of each hex rather than from shared hexes.
 * The obvious rule, "two corners are adjacent when they share two hexes", is
 * wrong and quietly so: it describes interior edges only, because two adjacent
 * corners on the COAST share just one hex. Measured, it produced 42 edges and
 * left 18 corners with no neighbours at all.
 */
export function allEdges(): BoardEdge[] {
  const seen = new Map<string, BoardEdge>();
  for (let hex = 0; hex < 19; hex++) {
    for (let v = 0; v < 6; v++) {
      const a = intersectionIdAt(hex, v);
      const b = intersectionIdAt(hex, (v + 1) % 6);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const id = `${lo}|${hi}`;
      if (!seen.has(id)) seen.set(id, { id, a: lo, b: hi });
    }
  }
  return [...seen.values()];
}

let adjacencyCache: Map<string, string[]> | null = null;

/** The corners joined to this one by a single edge: two or three of them. */
export function neighboursOf(intersectionId: string): string[] {
  if (!adjacencyCache) {
    adjacencyCache = new Map();
    for (const edge of allEdges()) {
      if (!adjacencyCache.has(edge.a)) adjacencyCache.set(edge.a, []);
      if (!adjacencyCache.has(edge.b)) adjacencyCache.set(edge.b, []);
      adjacencyCache.get(edge.a)!.push(edge.b);
      adjacencyCache.get(edge.b)!.push(edge.a);
    }
  }
  return adjacencyCache.get(intersectionId) ?? [];
}

/** The two corners an edge joins, or null if the id is not an edge. */
export function cornersOfEdge(edgeId: string): [string, string] | null {
  const parts = edgeId.split('|');
  return parts.length === 2 ? [parts[0]!, parts[1]!] : null;
}

// ─── Placement state ──────────────────────────────────────────────────────────

/** One turn of the opening: this player, this round, one settlement, one road. */
export interface PlacementSlot {
  index: number;
  playerId: string;
  /** 1 on the way out, 2 on the way back. */
  round: 1 | 2;
  /** Corner id, or null while unplaced. */
  settlement: string | null;
  /** Edge id, or null while unplaced. */
  road: string | null;
}

export type PlacementProblem =
  | 'occupied'
  | 'too_close'
  | 'road_not_touching'
  | 'road_taken'
  | 'no_settlement_yet'
  | 'unknown_corner'
  | 'unknown_edge';

/**
 * The order the opening SHOULD run in: out along the seats, then back.
 *
 * Returned as a plain list of slots so a caller can jump anywhere in it. The
 * last player of round one is the first of round two, which is why they appear
 * twice in a row.
 */
export function openingOrder(playerIds: readonly string[]): PlacementSlot[] {
  const forward = playerIds.map((playerId, i) => ({
    index: i, playerId, round: 1 as const, settlement: null, road: null,
  }));
  const back = [...playerIds].reverse().map((playerId, i) => ({
    index: playerIds.length + i, playerId, round: 2 as const,
    settlement: null, road: null,
  }));
  return [...forward, ...back];
}

/** Corners already taken by anybody. */
function occupiedCorners(slots: readonly PlacementSlot[], ignoreIndex = -1): Set<string> {
  const out = new Set<string>();
  for (const s of slots) {
    if (s.index === ignoreIndex) continue;
    if (s.settlement) out.add(s.settlement);
  }
  return out;
}

/** Edges already taken by anybody. */
function occupiedEdges(slots: readonly PlacementSlot[], ignoreIndex = -1): Set<string> {
  const out = new Set<string>();
  for (const s of slots) {
    if (s.index === ignoreIndex) continue;
    if (s.road) out.add(s.road);
  }
  return out;
}

/**
 * Why this corner cannot take a settlement, or null if it can.
 *
 * The DISTANCE RULE is enforced here — no settlement may sit on a corner
 * adjacent to another settlement. It was deliberately skipped for a long time
 * on the grounds that players will not let each other break it in real life,
 * which is true and beside the point: the app is recording what happened, and
 * an impossible board is more likely to be a mis-tap than a house rule. It is
 * reported rather than silently prevented, so a table that genuinely wants to
 * do something odd still can.
 */
export function settlementProblem(
  slots: readonly PlacementSlot[],
  slotIndex: number,
  cornerId: string,
): PlacementProblem | null {
  if (neighboursOf(cornerId).length === 0) return 'unknown_corner';
  const taken = occupiedCorners(slots, slotIndex);
  if (taken.has(cornerId)) return 'occupied';
  for (const neighbour of neighboursOf(cornerId)) {
    if (taken.has(neighbour)) return 'too_close';
  }
  return null;
}

/** Every corner this slot could legally take. */
export function legalSettlements(
  slots: readonly PlacementSlot[],
  slotIndex: number,
): string[] {
  return getAllIntersections()
    .map(i => i.id)
    .filter(id => settlementProblem(slots, slotIndex, id) === null);
}

/**
 * Why this edge cannot take the road, or null if it can.
 *
 * An opening road must touch the settlement placed in the SAME turn — that is
 * what makes it an opening road rather than just a road.
 */
export function roadProblem(
  slots: readonly PlacementSlot[],
  slotIndex: number,
  edgeId: string,
): PlacementProblem | null {
  const slot = slots[slotIndex];
  if (!slot) return 'unknown_edge';
  if (!slot.settlement) return 'no_settlement_yet';
  const corners = cornersOfEdge(edgeId);
  if (!corners) return 'unknown_edge';
  if (!corners.includes(slot.settlement)) return 'road_not_touching';
  if (occupiedEdges(slots, slotIndex).has(edgeId)) return 'road_taken';
  return null;
}

/** Every edge this slot could legally take, given its settlement. */
export function legalRoads(
  slots: readonly PlacementSlot[],
  slotIndex: number,
): string[] {
  const slot = slots[slotIndex];
  if (!slot?.settlement) return [];
  return allEdges()
    .map(e => e.id)
    .filter(id => roadProblem(slots, slotIndex, id) === null);
}

export interface PlacementResult {
  slots: PlacementSlot[];
  problem: PlacementProblem | null;
}

/**
 * Put a settlement on a corner.
 *
 * Placing a NEW settlement clears that slot's road, because a road is only an
 * opening road by virtue of touching the settlement it was placed with — and
 * leaving it attached to a corner the player has moved away from would record
 * something that never happened.
 */
export function placeSettlement(
  slots: readonly PlacementSlot[],
  slotIndex: number,
  cornerId: string,
): PlacementResult {
  const problem = settlementProblem(slots, slotIndex, cornerId);
  if (problem) return { slots: [...slots], problem };
  const next = slots.map(s =>
    s.index === slotIndex
      ? { ...s, settlement: cornerId, road: s.settlement === cornerId ? s.road : null }
      : s,
  );
  return { slots: next, problem: null };
}

export function placeRoad(
  slots: readonly PlacementSlot[],
  slotIndex: number,
  edgeId: string,
): PlacementResult {
  const problem = roadProblem(slots, slotIndex, edgeId);
  if (problem) return { slots: [...slots], problem };
  return {
    slots: slots.map(s => (s.index === slotIndex ? { ...s, road: edgeId } : s)),
    problem: null,
  };
}

/**
 * Empty one slot without touching any other.
 *
 * The missing operation that prompted this rebuild: there was no way back to a
 * single player without walking the whole flow backwards and losing everybody
 * else's placements. Clearing can never make another slot illegal — it only
 * frees a corner — so no revalidation is needed.
 */
export function clearSlot(
  slots: readonly PlacementSlot[],
  slotIndex: number,
): PlacementSlot[] {
  return slots.map(s =>
    s.index === slotIndex ? { ...s, settlement: null, road: null } : s,
  );
}

export interface PlacementProgress {
  settlementsPlaced: number;
  roadsPlaced: number;
  total: number;
  complete: boolean;
  /** The slot the snake draft says is next, or null when nothing is left. */
  suggested: number | null;
  /** Slots still missing something, in order. */
  outstanding: number[];
}

/**
 * How far along the opening is.
 *
 * `suggested` is advice, not a gate. Real tables wander — somebody
 * misremembers the order, two people place while the box is still being
 * unpacked — and a flow that refuses anything out of sequence turns a small
 * human error into a restart.
 */
export function placementProgress(slots: readonly PlacementSlot[]): PlacementProgress {
  const outstanding = slots.filter(s => !s.settlement || !s.road).map(s => s.index);
  return {
    settlementsPlaced: slots.filter(s => s.settlement).length,
    roadsPlaced: slots.filter(s => s.road).length,
    total: slots.length,
    complete: outstanding.length === 0,
    suggested: outstanding.length > 0 ? outstanding[0]! : null,
    outstanding,
  };
}

/**
 * Turn finished placements into the exposure events the stats path already
 * understands.
 *
 * Roads are deliberately NOT emitted. Exposure events describe what a position
 * PRODUCES, and a road produces nothing — recording one as exposure would
 * inflate every player's expected production. They stay in the placement state,
 * where a future Longest Road feature can find them.
 */
export function toExposureEvents(
  slots: readonly PlacementSlot[],
  sessionId: string,
  hexes: readonly (CatanHexDef | null)[],
  now = new Date().toISOString(),
): CatanPlayerExposureEvent[] {
  const events: CatanPlayerExposureEvent[] = [];
  for (const slot of slots) {
    if (!slot.settlement) continue;
    const hexIndices = hexesForIntersectionId(slot.settlement);
    const touched = hexIndices.map(i => hexes[i]).filter(Boolean) as CatanHexDef[];
    events.push({
      id: `${sessionId}-open-${slot.index}`,
      sessionId,
      playerId: slot.playerId,
      eventType: 'initialSettlement',
      turnNumber: 0,
      timestamp: now,
      // The corner id leads, so each building keys to a UNIQUE location. Using
      // the hex indices alone collapses 54 corners onto 19 keys and silently
      // erases one of a player's two settlements.
      hexIdentifiers: [slot.settlement, ...hexIndices.map(String)],
      affectedNumbers: touched
        .map(h => h.number)
        .filter((n): n is number => n != null),
      productionWeight: 1,
      resourceType: touched.find(
        h => h.resource && h.resource !== 'desert',
      )?.resource ?? undefined,
      robberBlocked: false,
    });
  }
  return events;
}
