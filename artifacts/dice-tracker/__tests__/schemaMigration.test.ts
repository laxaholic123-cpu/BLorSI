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
  it('is 2 now that board layouts carry ports', () => {
    expect(SCHEMA_VERSION).toBe(2);
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
