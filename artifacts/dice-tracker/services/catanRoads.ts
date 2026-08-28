/**
 * Roads: where they may go, and who holds the Longest Road.
 *
 * Roads produce nothing, so none of the production maths touches them. What
 * they decide is Longest Road — two victory points, and the only part of a
 * Catan score that is a graph problem rather than a count.
 *
 * WHAT "LONGEST" ACTUALLY MEANS
 * ----------------------------
 * Three details separate the real rule from the obvious implementation, and
 * each one changes the answer:
 *
 * 1. It is the longest continuous PATH, not the number of roads owned. A
 *    player with a fork of eight roads may only have five in a line.
 * 2. Edges cannot repeat, but VERTICES can. The route may pass through a
 *    junction it has already visited, coming in on one road and out on
 *    another. Treating it as a simple path — no repeated vertices — undercounts
 *    real networks. It is a trail, not a path.
 * 3. An opponent's building BREAKS it. A settlement dropped on a junction cuts
 *    the road there: the route may end at that junction but cannot continue
 *    through it. This is the part people forget, and it is decisive — it is the
 *    whole reason for placing a settlement in someone's way.
 *
 * Longest trail is NP-hard in general. It is also trivial here: a player has at
 * most fifteen roads, so exhaustive search with backtracking finishes instantly
 * and is exactly right, where a heuristic would be neither.
 */

import { cornersOfEdge } from '@/services/catanPlacement';
import type { CatanPlayerExposureEvent } from '@/types/models';

/** Roads needed before Longest Road can be claimed at all. */
export const LONGEST_ROAD_MINIMUM = 5;

/** Points Longest Road is worth. */
export const LONGEST_ROAD_POINTS = 2;

export type RoadProblem =
  | 'unknown_edge'
  | 'occupied'
  | 'disconnected';

/**
 * Every road a player holds, as of a turn.
 *
 * Later events win, so a `roadRemoved` after a `roadBuilt` on the same edge
 * leaves nothing — which is how an undo has to behave in an append-only log.
 */
export function roadsOf(
  events: readonly CatanPlayerExposureEvent[],
  playerId: string,
  throughTurn = Number.MAX_SAFE_INTEGER,
): Set<string> {
  const state = new Map<string, boolean>();
  const relevant = events
    .filter(e => e.playerId === playerId
      && e.turnNumber <= throughTurn
      && (e.eventType === 'roadBuilt' || e.eventType === 'roadRemoved'))
    .sort((a, b) => a.turnNumber - b.turnNumber);
  for (const e of relevant) {
    const edgeId = e.hexIdentifiers?.[0];
    if (!edgeId) continue;
    state.set(edgeId, e.eventType === 'roadBuilt');
  }
  return new Set([...state.entries()].filter(([, on]) => on).map(([id]) => id));
}

/** Every road held by anybody, mapped to its owner. */
export function allRoads(
  events: readonly CatanPlayerExposureEvent[],
  playerIds: readonly string[],
  throughTurn = Number.MAX_SAFE_INTEGER,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const playerId of playerIds) {
    for (const edge of roadsOf(events, playerId, throughTurn)) out.set(edge, playerId);
  }
  return out;
}

/**
 * Why this road cannot be built, or null if it can.
 *
 * A road must touch something the player already has — one of their own roads,
 * or one of their own buildings. That is what makes a network a network rather
 * than a scatter, and it is the rule that stops a player from claiming a
 * distant stretch of board they never reached.
 *
 * `ownCorners` is the set of corners the player holds buildings on; the caller
 * supplies it because building state lives in `catanStats`, and importing that
 * here would tie road legality to production bookkeeping for no reason.
 */
export function buildProblem(
  edgeId: string,
  ownRoads: ReadonlySet<string>,
  ownCorners: ReadonlySet<string>,
  takenRoads: ReadonlySet<string>,
): RoadProblem | null {
  const corners = cornersOfEdge(edgeId);
  if (!corners) return 'unknown_edge';
  if (takenRoads.has(edgeId)) return 'occupied';

  const [a, b] = corners;
  if (ownCorners.has(a) || ownCorners.has(b)) return null;
  for (const road of ownRoads) {
    const rc = cornersOfEdge(road);
    if (!rc) continue;
    if (rc[0] === a || rc[1] === a || rc[0] === b || rc[1] === b) return null;
  }
  return 'disconnected';
}

/**
 * The longest continuous run of road in this set.
 *
 * `blockedCorners` are junctions held by OTHER players: a route may finish
 * there but may not continue through.
 */
export function longestRoad(
  roads: ReadonlySet<string>,
  blockedCorners: ReadonlySet<string> = new Set(),
): number {
  const edges = [...roads]
    .map(id => ({ id, ends: cornersOfEdge(id) }))
    .filter((e): e is { id: string; ends: [string, string] } => e.ends !== null);
  if (edges.length === 0) return 0;

  /** Corner -> the edges meeting there. */
  const at = new Map<string, { id: string; ends: [string, string] }[]>();
  for (const edge of edges) {
    for (const corner of edge.ends) {
      if (!at.has(corner)) at.set(corner, []);
      at.get(corner)!.push(edge);
    }
  }

  const used = new Set<string>();
  let best = 0;

  /** Walk on from `corner`, having already travelled `used`. */
  function walk(corner: string, length: number): void {
    if (length > best) best = length;
    // An opponent's building cuts the road here. The route may END at this
    // junction — the length above is already counted — but not pass through.
    if (blockedCorners.has(corner)) return;
    for (const edge of at.get(corner) ?? []) {
      if (used.has(edge.id)) continue;
      used.add(edge.id);
      walk(edge.ends[0] === corner ? edge.ends[1] : edge.ends[0], length + 1);
      used.delete(edge.id);
    }
  }

  // Every edge, from both ends: the longest trail need not start at a dead end,
  // and on a network with a cycle there may be no dead end at all.
  for (const edge of edges) {
    for (const start of [edge.ends[0], edge.ends[1]]) {
      const other = start === edge.ends[0] ? edge.ends[1] : edge.ends[0];
      // Starting mid-road is allowed; starting by passing THROUGH a blocked
      // junction is not.
      if (blockedCorners.has(start)) continue;
      used.add(edge.id);
      walk(other, 1);
      used.delete(edge.id);
    }
  }
  return best;
}

export interface LongestRoadClaim {
  playerId: string;
  length: number;
  /** Everyone tied at that length, including the holder. */
  tiedWith: string[];
}

/**
 * Who holds Longest Road, or null when nobody does.
 *
 * Needs five, and a tie awards nobody — in the real game the card stays where
 * it is until somebody breaks the tie, and with no card to track, "nobody"
 * is the honest answer rather than picking a player arbitrarily.
 */
export function longestRoadHolder(
  lengths: ReadonlyMap<string, number>,
): LongestRoadClaim | null {
  let best = 0;
  for (const length of lengths.values()) if (length > best) best = length;
  if (best < LONGEST_ROAD_MINIMUM) return null;
  const tied = [...lengths.entries()].filter(([, l]) => l === best).map(([id]) => id);
  if (tied.length !== 1) return null;
  return { playerId: tied[0]!, length: best, tiedWith: tied };
}

/**
 * Longest road for every player, with opponents' buildings cutting each one.
 *
 * `cornersByPlayer` is who holds which junctions. A player's own buildings
 * never break their own road — only other people's do.
 */
export function longestRoadByPlayer(
  events: readonly CatanPlayerExposureEvent[],
  playerIds: readonly string[],
  cornersByPlayer: ReadonlyMap<string, ReadonlySet<string>>,
  throughTurn = Number.MAX_SAFE_INTEGER,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const playerId of playerIds) {
    const blocked = new Set<string>();
    for (const [other, corners] of cornersByPlayer) {
      if (other === playerId) continue;
      for (const corner of corners) blocked.add(corner);
    }
    out.set(playerId, longestRoad(roadsOf(events, playerId, throughTurn), blocked));
  }
  return out;
}

/** A road event ready to persist. */
export function roadEvent(
  sessionId: string,
  playerId: string,
  edgeId: string,
  turnNumber: number,
  built: boolean,
  id: string,
  now = new Date().toISOString(),
): CatanPlayerExposureEvent {
  return {
    id,
    sessionId,
    playerId,
    eventType: built ? 'roadBuilt' : 'roadRemoved',
    turnNumber,
    timestamp: now,
    hexIdentifiers: [edgeId],
    // A road produces nothing. Both of these must stay empty or roads would
    // inflate expected production for everyone who builds them.
    affectedNumbers: [],
    productionWeight: 0,
    robberBlocked: false,
  };
}
