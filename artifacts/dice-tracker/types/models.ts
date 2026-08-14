/**
 * Core data models for Bad Luck or Skill Issue?
 *
 * Every recorded roll is an immutable event. Statistics are always calculated
 * from the event log rather than pre-aggregated fields.
 */

// ─── Primitive types ────────────────────────────────────────────────────────

export type RollSource = 'touchscreen' | 'bluetooth' | 'imported' | 'corrected';

export type DiceMode = 'D4' | 'D6' | 'D8' | 'D10' | 'D12' | 'D20' | '2D6';

export type GameType = 'general' | 'catan';

export type GameStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type ThemePreference = 'dark' | 'light' | 'system';

export type StatisticsDetailLevel = 'basic' | 'standard' | 'detailed';

export type ResourceType = 'grain' | 'ore' | 'lumber' | 'brick' | 'wool' | 'desert' | 'any';

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
  | 'robberBlockStarted'
  | 'robberBlockEnded'
  | 'manualCorrection';

// ─── Core entities ───────────────────────────────────────────────────────────

export interface Player {
  id: string;
  displayName: string;
  /** Hex color string, e.g. "#F5A623" */
  color: string;
  /** 1-based seat number */
  seatNumber: number;
  createdAt: string; // ISO 8601
}

export interface GameSessionSettings {
  recordIndividualDice: boolean;
  trackWinner: boolean;
  catanRobberTracking: boolean;
  catanResourceTracking: boolean;
  /** Record development card draws so deck luck can be measured. */
  catanDevCardTracking: boolean;
}

export interface GameSession {
  id: string;
  gameType: GameType;
  customGameName?: string;
  diceMode: DiceMode;
  /** Inclusive minimum roll value */
  minimumRoll: number;
  /** Inclusive maximum roll value */
  maximumRoll: number;
  players: Player[];
  /** Index into players[] */
  currentPlayerIndex: number;
  autoAdvancePlayer: boolean;
  startedAt: string; // ISO 8601
  endedAt?: string; // ISO 8601
  status: GameStatus;
  winnerPlayerId?: string;
  settings: GameSessionSettings;
  finalVerdict?: string;
  /** Schema version for migration support */
  schemaVersion: number;
}

/**
 * Immutable roll event. Never overwrite — soft-delete and create a replacement.
 */
export interface RollEvent {
  id: string;
  sessionId: string;
  playerId: string;
  value: number;
  /** Individual die values, e.g. [3, 4] for a 2D6 roll of 7 */
  individualDiceValues?: number[];
  /** Game turn number at the time of the roll */
  turnNumber: number;
  /** Monotonically increasing sequence within the session */
  sequenceNumber: number;
  timestamp: string; // ISO 8601
  source: RollSource;
  /** ISO 8601 — set when this event is marked deleted (undo) */
  deletedAt?: string;
  /** ID of the original event this corrects */
  correctionOfEventId?: string;
}

/**
 * Tracks a player's number exposure in Catan-Compatible Mode.
 * Time-aware: includes turn numbers so statistics can apply weights
 * only during the turns when the building existed.
 */
export interface CatanPlayerExposureEvent {
  id: string;
  sessionId: string;
  playerId: string;
  eventType: CatanExposureEventType;
  /** Turn number when this event took effect */
  turnNumber: number;
  timestamp: string; // ISO 8601
  /** Dice numbers this building is exposed to (2–12, excluding 7) */
  affectedNumbers: number[];
  hexIdentifiers?: string[];
  /**
   * Production weight:
   *   1 = settlement
   *   2 = city
   *   0 = removed or blocked
   */
  productionWeight: number;
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
  notes?: string;
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

export interface AppSettings {
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  themePreference: ThemePreference;
  reducedMotion: boolean;
  defaultDiceMode: DiceMode;
  defaultPlayerCount: number;
  defaultAutoAdvance: boolean;
  statisticsDetailLevel: StatisticsDetailLevel;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  hapticsEnabled: true,
  soundEnabled: false,
  themePreference: 'dark',
  reducedMotion: false,
  defaultDiceMode: '2D6',
  defaultPlayerCount: 4,
  defaultAutoAdvance: true,
  statisticsDetailLevel: 'standard',
};

/**
 * Schema version — bump when a migration is needed.
 *
 * v2: CatanBoardLayout gained a required `ports` array.
 * v3: GameSessionSettings dropped the inert `trackPlacements` flag (nothing
 *     ever read it, and GameSession.placements was never populated) and gained
 *     catanDevCardTracking.
 */
export const SCHEMA_VERSION = 3;

/** Dice range definitions */
export const DICE_RANGES: Record<DiceMode, { min: number; max: number }> = {
  D4: { min: 1, max: 4 },
  D6: { min: 1, max: 6 },
  D8: { min: 1, max: 8 },
  D10: { min: 1, max: 10 },
  D12: { min: 1, max: 12 },
  D20: { min: 1, max: 20 },
  '2D6': { min: 2, max: 12 },
};

/** Palette of distinct player colors */
export const PLAYER_COLORS: string[] = [
  '#F5A623', // amber
  '#4A90E2', // blue
  '#5CB85C', // green
  '#E05C5C', // red
  '#9B59B6', // purple
  '#E67E22', // orange
  '#1ABC9C', // teal
  '#E91E63', // pink
];

/** Generate a portable unique ID (no native crypto required) */
export const generateId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).substring(2, 11);

// ─── Catan board layout types ────────────────────────────────────────────────

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
