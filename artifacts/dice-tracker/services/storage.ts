/**
 * Local persistence layer for Bad Luck or Skill Issue?
 *
 * Storage engine: @react-native-async-storage/async-storage
 * Key prefix:     blosi:
 * Schema version: 1
 *
 * Design principles:
 * - All reads/writes are wrapped in try/catch — the app never crashes due to storage errors
 * - Sessions are stored individually so a corrupted record doesn't block all history
 * - A session index (blosi:session_ids) maintains insertion order
 * - Schema versioning allows future migrations without data loss
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AppSettings,
  CatanPlayerExposureEvent,
  DiceMode,
  GameSession,
  RollEvent,
} from '@/types/models';
import { DEFAULT_SETTINGS, DICE_RANGES, SCHEMA_VERSION } from '@/types/models';

// ─── Storage keys ────────────────────────────────────────────────────────────

const KEYS = {
  SCHEMA_VERSION: 'blosi:schema_version',
  SETTINGS: 'blosi:settings',
  SESSION_IDS: 'blosi:session_ids',
  ACTIVE_SESSION_ID: 'blosi:active_session_id',
  SESSION: (id: string) => `blosi:session:${id}`,
  ROLLS: (sessionId: string) => `blosi:rolls:${sessionId}`,
  EXPOSURES: (sessionId: string) => `blosi:exposures:${sessionId}`,
} as const;

// ─── Schema migration ─────────────────────────────────────────────────────────

export const ensureSchemaVersion = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(KEYS.SCHEMA_VERSION);
    const version = stored ? parseInt(stored, 10) : 0;
    if (version < SCHEMA_VERSION) {
      // Future migrations go here, keyed by version number.
      // Example: if (version < 2) { await migrateTo2(); }
      await AsyncStorage.setItem(KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION));
    }
  } catch {
    // Non-fatal — the app still works without a successful migration
  }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Dice modes that no longer exist — map to a supported fallback. */
const LEGACY_DICE_MODE_MAP: Record<string, DiceMode> = {
  custom: '2D6',
};

/**
 * Normalise a persisted session that may have been recorded with a dice mode
 * or game type that has since been removed (e.g. diceMode:'custom').
 * Maps the stale fields to supported equivalents so the session can be
 * displayed and played without crashing.
 */
export const normalizeSession = (session: GameSession): GameSession => {
  const rawMode = session.diceMode as string;
  const rawType = session.gameType as string;
  if (!LEGACY_DICE_MODE_MAP[rawMode] && rawType !== 'custom') return session;

  const normalizedMode: DiceMode = LEGACY_DICE_MODE_MAP[rawMode] ?? session.diceMode;
  // Map 'custom' game type to 'general'; keep 'catan' unchanged
  const normalizedType = rawType === 'custom' ? 'general' : session.gameType;
  // Align stored min/max with the new mode's canonical range
  const range = DICE_RANGES[normalizedMode];
  return {
    ...session,
    diceMode: normalizedMode,
    gameType: normalizedType,
    minimumRoll: range.min,
    maximumRoll: range.max,
  };
};

export const loadSettings = async (): Promise<AppSettings> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!json) return { ...DEFAULT_SETTINGS };
    const stored = JSON.parse(json) as Partial<AppSettings>;
    // Normalise any legacy dice modes that have since been removed
    if (stored.defaultDiceMode && LEGACY_DICE_MODE_MAP[stored.defaultDiceMode as string]) {
      stored.defaultDiceMode = LEGACY_DICE_MODE_MAP[stored.defaultDiceMode as string];
    }
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = async (settings: AppSettings): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch {
    // Non-fatal
  }
};

// ─── Active session tracking ──────────────────────────────────────────────────

export const getActiveSessionId = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(KEYS.ACTIVE_SESSION_ID);
  } catch {
    return null;
  }
};

export const setActiveSessionId = async (id: string | null): Promise<void> => {
  try {
    if (id) {
      await AsyncStorage.setItem(KEYS.ACTIVE_SESSION_ID, id);
    } else {
      await AsyncStorage.removeItem(KEYS.ACTIVE_SESSION_ID);
    }
  } catch {
    // Non-fatal
  }
};

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const saveSession = async (session: GameSession): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEYS.SESSION(session.id), JSON.stringify(session));
    // Maintain an ordered index of all session IDs
    const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!ids.includes(session.id)) {
      const updated = [session.id, ...ids];
      await AsyncStorage.setItem(KEYS.SESSION_IDS, JSON.stringify(updated));
    }
  } catch {
    // Non-fatal
  }
};

export const loadSession = async (id: string): Promise<GameSession | null> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.SESSION(id));
    const session = json ? (JSON.parse(json) as GameSession) : null;
    return session ? normalizeSession(session) : null;
  } catch {
    return null;
  }
};

export const loadAllSessions = async (): Promise<GameSession[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const sessions: GameSession[] = [];
    for (const id of ids) {
      const session = await loadSession(id);
      if (session) sessions.push(session);
    }
    return sessions;
  } catch {
    return [];
  }
};

export const deleteSession = async (id: string): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([KEYS.SESSION(id), KEYS.ROLLS(id), KEYS.EXPOSURES(id)]);
    const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
    if (raw) {
      const ids = (JSON.parse(raw) as string[]).filter((sid) => sid !== id);
      await AsyncStorage.setItem(KEYS.SESSION_IDS, JSON.stringify(ids));
    }
  } catch {
    // Non-fatal
  }
};

// ─── Roll events ──────────────────────────────────────────────────────────────

export const saveRollEvents = async (sessionId: string, events: RollEvent[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEYS.ROLLS(sessionId), JSON.stringify(events));
  } catch {
    // Non-fatal
  }
};

export const loadRollEvents = async (sessionId: string): Promise<RollEvent[]> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.ROLLS(sessionId));
    return json ? (JSON.parse(json) as RollEvent[]) : [];
  } catch {
    return [];
  }
};

// ─── Catan exposure events ────────────────────────────────────────────────────

export const saveExposureEvents = async (
  sessionId: string,
  events: CatanPlayerExposureEvent[],
): Promise<void> => {
  try {
    await AsyncStorage.setItem(KEYS.EXPOSURES(sessionId), JSON.stringify(events));
  } catch {
    // Non-fatal
  }
};

export const loadExposureEvents = async (
  sessionId: string,
): Promise<CatanPlayerExposureEvent[]> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.EXPOSURES(sessionId));
    return json ? (JSON.parse(json) as CatanPlayerExposureEvent[]) : [];
  } catch {
    return [];
  }
};

// ─── Export / import ──────────────────────────────────────────────────────────

export const exportAllData = async (): Promise<string> => {
  try {
    const settings = await loadSettings();
    const sessions = await loadAllSessions();
    const rollsBySession: Record<string, RollEvent[]> = {};
    const exposuresBySession: Record<string, CatanPlayerExposureEvent[]> = {};
    for (const session of sessions) {
      rollsBySession[session.id] = await loadRollEvents(session.id);
      if (session.gameType === 'catan') {
        exposuresBySession[session.id] = await loadExposureEvents(session.id);
      }
    }
    return JSON.stringify(
      { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings, sessions, rollsBySession, exposuresBySession },
      null,
      2,
    );
  } catch {
    return '{}';
  }
};

// ─── Import ───────────────────────────────────────────────────────────────────

export const importAllData = async (json: string): Promise<{ imported: number; error?: string }> => {
  try {
    const data = JSON.parse(json) as {
      sessions?: GameSession[];
      rollsBySession?: Record<string, RollEvent[]>;
      exposuresBySession?: Record<string, CatanPlayerExposureEvent[]>;
    };
    if (!data.sessions || !Array.isArray(data.sessions)) {
      return { imported: 0, error: 'Invalid backup format — no sessions found.' };
    }
    let imported = 0;
    for (const rawSession of data.sessions) {
      if (!rawSession.id) continue;
      const session = normalizeSession(rawSession);
      await saveSession(session);
      if (data.rollsBySession?.[session.id]) {
        await saveRollEvents(session.id, data.rollsBySession[session.id]!);
      }
      if (data.exposuresBySession?.[session.id]) {
        await saveExposureEvents(session.id, data.exposuresBySession[session.id]!);
      }
      imported++;
    }
    return { imported };
  } catch (err) {
    return { imported: 0, error: `Parse error: ${String(err)}` };
  }
};

// ─── Duplicate setup prefill ──────────────────────────────────────────────────

const PREFILL_KEY = 'blosi:prefill_session';

export const savePrefillSession = async (session: GameSession): Promise<void> => {
  try {
    await AsyncStorage.setItem(PREFILL_KEY, JSON.stringify(session));
  } catch {}
};

export const loadPrefillSession = async (): Promise<GameSession | null> => {
  try {
    const json = await AsyncStorage.getItem(PREFILL_KEY);
    return json ? (JSON.parse(json) as GameSession) : null;
  } catch {
    return null;
  }
};

export const clearPrefillSession = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(PREFILL_KEY);
  } catch {}
};

export const clearAllData = async (): Promise<void> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const appKeys = allKeys.filter((k) => k.startsWith('blosi:'));
    if (appKeys.length > 0) {
      await AsyncStorage.multiRemove(appKeys);
    }
  } catch {
    // Non-fatal
  }
};
