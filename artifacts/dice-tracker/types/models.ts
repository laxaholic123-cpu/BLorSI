/**
 * Core data models for Bad Luck or Skill Issue?
 *
 * Every recorded roll is an immutable event. Statistics are always calculated
 * from the event log rather than pre-aggregated fields.
 */

// ─── Primitive types ────────────────────────────────────────────────────────

export type RollSource = 'touchscreen' | 'bluetooth' | 'imported' | 'corrected';

export type DiceMode = 'D4' | 'D6' | 'D8' | 'D10' | 'D12' | 'D20' | '2D6' | 'custom';

export type GameType = 'general' | 'catan' | 'custom';

export type GameStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type ThemePreference = 'dark' | 'light' | 'system';

export type StatisticsDetailLevel = 'basic' | 'standard' | 'detailed';

export type ResourceType = 'grain' | 'ore' | 'lumber' | 'brick' | 'wool' | 'desert' | 'any';

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
  trackPlacements: boolean;
  catanRobberTracking: boolean;
  catanResourceTracking: boolean;
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
  /** Ordered array of player IDs (first = 1st place) */
  placements: string[];
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
  notes?: string;
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

/** Schema version — bump when a migration is needed */
export const SCHEMA_VERSION = 1;

/** Dice range definitions */
export const DICE_RANGES: Record<DiceMode, { min: number; max: number }> = {
  D4: { min: 1, max: 4 },
  D6: { min: 1, max: 6 },
  D8: { min: 1, max: 8 },
  D10: { min: 1, max: 10 },
  D12: { min: 1, max: 12 },
  D20: { min: 1, max: 20 },
  '2D6': { min: 2, max: 12 },
  custom: { min: 1, max: 6 }, // overridden at setup
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
