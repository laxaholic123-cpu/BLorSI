/**
 * Tests for the boardLayouts service — save, load, delete, and makeEmptyLayout.
 *
 * Uses the standard AsyncStorage jest mock so nothing touches the filesystem.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deleteBoardLayout,
  loadBoardLayouts,
  makeEmptyLayout,
  saveBoardLayout,
} from "@/services/boardLayouts";
import type { CatanHexDef, CatanPortDef } from "@/types/models";
import { STANDARD_PORT_LAYOUT, getCoastalEdgesClockwise, PORT_COUNT }
  from "@/services/catanBoard";
import { portsFromDetectedSlots } from "@/services/catanPorts";

// ─── AsyncStorage mock ────────────────────────────────────────────────────────

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeHexes(): CatanHexDef[] {
  return makeEmptyLayout();
}

function populatedHexes(): CatanHexDef[] {
  const hexes = makeEmptyLayout();
  hexes[0] = { index: 0, resource: "grain", number: 6, confidence: "high" };
  hexes[1] = { index: 1, resource: "ore", number: 9, confidence: "high" };
  return hexes;
}

// ─── Reset storage between tests ─────────────────────────────────────────────

beforeEach(async () => {
  await AsyncStorage.clear();
  (AsyncStorage.clear as jest.Mock).mockClear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
});

// ─── makeEmptyLayout ──────────────────────────────────────────────────────────

describe("makeEmptyLayout", () => {
  it("returns exactly 19 hex entries", () => {
    const layout = makeEmptyLayout();
    expect(layout).toHaveLength(19);
  });

  it("assigns correct sequential indices", () => {
    const layout = makeEmptyLayout();
    layout.forEach((h, i) => expect(h.index).toBe(i));
  });

  it("initialises all resource and number fields to null", () => {
    const layout = makeEmptyLayout();
    expect(layout.every((h) => h.resource === null)).toBe(true);
    expect(layout.every((h) => h.number === null)).toBe(true);
  });

  it("initialises all confidence fields to 'low'", () => {
    const layout = makeEmptyLayout();
    expect(layout.every((h) => h.confidence === "low")).toBe(true);
  });

  it("returns a new array each call (not a shared reference)", () => {
    const a = makeEmptyLayout();
    const b = makeEmptyLayout();
    a[0]!.resource = "grain";
    expect(b[0]!.resource).toBe(null);
  });
});

// ─── loadBoardLayouts ─────────────────────────────────────────────────────────

describe("loadBoardLayouts", () => {
  it("returns an empty array when nothing is stored", async () => {
    const layouts = await loadBoardLayouts();
    expect(layouts).toEqual([]);
  });

  it("returns an empty array when storage contains invalid JSON", async () => {
    await AsyncStorage.setItem("blosi:board_layouts", "not-json");
    const layouts = await loadBoardLayouts();
    expect(layouts).toEqual([]);
  });
});

// ─── saveBoardLayout ──────────────────────────────────────────────────────────

describe("saveBoardLayout", () => {
  it("saves a layout and returns it with an id and savedAt", async () => {
    const layout = await saveBoardLayout(populatedHexes(), "My Board");
    expect(layout.id).toBeTruthy();
    expect(layout.name).toBe("My Board");
    expect(layout.hexes).toHaveLength(19);
    expect(layout.savedAt).toBeTruthy();
  });

  it("falls back to 'Board Layout' when name is whitespace-only", async () => {
    const layout = await saveBoardLayout(makeHexes(), "   ");
    expect(layout.name).toBe("Board Layout");
  });

  it("persists across a subsequent loadBoardLayouts call", async () => {
    await saveBoardLayout(populatedHexes(), "Persistent");
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.name).toBe("Persistent");
  });

  it("accumulates multiple layouts without overwriting previous ones", async () => {
    await saveBoardLayout(makeHexes(), "First");
    await saveBoardLayout(makeHexes(), "Second");
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(2);
    const names = layouts.map((l) => l.name);
    expect(names).toContain("First");
    expect(names).toContain("Second");
  });

  it("updates an existing layout in-place when existingId is provided", async () => {
    const original = await saveBoardLayout(makeHexes(), "Original");
    const updated = await saveBoardLayout(
      populatedHexes(),
      "Updated",
      original.id
    );
    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe("Updated");
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.name).toBe("Updated");
  });
});

// ─── deleteBoardLayout ────────────────────────────────────────────────────────

describe("deleteBoardLayout", () => {
  it("removes the layout with the matching id", async () => {
    const layout = await saveBoardLayout(makeHexes(), "To Delete");
    await deleteBoardLayout(layout.id);
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(0);
  });

  it("leaves other layouts intact when deleting one", async () => {
    const a = await saveBoardLayout(makeHexes(), "Keep A");
    const b = await saveBoardLayout(makeHexes(), "Delete B");
    await deleteBoardLayout(b.id);
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.id).toBe(a.id);
  });

  it("is a no-op for an id that does not exist", async () => {
    await saveBoardLayout(makeHexes(), "Existing");
    await deleteBoardLayout("non-existent-id");
    const layouts = await loadBoardLayouts();
    expect(layouts).toHaveLength(1);
  });
});

describe("ports on a saved layout", () => {
  /*
    The reason this block exists: `CatanBoardLayout.ports` was written by every
    save and read back by nothing. The field was typed, migrated and
    defensively backfilled, and no path ever restored it to the screen — so a
    frame you had read from a photo or corrected by hand was silently replaced
    with the rulebook ring the next time you loaded it. Nothing failed, nothing
    warned, and the whole point of storing a frame is that the frame outlives
    the shuffle.
  */

  /** A frame that is legal but NOT the standard one, so a fallback is visible. */
  const shuffled = (): CatanPortDef[] => {
    const ring = getCoastalEdgesClockwise();
    return portsFromDetectedSlots(
      [0, 3, 7, 10, 13, 17, 20, 23, 27].map(i => ({
        hexIndex: ring[i]!.hexIndex,
        edge: ring[i]!.edge,
      })),
    );
  };

  const key = (ports: readonly CatanPortDef[]) =>
    ports.map(p => `${p.hexIndex}:${p.edge}:${p.type}`).sort().join("|");

  it("round-trips a non-standard frame", async () => {
    const ports = shuffled();
    expect(key(ports)).not.toBe(key(STANDARD_PORT_LAYOUT));

    await saveBoardLayout(makeHexes(), "Our Board", undefined, ports);
    const [loaded] = await loadBoardLayouts();
    expect(loaded!.ports).toHaveLength(PORT_COUNT);
    expect(key(loaded!.ports)).toBe(key(ports));
  });

  it("does not quietly substitute the standard ring", async () => {
    // The actual failure. A saved board came back as the rulebook frame, which
    // looks entirely plausible and is wrong.
    const ports = shuffled();
    await saveBoardLayout(makeHexes(), "Our Board", undefined, ports);
    const [loaded] = await loadBoardLayouts();
    expect(key(loaded!.ports)).not.toBe(key(STANDARD_PORT_LAYOUT));
  });

  it("keeps the frame when only the TILES are re-saved", async () => {
    // Groups reshuffle tiles every game and leave the frame assembled, so
    // re-saving hexes onto an existing layout must not disturb its ports.
    const ports = shuffled();
    const first = await saveBoardLayout(makeHexes(), "Our Board", undefined, ports);
    await saveBoardLayout(makeHexes(), "Our Board", first.id);
    const [loaded] = await loadBoardLayouts();
    expect(key(loaded!.ports)).toBe(key(ports));
  });

  it("still backfills a layout that predates ports", async () => {
    // Migration path: an old stored layout has no ports at all and must not
    // crash the picker.
    await AsyncStorage.setItem(
      "blosi:board_layouts",
      JSON.stringify([{ id: "old", name: "Old", hexes: makeHexes(), savedAt: "2026-01-01" }]),
    );
    const [loaded] = await loadBoardLayouts();
    expect(loaded!.ports).toHaveLength(PORT_COUNT);
  });
});
