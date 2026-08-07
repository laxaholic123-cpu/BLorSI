/**
 * Save, load, and delete named Catan board layouts from AsyncStorage.
 * Layouts are stored under blosi:board_layouts as a JSON array.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CatanBoardLayout, CatanHexDef } from '@/types/models';
import { generateId } from '@/types/models';

const LAYOUTS_KEY = 'blosi:board_layouts';

export const loadBoardLayouts = async (): Promise<CatanBoardLayout[]> => {
  try {
    const json = await AsyncStorage.getItem(LAYOUTS_KEY);
    return json ? (JSON.parse(json) as CatanBoardLayout[]) : [];
  } catch {
    return [];
  }
};

export const saveBoardLayout = async (
  hexes: CatanHexDef[],
  name: string,
  existingId?: string,
): Promise<CatanBoardLayout> => {
  const layouts = await loadBoardLayouts();
  const layout: CatanBoardLayout = {
    id: existingId ?? generateId(),
    name: name.trim() || 'Board Layout',
    hexes,
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

/** Return an empty 19-hex layout with all values unknown. */
export const makeEmptyLayout = (): CatanHexDef[] =>
  Array.from({ length: 19 }, (_, i) => ({
    index: i,
    resource: null,
    number: null,
    confidence: 'low' as const,
  }));
