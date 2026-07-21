/**
 * RollInputService — the single canonical entry point for all roll recording.
 *
 * All input sources (touchscreen, bluetooth, imported, corrected) must go
 * through this service. Every function is a pure transformation — it returns
 * a new event array and never mutates existing events or calls storage.
 * The caller is responsible for persisting results via GameContext.
 */

import { generateId } from '@/types/models';
import type { DiceMode, GameSession, RollEvent, RollSource } from '@/types/models';

// ─── Roll recording ───────────────────────────────────────────────────────────

export interface RecordRollInput {
  session: GameSession;
  playerId: string;
  value: number;
  individualDiceValues?: number[];
  source: RollSource;
}

/**
 * Append a new immutable RollEvent to the event list.
 * Returns the updated event array — caller persists.
 */
export const recordRoll = (
  input: RecordRollInput,
  currentEvents: RollEvent[],
): RollEvent[] => {
  const { session, playerId, value, individualDiceValues, source } = input;
  const activeEvents = currentEvents.filter(e => !e.deletedAt);
  const playerCount = Math.max(1, session.players.length);
  const turnNumber = Math.floor(activeEvents.length / playerCount) + 1;
  const sequenceNumber = currentEvents.length + 1;

  const event: RollEvent = {
    id: generateId(),
    sessionId: session.id,
    playerId,
    value,
    individualDiceValues,
    turnNumber,
    sequenceNumber,
    timestamp: new Date().toISOString(),
    source,
  };

  return [...currentEvents, event];
};

/**
 * Soft-delete the most recent non-deleted event (undo).
 * Returns the updated event array and the event that was undone (or null).
 * No data is removed — deletedAt is set.
 */
export const undoLastRoll = (
  events: RollEvent[],
): { events: RollEvent[]; undoneEvent: RollEvent | null } => {
  const lastActive = [...events].reverse().find(e => !e.deletedAt) ?? null;
  if (!lastActive) return { events, undoneEvent: null };

  const updated = events.map(e =>
    e.id === lastActive.id ? { ...e, deletedAt: new Date().toISOString() } : e,
  );
  return { events: updated, undoneEvent: lastActive };
};

/**
 * Create a roll correction: soft-delete the original event and append a new
 * event with correctionOfEventId pointing to the original.
 */
export const correctRoll = (
  originalEventId: string,
  newValue: number,
  currentEvents: RollEvent[],
): RollEvent[] => {
  const original = currentEvents.find(e => e.id === originalEventId);
  if (!original) return currentEvents;

  const correction: RollEvent = {
    ...original,
    id: generateId(),
    value: newValue,
    timestamp: new Date().toISOString(),
    source: 'corrected',
    correctionOfEventId: originalEventId,
    deletedAt: undefined,
  };

  return [
    ...currentEvents.map(e =>
      e.id === originalEventId ? { ...e, deletedAt: new Date().toISOString() } : e,
    ),
    correction,
  ];
};

// ─── Player navigation ────────────────────────────────────────────────────────

export const getNextPlayerIndex = (current: number, total: number): number =>
  (current + 1) % total;

export const getPrevPlayerIndex = (current: number, total: number): number =>
  (current - 1 + total) % total;

// ─── Dice value helpers ───────────────────────────────────────────────────────

/** Returns the ordered list of result values for the given dice mode. */
export const getDiceValues = (
  mode: DiceMode,
  customMin = 1,
  customMax = 6,
): number[] => {
  const range = (a: number, b: number) =>
    Array.from({ length: b - a + 1 }, (_, i) => a + i);
  switch (mode) {
    case 'D4':     return range(1, 4);
    case 'D6':     return range(1, 6);
    case 'D8':     return range(1, 8);
    case 'D10':    return range(1, 10);
    case 'D12':    return range(1, 12);
    case 'D20':    return range(1, 20);
    case '2D6':    return range(2, 12);
    case 'custom': return range(customMin, customMax);
    default:       return range(1, 6);
  }
};

/** Returns the number of grid columns appropriate for a dice mode / range size. */
export const getGridColumns = (mode: DiceMode, rangeSize: number): number => {
  if (mode === 'D4')  return 2;
  if (mode === 'D6')  return 3;
  if (mode === 'D8')  return 4;
  if (mode === 'D10') return 5;
  if (mode === 'D12') return 4;
  if (mode === 'D20') return 5;
  if (mode === '2D6') return 4;
  // Custom
  if (rangeSize <= 4)  return 2;
  if (rangeSize <= 9)  return 3;
  if (rangeSize <= 16) return 4;
  return 5;
};

/**
 * When a custom range has > 20 values, a keypad input is shown instead
 * of a full button grid.
 */
export const shouldUseKeypad = (mode: DiceMode, min: number, max: number): boolean =>
  mode === 'custom' && max - min + 1 > 20;
