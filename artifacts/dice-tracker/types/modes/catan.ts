/**
 * Catan-specific types.
 *
 * These lived in `types/models.ts` until the mode boundary went in. They are
 * re-exported from there so existing imports keep working — new code should
 * import from here, so it is obvious at the import site that a file has taken
 * a dependency on one particular game.
 *
 * Field names are load-bearing: they are the names in storage on real devices.
 * Renaming anything here is a migration, not a refactor.
 */

import type { BoardExposureEvent } from '@/types/boardState';

// ─── Catan primitives ────────────────────────────────────────────────────────

export type ResourceType =
  | 'grain' | 'ore' | 'lumber' | 'brick' | 'wool' | 'desert' | 'any';

/** Resources that can have a dedicated 2:1 port. Desert has none. */
export type PortResource = 'grain' | 'ore' | 'lumber' | 'brick' | 'wool';

/** 'generic' is a 3:1 any-resource port; the rest trade their resource 2:1. */
export type PortType = 'generic' | PortResource;

/**
 * Which face of a hex an edge sits on, numbered clockwise from the top-left.
 * Pointy-top hexes have no flat top, so the six faces are the diagonals and
 * the two verticals: NW, NE, E, SE, SW, W.
 */
export type HexEdge = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Development card types in the base game deck.
 *
 * Unlike ports, dev card draws ARE luck: the deck composition is fixed and
 * public, the order is random, and what you get is not a decision you made.
 */
export type CatanDevCardType =
  | 'knight'
  | 'victoryPoint'
  | 'roadBuilding'
  | 'yearOfPlenty'
  | 'monopoly';

export type CatanExposureEventType =
  | 'initialSettlement'
  | 'settlementBuilt'
  | 'cityUpgrade'
  | 'buildingRemoved'
  /**
   * A road. Rides in the same event stream as buildings but is NOT a building:
   * `hexIdentifiers[0]` is an edge id, `productionWeight` is 0 and
   * `affectedNumbers` is empty, because a road produces nothing.
   *
   * Safe to add because every consumer opts IN to the types it cares about —
   * `BUILDING_TYPES.includes(...)`, `=== 'initialSettlement'` — rather than
   * treating everything unrecognised as a building. Were any of them written
   * the other way round, roads would silently inflate expected production for
   * every player.
   */
  | 'roadBuilt'
  | 'roadRemoved'
  | 'robberBlockStarted'
  | 'robberBlockEnded'
  | 'manualCorrection';

// ─── Events ──────────────────────────────────────────────────────────────────

/**
 * Tracks a player's number exposure in Catan-Compatible Mode.
 * Time-aware: includes turn numbers so statistics can apply weights
 * only during the turns when the building existed.
 */
export interface CatanPlayerExposureEvent extends BoardExposureEvent {
  eventType: CatanExposureEventType;
  hexIdentifiers?: string[];
  resourceType?: ResourceType;
  robberBlocked: boolean;
  /**
   * Port this building sits on, if any. An intersection is served by at most
   * one port, so this is singular.
   *
   * Ports affect TRADE rates only — they never enter production or luck
   * calculations. They are reported as a separate placement dimension.
   */
  portAccess?: PortType;
}

/**
 * A development card draw. Immutable, like RollEvent — undo by setting
 * deletedAt rather than removing the record.
 */
export interface CatanDevCardEvent {
  id: string;
  sessionId: string;
  playerId: string;
  cardType: CatanDevCardType;
  turnNumber: number;
  /** Monotonically increasing draw order within the session */
  sequenceNumber: number;
  timestamp: string; // ISO 8601
  /** ISO 8601 — set when this draw is marked deleted (undo) */
  deletedAt?: string;
}

// ─── Board layout ────────────────────────────────────────────────────────────

/**
 * Represents a single hex tile on the Catan board.
 * Indices 0-18 read left-to-right, top-to-bottom in the 3-4-5-4-3 layout.
 */
export interface CatanHexDef {
  index: number;
  resource: ResourceType | null; // null = unknown / not yet set
  number: number | null; // null = unknown or desert
  confidence: 'high' | 'low';
}

/**
 * A port (harbour) on the sea frame, identified by the coastal hex edge it
 * faces. The two settlement intersections at the ends of that edge are the ones
 * that gain the trade rate.
 */
export interface CatanPortDef {
  /** Index of the coastal hex the port sits against, 0–18 */
  hexIndex: number;
  /** Which face of that hex meets the sea */
  edge: HexEdge;
  type: PortType;
}

/**
 * A named saved board layout that can be reloaded on subsequent games.
 *
 * Ports are stored alongside the hexes but change far less often — most groups
 * reshuffle the tiles every game while leaving the frame assembled — so a saved
 * layout's ports usually stay valid long after its hexes are stale.
 */
export interface CatanBoardLayout {
  id: string;
  name: string;
  hexes: CatanHexDef[];
  /** Added in schema v2. Backfilled with STANDARD_PORT_LAYOUT on migration. */
  ports: CatanPortDef[];
  savedAt: string; // ISO 8601
}
