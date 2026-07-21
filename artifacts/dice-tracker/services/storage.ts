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
  GameSession,
  RollEvent,
} from '@/types/models';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '@/types/models';

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

export const loadSettings = async (): Promise<AppSettings> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!json) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(json) as Partial<AppSettings>) };
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
    return json ? (JSON.parse(json) as GameSession) : null;
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
