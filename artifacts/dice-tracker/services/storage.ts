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
  CatanBoardLayout,
  CatanDevCardEvent,
  CatanHexDef,
  CatanPlayerExposureEvent,
  CatanPortDef,
  DiceMode,
  GameSession,
  RollEvent,
} from '@/types/models';
import { DEFAULT_SETTINGS, DICE_RANGES, SCHEMA_VERSION } from '@/types/models';
import { STANDARD_PORT_LAYOUT } from '@/services/catanBoard';
import { BOARD_HEX_COUNT } from '@/services/boardConstraints';

// ─── Storage keys ────────────────────────────────────────────────────────────

const KEYS = {
  SCHEMA_VERSION: 'blosi:schema_version',
  SETTINGS: 'blosi:settings',
  SESSION_IDS: 'blosi:session_ids',
  ACTIVE_SESSION_ID: 'blosi:active_session_id',
  SESSION: (id: string) => `blosi:session:${id}`,
  ROLLS: (sessionId: string) => `blosi:rolls:${sessionId}`,
  EXPOSURES: (sessionId: string) => `blosi:exposures:${sessionId}`,
  DEV_CARDS: (sessionId: string) => `blosi:devcards:${sessionId}`,
} as const;

/** Owned by boardLayouts.ts; referenced here so migrations can reach it. */
const LAYOUTS_KEY = 'blosi:board_layouts';

// ─── Schema migration ─────────────────────────────────────────────────────────

/**
 * v1 → v2: CatanBoardLayout gained a required `ports` array.
 *
 * Existing layouts were saved before ports existed, so they are backfilled with
 * the standard frame arrangement — which is what most groups are using anyway,
 * and is editable afterwards. Layouts that somehow already carry ports are left
 * untouched so re-running the migration cannot clobber real data.
 */
const migrateBoardLayoutsToV2 = async (): Promise<void> => {
  const raw = await AsyncStorage.getItem(LAYOUTS_KEY);
  if (!raw) return; // Nothing saved yet — nothing to migrate.

  const layouts = JSON.parse(raw) as Array<Partial<CatanBoardLayout>>;
  if (!Array.isArray(layouts)) return;

  let changed = false;
  const upgraded = layouts.map(layout => {
    if (Array.isArray(layout.ports)) return layout;
    changed = true;
    return { ...layout, ports: [...STANDARD_PORT_LAYOUT] };
  });

  if (changed) {
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify(upgraded));
  }
};

/**
 * v2 → v3: GameSessionSettings dropped `trackPlacements` and gained
 * `catanDevCardTracking`; GameSession dropped `placements`.
 *
 * Both removed fields were inert — nothing ever read the flag and the array was
 * never populated — so this rewrite loses no information. It runs anyway rather
 * than leaving the dead keys in storage, because a stored shape that no longer
 * matches the type is exactly what makes the NEXT migration hard to reason
 * about.
 */
const migrateSessionSettingsToV3 = async (): Promise<void> => {
  const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
  const indexed: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  const onDisk = await scanSessionIdsFromKeys();
  const ids = [...new Set([...indexed, ...onDisk])];
  if (ids.length === 0) return;

  const pairs = await AsyncStorage.multiGet(ids.map(id => KEYS.SESSION(id)));
  const writes: [string, string][] = [];

  for (const [key, json] of pairs) {
    if (!json) continue;
    let session: Record<string, unknown>;
    try {
      session = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue; // Leave a corrupted record alone rather than making it worse.
    }

    const settings = (session['settings'] ?? {}) as Record<string, unknown>;
    const needsUpdate =
      'trackPlacements' in settings ||
      'placements' in session ||
      !('catanDevCardTracking' in settings);
    if (!needsUpdate) continue;

    delete settings['trackPlacements'];
    delete session['placements'];
    // Existing games were played without dev card tracking, so leaving it off
    // is the only reading of the past that is actually true.
    if (!('catanDevCardTracking' in settings)) settings['catanDevCardTracking'] = false;
    session['settings'] = settings;

    writes.push([key, JSON.stringify(session)]);
  }

  if (writes.length > 0) await AsyncStorage.multiSet(writes);
};

/**
 * Bring stored data up to SCHEMA_VERSION.
 *
 * Migrations run in order and must be idempotent — a failure partway through
 * leaves the version stamp unchanged, so the next launch retries from the same
 * point. The version is only stamped after every step has succeeded, which is
 * why the stamp is inside the try rather than in a finally.
 */
export const ensureSchemaVersion = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(KEYS.SCHEMA_VERSION);
    const version = stored ? parseInt(stored, 10) : 0;
    if (Number.isNaN(version) || version >= SCHEMA_VERSION) {
      if (version !== SCHEMA_VERSION) {
        await AsyncStorage.setItem(KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION));
      }
      return;
    }

    if (version < 2) {
      await migrateBoardLayoutsToV2();
    }
    if (version < 3) {
      await migrateSessionSettingsToV3();
    }

    await AsyncStorage.setItem(KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION));
  } catch {
    // Non-fatal — the app still works, and the unchanged version stamp means
    // the migration will be attempted again on the next launch.
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
  // NOTE: Intentionally re-throws — callers that depend on persistence correctness
  // (updateSession in GameContext) must be able to detect and handle write failures.
  await AsyncStorage.setItem(KEYS.SESSION(session.id), JSON.stringify(session));
  // Maintain an ordered index of all session IDs (best-effort, non-fatal).
  // If this write fails the session is still recoverable — loadAllSessions()
  // rebuilds the index by scanning blosi:session:* keys.
  try {
    const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
    const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!ids.includes(session.id)) {
      const updated = [session.id, ...ids];
      await AsyncStorage.setItem(KEYS.SESSION_IDS, JSON.stringify(updated));
    }
  } catch {
    // Index maintenance is non-fatal — the session record itself was saved above
  }
};

/**
 * Session IDs present on disk, discovered by scanning keys rather than trusting
 * the index. Used to heal an index that lost entries to a failed write — without
 * this, a single failed index write hides a session from history permanently.
 */
const scanSessionIdsFromKeys = async (): Promise<string[]> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = 'blosi:session:';
    return allKeys.filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length));
  } catch {
    return [];
  }
};

export const loadSession = async (id: string): Promise<GameSession | null> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.SESSION(id));
    if (!json) return null;
    const raw = JSON.parse(json) as GameSession;
    const normalized = normalizeSession(raw);
    // Write back immediately if the session was migrated, so stale values
    // don't persist across future reads.
    if (normalized !== raw) {
      await AsyncStorage.setItem(KEYS.SESSION(id), JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
};

export const loadAllSessions = async (): Promise<GameSession[]> => {
  try {
    const raw = await AsyncStorage.getItem(KEYS.SESSION_IDS);
    const indexed: string[] = raw ? (JSON.parse(raw) as string[]) : [];

    // Heal the index: any session on disk that the index lost (failed index
    // write, interrupted delete) is appended rather than being lost forever.
    const onDisk = await scanSessionIdsFromKeys();
    const known = new Set(indexed);
    const orphans = onDisk.filter(id => !known.has(id));
    const ids = [...indexed, ...orphans];
    if (orphans.length > 0) {
      try {
        await AsyncStorage.setItem(KEYS.SESSION_IDS, JSON.stringify(ids));
      } catch {
        // Healing is best-effort; the orphans are still returned below
      }
    }
    if (ids.length === 0) return [];

    // One multiGet instead of a getItem per session — history with a few
    // hundred games was doing a few hundred serial round-trips.
    const pairs = await AsyncStorage.multiGet(ids.map(id => KEYS.SESSION(id)));
    const sessions: GameSession[] = [];
    for (const [, json] of pairs) {
      if (!json) continue;
      try {
        sessions.push(normalizeSession(JSON.parse(json) as GameSession));
      } catch {
        // Skip a corrupted record rather than losing the whole history
      }
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
  // NOTE: Intentionally re-throws — callers that depend on persistence correctness
  // (persistRollEvents in GameContext) must be able to detect and handle write failures.
  await AsyncStorage.setItem(KEYS.ROLLS(sessionId), JSON.stringify(events));
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

// ─── Catan development card events ────────────────────────────────────────────

export const saveDevCardEvents = async (
  sessionId: string,
  events: CatanDevCardEvent[],
): Promise<void> => {
  // Re-throws like saveRollEvents — a lost draw silently corrupts deck luck.
  await AsyncStorage.setItem(KEYS.DEV_CARDS(sessionId), JSON.stringify(events));
};

export const loadDevCardEvents = async (sessionId: string): Promise<CatanDevCardEvent[]> => {
  try {
    const json = await AsyncStorage.getItem(KEYS.DEV_CARDS(sessionId));
    return json ? (JSON.parse(json) as CatanDevCardEvent[]) : [];
  } catch {
    return [];
  }
};

// ─── Export / import ──────────────────────────────────────────────────────────

/**
 * Serialise every session, roll and exposure event to a portable JSON backup.
 *
 * Unlike the rest of this module, this function DOES throw. A backup is the one
 * operation where failing quietly is worse than failing loudly: returning '{}'
 * handed the user a valid-looking file containing none of their history, which
 * they would only discover after wiping the device it came from.
 */
export const exportAllData = async (): Promise<string> => {
  const settings = await loadSettings();
  const sessions = await loadAllSessions();
  const rollsBySession: Record<string, RollEvent[]> = {};
  const exposuresBySession: Record<string, CatanPlayerExposureEvent[]> = {};
  const devCardsBySession: Record<string, CatanDevCardEvent[]> = {};
  for (const session of sessions) {
    rollsBySession[session.id] = await loadRollEvents(session.id);
    if (session.gameType === 'catan') {
      exposuresBySession[session.id] = await loadExposureEvents(session.id);
      devCardsBySession[session.id] = await loadDevCardEvents(session.id);
    }
  }
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      sessions,
      rollsBySession,
      exposuresBySession,
      devCardsBySession,
    },
    null,
    2,
  );
};

// ─── Import ───────────────────────────────────────────────────────────────────

/** Shape check for a roll event coming from an untrusted backup file. */
const isPlausibleRollEvent = (e: unknown): e is RollEvent =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as RollEvent).id === 'string' &&
  typeof (e as RollEvent).value === 'number' &&
  Number.isFinite((e as RollEvent).value);

/** Shape check for an exposure event coming from an untrusted backup file. */
const isPlausibleExposureEvent = (e: unknown): e is CatanPlayerExposureEvent =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as CatanPlayerExposureEvent).id === 'string' &&
  typeof (e as CatanPlayerExposureEvent).playerId === 'string' &&
  Array.isArray((e as CatanPlayerExposureEvent).affectedNumbers);

/** Shape check for a dev card draw coming from an untrusted backup file. */
const isPlausibleDevCardEvent = (e: unknown): e is CatanDevCardEvent =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as CatanDevCardEvent).id === 'string' &&
  typeof (e as CatanDevCardEvent).playerId === 'string' &&
  typeof (e as CatanDevCardEvent).cardType === 'string';

/**
 * Merge a backup into local storage.
 *
 * Import is additive: a session already present on this device is left alone
 * rather than overwritten. Restoring a stale backup should never roll back
 * games played since it was taken, and the session ID is the only thing linking
 * the two — so when in doubt, the copy on the device wins.
 */
export const importAllData = async (
  json: string,
): Promise<{ imported: number; skipped: number; error?: string }> => {
  try {
    const data = JSON.parse(json) as {
      sessions?: GameSession[];
      rollsBySession?: Record<string, unknown>;
      exposuresBySession?: Record<string, unknown>;
      devCardsBySession?: Record<string, unknown>;
    };
    if (!data.sessions || !Array.isArray(data.sessions)) {
      return { imported: 0, skipped: 0, error: 'Invalid backup format — no sessions found.' };
    }

    let imported = 0;
    let skipped = 0;
    for (const rawSession of data.sessions) {
      if (!rawSession || typeof rawSession.id !== 'string' || !rawSession.id) {
        skipped++;
        continue;
      }
      if (await AsyncStorage.getItem(KEYS.SESSION(rawSession.id))) {
        skipped++;
        continue;
      }

      const session = normalizeSession(rawSession);
      await saveSession(session);

      const rawRolls = data.rollsBySession?.[session.id];
      if (Array.isArray(rawRolls)) {
        await saveRollEvents(session.id, rawRolls.filter(isPlausibleRollEvent));
      }
      const rawExposures = data.exposuresBySession?.[session.id];
      if (Array.isArray(rawExposures)) {
        await saveExposureEvents(session.id, rawExposures.filter(isPlausibleExposureEvent));
      }
      const rawDevCards = data.devCardsBySession?.[session.id];
      if (Array.isArray(rawDevCards)) {
        await saveDevCardEvents(session.id, rawDevCards.filter(isPlausibleDevCardEvent));
      }
      imported++;
    }
    return { imported, skipped };
  } catch (err) {
    return { imported: 0, skipped: 0, error: `Parse error: ${String(err)}` };
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
    if (!json) return null;
    const raw = JSON.parse(json) as GameSession;
    const normalized = normalizeSession(raw);
    // Persist the migrated prefill so subsequent reads are already clean.
    if (normalized !== raw) {
      await AsyncStorage.setItem(PREFILL_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
};

export const clearPrefillSession = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(PREFILL_KEY);
  } catch {}
};

// ─── Active board handoff ─────────────────────────────────────────────────────

const ACTIVE_BOARD_KEY = 'blosi:active_board';

/**
 * The board the current game is being played on, when it is known exactly.
 *
 * Set by the generator; read by exposure setup so settlements can be picked off
 * the real board instead of typed in as loose numbers. Absent for scanned or
 * hand-entered games, and the exposure screen treats absence as "fall back to
 * tapping numbers" rather than as an error.
 *
 * These three swallow their errors, unlike the roll and exposure paths. That is
 * deliberate and it is the one place it is safe: this is a convenience handoff,
 * not a record. Losing it costs the player a nicer input mode, not any data —
 * and the fallback is the input mode they would have had anyway.
 */
export interface ActiveBoard {
  hexes: CatanHexDef[];
  ports: CatanPortDef[];
}

export const saveActiveBoard = async (board: ActiveBoard): Promise<void> => {
  try {
    await AsyncStorage.setItem(ACTIVE_BOARD_KEY, JSON.stringify(board));
  } catch {}
};

export const loadActiveBoard = async (): Promise<ActiveBoard | null> => {
  try {
    const json = await AsyncStorage.getItem(ACTIVE_BOARD_KEY);
    if (!json) return null;
    const raw = JSON.parse(json) as Partial<ActiveBoard>;
    // A board that is not the right shape is worse than no board: it would put
    // wrong numbers on a player's settlements without anyone noticing.
    if (!Array.isArray(raw.hexes) || raw.hexes.length !== BOARD_HEX_COUNT) return null;
    if (!Array.isArray(raw.ports)) return null;
    return { hexes: raw.hexes, ports: raw.ports };
  } catch {
    return null;
  }
};

export const clearActiveBoard = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(ACTIVE_BOARD_KEY);
  } catch {}
};

// ─── Diagnostics: board reader ground truth ───────────────────────────────────

const GROUND_TRUTH_KEY = 'blosi:diag_ground_truth';

/**
 * The correct answer for the board currently on the table, for scoring reads.
 *
 * Diagnostics only — nothing in the game reads this. It exists because
 * evaluating the board reader by eye means checking 19 tiles per capture and
 * losing your place, which is how a testing session produces "seemed worse"
 * instead of a number.
 *
 * Best-effort like the active board handoff: if it fails, scoring silently
 * turns off and captures still work. It is a measurement aid, not a record.
 */
export const saveGroundTruth = async (hexes: CatanHexDef[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(GROUND_TRUTH_KEY, JSON.stringify(hexes));
  } catch {}
};

export const loadGroundTruth = async (): Promise<CatanHexDef[] | null> => {
  try {
    const json = await AsyncStorage.getItem(GROUND_TRUTH_KEY);
    if (!json) return null;
    const raw = JSON.parse(json) as CatanHexDef[];
    // A partial board would score every read against nonsense.
    if (!Array.isArray(raw) || raw.length !== BOARD_HEX_COUNT) return null;
    return raw;
  } catch {
    return null;
  }
};

export const clearGroundTruth = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(GROUND_TRUTH_KEY);
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
