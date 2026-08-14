/**
 * Save, load, and delete named Catan board layouts from AsyncStorage.
 * Layouts are stored under blosi:board_layouts as a JSON array.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CatanBoardLayout, CatanHexDef, CatanPortDef } from '@/types/models';
import { generateId } from '@/types/models';
import { STANDARD_PORT_LAYOUT } from '@/services/catanBoard';

const LAYOUTS_KEY = 'blosi:board_layouts';

export const loadBoardLayouts = async (): Promise<CatanBoardLayout[]> => {
  try {
    const json = await AsyncStorage.getItem(LAYOUTS_KEY);
    if (!json) return [];
    const layouts = JSON.parse(json) as Array<Partial<CatanBoardLayout>>;
    if (!Array.isArray(layouts)) return [];
    // Defensive backfill: the v2 migration handles stored data, but a layout
    // arriving from an unmigrated import should not crash the layout picker.
    return layouts.map(l => ({
      ...l,
      ports: Array.isArray(l.ports) ? l.ports : [...STANDARD_PORT_LAYOUT],
    })) as CatanBoardLayout[];
  } catch {
    return [];
  }
};

export const saveBoardLayout = async (
  hexes: CatanHexDef[],
  name: string,
  existingId?: string,
  ports?: CatanPortDef[],
): Promise<CatanBoardLayout> => {
  const layouts = await loadBoardLayouts();
  // Preserve the ports already on this layout when only the hexes are being
  // re-saved — tiles get reshuffled every game, the frame usually does not.
  const existing = existingId ? layouts.find(l => l.id === existingId) : undefined;
  const layout: CatanBoardLayout = {
    id: existingId ?? generateId(),
    name: name.trim() || 'Board Layout',
    hexes,
    ports: ports ?? existing?.ports ?? [...STANDARD_PORT_LAYOUT],
    savedAt: new Date().toISOString(),
  };
  const idx = layouts.findIndex(l => l.id === layout.id);
  if (idx !== -1) {
    layouts[idx] = layout;
  } else {
    layouts.push(layout);
  }
  await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  return layout;
};

export const deleteBoardLayout = async (id: string): Promise<void> => {
  const layouts = await loadBoardLayouts();
  const filtered = layouts.filter(l => l.id !== id);
  await AsyncStorage.setItem(LAYOUTS_KEY, JSON.stringify(filtered));
};

/** Ports for a fresh board — the standard frame, editable afterwards. */
export const makeDefaultPorts = (): CatanPortDef[] => [...STANDARD_PORT_LAYOUT];

/** Return an empty 19-hex layout with all values unknown. */
export const makeEmptyLayout = (): CatanHexDef[] =>
  Array.from({ length: 19 }, (_, i) => ({
    index: i,
    resource: null,
    number: null,
    confidence: 'low' as const,
  }));
