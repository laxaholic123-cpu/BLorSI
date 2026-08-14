/**
 * Schema migration tests.
 *
 * This is the first migration the app has actually run, so these tests cover the
 * runner's contract as much as the v2 step itself: it must be idempotent, must
 * not stamp a version it failed to reach, and must leave real data alone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ensureSchemaVersion } from '@/services/storage';

// Keep the migration off the disk — same in-memory mock the storage tests use.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { loadBoardLayouts, saveBoardLayout } from '@/services/boardLayouts';
import { PORT_COUNT, STANDARD_PORT_LAYOUT, validatePortLayout } from '@/services/catanBoard';
import { SCHEMA_VERSION } from '@/types/models';
import type { CatanHexDef } from '@/types/models';

const VERSION_KEY = 'blosi:schema_version';
const LAYOUTS_KEY = 'blosi:board_layouts';

const hexes = (): CatanHexDef[] =>
  Array.from({ length: 19 }, (_, i) => ({
    index: i,
    resource: 'grain' as const,
    number: 6,
    confidence: 'high' as const,
  }));

/** A layout as it would have been written by schema v1 — no ports field. */
const v1Layout = (id: string, name: string) => ({
  id,
  name,
  hexes: hexes(),
  savedAt: '2026-01-01T00:00:00Z',
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SCHEMA_VERSION', () => {
  it('is 3 — v2 added board layout ports, v3 reworked session settings', () => {
    expect(SCHEMA_VERSION).toBe(3);
  });
});

describe('ensureSchemaVersion — v1 to v2', () => {
  it('backfills ports on layouts saved before ports existed', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(
      LAYOUTS_KEY,
      JSON.stringify([v1Layout('a', 'Kitchen table'), v1Layout('b', 'Games night')]),
    );

    await ensureSchemaVersion();

    const raw = await AsyncStorage.getItem(LAYOUTS_KEY);
    const layouts = JSON.parse(raw!) as Array<{ id: string; ports: unknown[] }>;
    expect(layouts).toHaveLength(2);
    for (const layout of layouts) {
      expect(layout.ports).toHaveLength(PORT_COUNT);
    }
    expect(await AsyncStorage.getItem(VERSION_KEY)).toBe(String(SCHEMA_VERSION));
  });

  it('backfills a layout that validates as a legal port arrangement', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify([v1Layout('a', 'Board')]));

    await ensureSchemaVersion();

    const layouts = await loadBoardLayouts();
    expect(validatePortLayout(layouts[0]!.ports)).toEqual([]);
  });

  it('preserves everything else about the layout', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify([v1Layout('a', 'Kitchen table')]));

    await ensureSchemaVersion();

    const layouts = await loadBoardLayouts();
    expect(layouts[0]!.id).toBe('a');
    expect(layouts[0]!.name).toBe('Kitchen table');
    expect(layouts[0]!.hexes).toHaveLength(19);
    expect(layouts[0]!.savedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('is idempotent — running it twice changes nothing', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify([v1Layout('a', 'Board')]));

    await ensureSchemaVersion();
    const afterFirst = await AsyncStorage.getItem(LAYOUTS_KEY);
    await ensureSchemaVersion();
    const afterSecond = await AsyncStorage.getItem(LAYOUTS_KEY);

    expect(afterSecond).toBe(afterFirst);
  });

  it('does not clobber ports a layout already has', async () => {
    const custom = [...STANDARD_PORT_LAYOUT].reverse();
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(
      LAYOUTS_KEY,
      JSON.stringify([{ ...v1Layout('a', 'Board'), ports: custom }]),
    );

    await ensureSchemaVersion();

    const layouts = await loadBoardLayouts();
    expect(layouts[0]!.ports).toEqual(custom);
  });

  it('handles a fresh install with nothing stored', async () => {
    await ensureSchemaVersion();
    expect(await AsyncStorage.getItem(VERSION_KEY)).toBe(String(SCHEMA_VERSION));
    expect(await AsyncStorage.getItem(LAYOUTS_KEY)).toBeNull();
  });

  it('stamps the version for storage predating the version key', async () => {
    // version 0 — data written before schema_version was ever recorded
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify([v1Layout('a', 'Board')]));
    await ensureSchemaVersion();
    const layouts = await loadBoardLayouts();
    expect(layouts[0]!.ports).toHaveLength(PORT_COUNT);
  });

  it('leaves already-current storage untouched', async () => {
    await AsyncStorage.setItem(VERSION_KEY, String(SCHEMA_VERSION));
    const current = [{ ...v1Layout('a', 'Board'), ports: [...STANDARD_PORT_LAYOUT] }];
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify(current));

    await ensureSchemaVersion();

    expect(JSON.parse((await AsyncStorage.getItem(LAYOUTS_KEY))!)).toEqual(current);
  });

  it('does not stamp the new version when a migration step throws', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    // Malformed JSON makes the layout migration throw.
    await AsyncStorage.setItem(LAYOUTS_KEY, '{not valid json');

    await ensureSchemaVersion();

    // Version stays at 1 so the next launch retries rather than skipping.
    expect(await AsyncStorage.getItem(VERSION_KEY)).toBe('1');
  });
});

describe('ensureSchemaVersion — v2 to v3', () => {
  const v2Session = (id: string) => ({
    id,
    gameType: 'catan',
    diceMode: '2D6',
    minimumRoll: 2,
    maximumRoll: 12,
    players: [],
    currentPlayerIndex: 0,
    autoAdvancePlayer: true,
    startedAt: '2026-01-01T00:00:00Z',
    status: 'completed',
    placements: [], // removed in v3
    settings: {
      recordIndividualDice: true,
      trackWinner: true,
      trackPlacements: true, // removed in v3
      catanRobberTracking: true,
      catanResourceTracking: false,
    },
    schemaVersion: 2,
  });

  const seedV2 = async (id: string) => {
    await AsyncStorage.setItem(VERSION_KEY, '2');
    await AsyncStorage.setItem('blosi:session_ids', JSON.stringify([id]));
    await AsyncStorage.setItem(`blosi:session:${id}`, JSON.stringify(v2Session(id)));
  };

  const readSession = async (id: string) =>
    JSON.parse((await AsyncStorage.getItem(`blosi:session:${id}`))!) as {
      placements?: unknown;
      settings: Record<string, unknown>;
    };

  it('drops the inert trackPlacements flag', async () => {
    await seedV2('s1');
    await ensureSchemaVersion();
    const session = await readSession('s1');
    expect('trackPlacements' in session.settings).toBe(false);
  });

  it('drops the never-populated placements array', async () => {
    await seedV2('s1');
    await ensureSchemaVersion();
    const session = await readSession('s1');
    expect('placements' in session).toBe(false);
  });

  it('defaults dev card tracking off for games played before it existed', async () => {
    await seedV2('s1');
    await ensureSchemaVersion();
    const session = await readSession('s1');
    // Those games genuinely had no dev card data — off is the only true reading.
    expect(session.settings['catanDevCardTracking']).toBe(false);
  });

  it('preserves the settings it is not migrating', async () => {
    await seedV2('s1');
    await ensureSchemaVersion();
    const session = await readSession('s1');
    expect(session.settings['trackWinner']).toBe(true);
    expect(session.settings['catanRobberTracking']).toBe(true);
    expect(session.settings['recordIndividualDice']).toBe(true);
  });

  it('is idempotent', async () => {
    await seedV2('s1');
    await ensureSchemaVersion();
    const first = await AsyncStorage.getItem('blosi:session:s1');
    await ensureSchemaVersion();
    expect(await AsyncStorage.getItem('blosi:session:s1')).toBe(first);
  });

  it('reaches a session the index lost track of', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '2');
    await AsyncStorage.setItem('blosi:session_ids', JSON.stringify([]));
    await AsyncStorage.setItem('blosi:session:orphan', JSON.stringify(v2Session('orphan')));

    await ensureSchemaVersion();

    const session = await readSession('orphan');
    expect('trackPlacements' in session.settings).toBe(false);
  });

  it('leaves a corrupted session record alone rather than making it worse', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '2');
    await AsyncStorage.setItem('blosi:session_ids', JSON.stringify(['bad']));
    await AsyncStorage.setItem('blosi:session:bad', 'not json at all');

    await ensureSchemaVersion();

    expect(await AsyncStorage.getItem('blosi:session:bad')).toBe('not json at all');
    expect(await AsyncStorage.getItem(VERSION_KEY)).toBe(String(SCHEMA_VERSION));
  });

  it('runs both migrations for storage still on v1', async () => {
    await AsyncStorage.setItem(VERSION_KEY, '1');
    await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify([v1Layout('a', 'Board')]));
    await AsyncStorage.setItem('blosi:session_ids', JSON.stringify(['s1']));
    await AsyncStorage.setItem('blosi:session:s1', JSON.stringify(v2Session('s1')));

    await ensureSchemaVersion();

    const layouts = await loadBoardLayouts();
    expect(layouts[0]!.ports).toHaveLength(PORT_COUNT);
    const session = await readSession('s1');
    expect('trackPlacements' in session.settings).toBe(false);
    expect(await AsyncStorage.getItem(VERSION_KEY)).toBe(String(SCHEMA_VERSION));
  });
});

describe('saveBoardLayout — ports', () => {
  it('defaults a brand new layout to the standard frame', async () => {
    const layout = await saveBoardLayout(hexes(), 'New board');
    expect(validatePortLayout(layout.ports)).toEqual([]);
  });

  it('keeps existing ports when only the hexes are re-saved', async () => {
    // Tiles get reshuffled every game; the frame usually stays assembled.
    const custom = [...STANDARD_PORT_LAYOUT].reverse();
    const first = await saveBoardLayout(hexes(), 'Board', undefined, custom);
    const second = await saveBoardLayout(hexes(), 'Board', first.id);
    expect(second.ports).toEqual(custom);
  });

  it('accepts an explicit port arrangement', async () => {
    const custom = [...STANDARD_PORT_LAYOUT].reverse();
    const layout = await saveBoardLayout(hexes(), 'Board', undefined, custom);
    expect(layout.ports).toEqual(custom);
  });
});
