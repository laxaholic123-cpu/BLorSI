/**
 * The whole board, for everybody, as of a turn.
 *
 * WHY THIS EXISTS
 * ---------------
 * `catanStats.getBuildingStatesAtTurn` answers "what does ONE player hold",
 * and `catanRoads.allRoads` answers "who owns which edge". Nothing answered
 * "what does the board look like right now", which is what a board view needs
 * and what nobody could see during a game.
 *
 * THE SPLIT THAT MAKES THIS AWKWARD, AND WHY IT IS EXPLICIT
 * --------------------------------------------------------
 * A `locationId` is only sometimes a place. Opening settlements placed by
 * tapping a corner carry a real intersection id (`4v2`); roads carry a real
 * edge id. But a settlement recorded mid-game through the number pad carries
 * `generateId()` — a random string — because the player told the app which
 * NUMBERS the settlement touches and never said where it was.
 *
 * So a board view can draw some of a player's buildings and not others, and
 * the difference is invisible in the data unless someone looks. `unplaceable`
 * counts exactly that, and the UI must show it. A board that quietly omits two
 * of your four settlements is worse than no board, because it reads as
 * complete — the same failure as a reader that declines invisibly.
 *
 * Ids are validated against the real geometry rather than by pattern, because
 * a pattern test would accept `9v9`, which is not a corner on any board.
 */

import { getAllIntersections } from '@/services/catanBoard';
import { allEdges, cornersOfEdge, neighboursOf } from '@/services/catanPlacement';
import { getBuildingStatesAtTurn } from '@/services/catanStats';
import { allRoads } from '@/services/catanRoads';
import type { CatanPlayerExposureEvent } from '@/types/models';

/** Every corner id that exists on a real board. */
const VALID_CORNERS: ReadonlySet<string> = new Set(getAllIntersections().map(i => i.id));

/** Every edge id that exists on a real board. */
const VALID_EDGES: ReadonlySet<string> = new Set(allEdges().map(e => e.id));

/** Is this location id an actual place, or a stand-in for one? */
export function isBoardCorner(locationId: string): boolean {
  return VALID_CORNERS.has(locationId);
}

export function isBoardEdge(locationId: string): boolean {
  return VALID_EDGES.has(locationId);
}

export interface PlacedBuilding {
  cornerId: string;
  playerId: string;
  /** 1 for a settlement, 2 for a city — the same scale as productionWeight. */
  weight: number;
  affectedNumbers: number[];
}

export interface BoardSnapshot {
  /** Corner id → what stands on it. */
  buildings: Map<string, PlacedBuilding>;
  /** Edge id → owning player. */
  roads: Map<string, string>;
  /**
   * Buildings that exist in the log but cannot be drawn, per player, because
   * they were recorded by number rather than by position. Surface this.
   */
  unplaceable: Map<string, number>;
}

/**
 * The board as of `turnNumber`, across every player.
 *
 * Later events win per location, which `getBuildingStatesAtTurn` already
 * handles; this only has to merge the players together and drop the
 * placements that were never places.
 */
export function boardStateAtTurn(
  events: readonly CatanPlayerExposureEvent[],
  playerIds: readonly string[],
  turnNumber: number = Number.MAX_SAFE_INTEGER,
): BoardSnapshot {
  const buildings = new Map<string, PlacedBuilding>();
  const unplaceable = new Map<string, number>();

  for (const playerId of playerIds) {
    let missing = 0;
    for (const state of getBuildingStatesAtTurn(playerId, turnNumber, [...events])) {
      if (!isBoardCorner(state.locationId)) {
        missing += 1;
        continue;
      }
      buildings.set(state.locationId, {
        cornerId: state.locationId,
        playerId,
        weight: state.productionWeight,
        affectedNumbers: state.affectedNumbers,
      });
    }
    if (missing > 0) unplaceable.set(playerId, missing);
  }

  const roads = new Map<string, string>();
  for (const [edgeId, playerId] of allRoads(events, playerIds, turnNumber)) {
    if (isBoardEdge(edgeId)) roads.set(edgeId, playerId);
  }

  return { buildings, roads, unplaceable };
}

export type MidGamePlacementProblem = 'unknown_corner' | 'occupied' | 'too_close';

/**
 * Why a corner cannot take a new building mid-game, or null if it can.
 *
 * Enforces the two rules a MIS-TAP breaks — the corner is taken, or it is
 * adjacent to a building — and deliberately not the third. Real Catan also
 * requires a settlement to connect to your own road, and that is NOT checked
 * here: roads are optional to record, so a player who has not been logging
 * them would find every legal corner refused. Occupancy and distance are
 * unambiguous from the board alone; connectivity depends on bookkeeping the
 * app cannot assume happened.
 *
 * This is the same reasoning that put the distance rule into opening
 * placement: enforce what catches a slip, not what makes the app a referee.
 */
export function midGameSettlementProblem(
  cornerId: string,
  snapshot: BoardSnapshot,
): MidGamePlacementProblem | null {
  if (!isBoardCorner(cornerId)) return 'unknown_corner';
  if (snapshot.buildings.has(cornerId)) return 'occupied';
  for (const neighbour of neighboursOf(cornerId)) {
    if (snapshot.buildings.has(neighbour)) return 'too_close';
  }
  return null;
}

/** Every corner a new building could legally go on. */
export function legalMidGameCorners(snapshot: BoardSnapshot): string[] {
  return [...VALID_CORNERS].filter(id => midGameSettlementProblem(id, snapshot) === null);
}

/**
 * Which dice numbers a corner produces from, given the board.
 *
 * The whole reason to place by corner rather than by number: this is derived,
 * not self-reported, so a player's exposure stops depending on them reading
 * their own board correctly.
 */
export function numbersAtCorner(
  cornerId: string,
  hexNumbers: readonly (number | null | undefined)[],
): number[] {
  const corner = getAllIntersections().find(i => i.id === cornerId);
  if (!corner) return [];
  const out: number[] = [];
  for (const hexIndex of corner.hexIndices) {
    const n = hexNumbers[hexIndex];
    if (typeof n === 'number' && n >= 2 && n <= 12 && n !== 7) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Corners a player holds, for road-connectivity checks.
 *
 * `catanRoads.buildProblem` takes this rather than reaching into building
 * state itself, so the road rules stay independent of production bookkeeping.
 */
export function cornersHeldBy(snapshot: BoardSnapshot, playerId: string): Set<string> {
  const out = new Set<string>();
  for (const [cornerId, b] of snapshot.buildings) {
    if (b.playerId === playerId) out.add(cornerId);
  }
  return out;
}

/** Edges whose two endpoints are both known corners — every drawable road. */
export function edgeEndpoints(edgeId: string): [string, string] | null {
  return cornersOfEdge(edgeId);
}
