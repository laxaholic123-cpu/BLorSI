/**
 * Core data models for Bad Luck or Skill Issue?
 *
 * Every recorded roll is an immutable event. Statistics are always calculated
 * from the event log rather than pre-aggregated fields.
 */

// Catan types moved to `types/modes/catan.ts` when the mode boundary went
// in. Re-exported here so existing imports keep working; new code should
// import from the mode module directly.
export type {
  BoardExposureEvent,
  BoardPosition,
} from '@/types/boardState';
export type {
  ResourceType,
  PortResource,
  PortType,
  HexEdge,
  CatanDevCardType,
  CatanExposureEventType,
  CatanPlayerExposureEvent,
  CatanDevCardEvent,
  CatanHexDef,
  CatanPortDef,
  CatanBoardLayout,
} from '@/types/modes/catan';

// ─── Primitive types ────────────────────────────────────────────────────────

export type RollSource = 'touchscreen' | 'bluetooth' | 'imported' | 'corrected';

export type DiceMode = 'D4' | 'D6' | 'D8' | 'D10' | 'D12' | 'D20' | '2D6';

/**
 * A game mode's persisted identifier.
 *
 * 'general' is the modeless dice tracker. Every other value names a mode
 * with a registered adapter in `services/modes`. Adding a game means adding
 * its id here and registering its adapter — nothing in the core stats path
 * should need to know the value.
 */
export type GameModeId = 'catan';

export type GameType = 'general' | GameModeId;

export type GameStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export type ThemePreference = 'dark' | 'light' | 'system';

export type StatisticsDetailLevel = 'basic' | 'standard' | 'detailed';

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

/**
 * Per-session settings.
 *
 * The `catan*` flags are mode-scoped despite living on the core session.
 * They keep those names because they are the keys in storage on real
 * devices — renaming them is a migration, not a refactor.
 */
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
