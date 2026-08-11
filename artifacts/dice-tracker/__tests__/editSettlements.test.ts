/**
 * Tests for mergeEditedSettlements and getLinkedBuildingEventCount.
 *
 * Core invariants:
 * 1. getLinkedBuildingEventCount correctly detects when a player has
 *    city-upgrade / removal / correction events that reference their initial
 *    settlement locations (the "blocked" case).
 * 2. mergeEditedSettlements (called only when count === 0) correctly replaces
 *    initial settlements and leaves everything else intact.
 * 3. After merge, getBuildingStatesAtTurn resolves to the correct building state
 *    with no phantom or duplicate buildings.
 */

import { getLinkedBuildingEventCount, mergeEditedSettlements } from '../services/editSettlements';
import { getBuildingStatesAtTurn } from '../services/catanStats';
import type { CatanPlayerExposureEvent } from '../types/models';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
beforeEach(() => { seq = 0; });

function makeEvent(
  playerId: string,
  eventType: CatanPlayerExposureEvent['eventType'],
  overrides: Partial<CatanPlayerExposureEvent> = {},
): CatanPlayerExposureEvent {
  return {
    id: `evt-${++seq}`,
    sessionId: 'sess1',
    playerId,
    eventType,
    turnNumber: eventType === 'initialSettlement' ? 0 : 5,
    timestamp: '2024-01-01T00:00:00Z',
    affectedNumbers: [5],
    hexIdentifiers: [`loc-${seq}`],
    productionWeight: 1,
    robberBlocked: false,
    ...overrides,
  };
}

// ─── getLinkedBuildingEventCount ─────────────────────────────────────────────

describe('getLinkedBuildingEventCount', () => {
  it('returns 0 when the player has only initial settlements (safe to edit)', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-B'] }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(0);
  });

  it('returns 0 when the player has no events at all', () => {
    const events = [
      makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2'] }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(0);
  });

  it('detects a cityUpgrade at an initial settlement location', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'], affectedNumbers: [5] }),
      makeEvent('p1', 'cityUpgrade', { hexIdentifiers: ['loc-A'], affectedNumbers: [5], turnNumber: 5, productionWeight: 2 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(1);
  });

  it('detects buildingRemoved at an initial settlement location', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'buildingRemoved', { hexIdentifiers: ['loc-A'], turnNumber: 8, productionWeight: 0 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(1);
  });

  it('detects manualCorrection at an initial settlement location', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'manualCorrection', { hexIdentifiers: ['loc-A'], turnNumber: 4 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(1);
  });

  it('counts multiple linked events', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
      makeEvent('p1', 'buildingRemoved', { hexIdentifiers: ['loc-A'], turnNumber: 9, productionWeight: 0 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(2);
  });

  it('does NOT count robber blocks as linked (they use rblock_ IDs)', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'robberBlockStarted', { hexIdentifiers: ['rblock_abc'], affectedNumbers: [5], turnNumber: 3 }),
      makeEvent('p1', 'robberBlockEnded', { hexIdentifiers: ['rblock_abc'], turnNumber: 6 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(0);
  });

  it('does NOT count mid-game settlementBuilt at a DIFFERENT location as linked', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'settlementBuilt', { hexIdentifiers: ['loc-MIDGAME'], affectedNumbers: [9], turnNumber: 7 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(0);
  });

  it('does NOT count other players\' city upgrades at the same location ID', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      // p2 coincidentally has events at loc-A — different player
      makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p2', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
    ];
    expect(getLinkedBuildingEventCount(events, 'p1')).toBe(0);
  });
});

// ─── mergeEditedSettlements — replacement ────────────────────────────────────

describe('mergeEditedSettlements — replacement', () => {
  it('replaces initialSettlement events for the edited player', () => {
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'], affectedNumbers: [5] }),
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-B'], affectedNumbers: [9] }),
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'], affectedNumbers: [6] }),
    ];

    const result = mergeEditedSettlements(existing, newInitial, 'p1');

    const p1Initial = result.filter(e => e.playerId === 'p1' && e.eventType === 'initialSettlement');
    expect(p1Initial).toHaveLength(1);
    expect(p1Initial[0]!.id).toBe('new-1');
  });

  it('handles multiple new initial events', () => {
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'], affectedNumbers: [6] }),
      makeEvent('p1', 'initialSettlement', { id: 'new-2', hexIdentifiers: ['loc-D'], affectedNumbers: [8] }),
    ];

    const result = mergeEditedSettlements(existing, newInitial, 'p1');

    const p1Initial = result.filter(e => e.playerId === 'p1' && e.eventType === 'initialSettlement');
    expect(p1Initial).toHaveLength(2);
    expect(p1Initial.map(e => e.id).sort()).toEqual(['new-1', 'new-2']);
  });

  it('handles a player with no prior events', () => {
    const p2Event = makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2A'] });
    const existing = [p2Event];
    const newInitial = [makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'] })];

    const result = mergeEditedSettlements(existing, newInitial, 'p1');

    expect(result).toContainEqual(p2Event);
    expect(result.find(e => e.id === 'new-1')).toBeDefined();
  });

  it('returns only new events when existing list is empty', () => {
    const newInitial = [makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'] })];
    const result = mergeEditedSettlements([], newInitial, 'p1');
    expect(result).toEqual(newInitial);
  });

  it('returns empty list when both are empty', () => {
    expect(mergeEditedSettlements([], [], 'p1')).toEqual([]);
  });

  it('new events are appended after kept events', () => {
    const robber = makeEvent('p1', 'robberBlockStarted', {
      hexIdentifiers: ['rblock_xyz'], affectedNumbers: [6], turnNumber: 2,
    });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      robber,
    ];
    const newInitial = [makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'] })];

    const result = mergeEditedSettlements(existing, newInitial, 'p1');

    const robberIdx = result.findIndex(e => e.id === robber.id);
    const newIdx = result.findIndex(e => e.id === 'new-1');
    expect(robberIdx).toBeLessThan(newIdx);
  });
});

// ─── mergeEditedSettlements — other-player isolation ─────────────────────────

describe('mergeEditedSettlements — other-player isolation', () => {
  it('does NOT remove initialSettlement events for other players', () => {
    const p2a = makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2A'], affectedNumbers: [8] });
    const p3a = makeEvent('p3', 'initialSettlement', { hexIdentifiers: ['loc-P3A'], affectedNumbers: [4] });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      p2a, p3a,
    ];
    const result = mergeEditedSettlements(existing, [makeEvent('p1', 'initialSettlement', { id: 'n', hexIdentifiers: ['loc-C'] })], 'p1');

    expect(result).toContainEqual(p2a);
    expect(result).toContainEqual(p3a);
  });

  it('does NOT remove city upgrades or robber blocks for other players', () => {
    const p2city = makeEvent('p2', 'cityUpgrade', { hexIdentifiers: ['loc-P2A'], turnNumber: 7, productionWeight: 2 });
    const p2robber = makeEvent('p2', 'robberBlockStarted', { hexIdentifiers: ['rblock_001'], turnNumber: 3 });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      p2city, p2robber,
    ];
    const result = mergeEditedSettlements(existing, [makeEvent('p1', 'initialSettlement', { id: 'n', hexIdentifiers: ['loc-C'] })], 'p1');

    expect(result).toContainEqual(p2city);
    expect(result).toContainEqual(p2robber);
  });

  it('four-player: only the target player\'s initialSettlements are removed', () => {
    const p1a = makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-P1A'] });
    const p2a = makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2A'] });
    const p3a = makeEvent('p3', 'initialSettlement', { hexIdentifiers: ['loc-P3A'] });
    const p4a = makeEvent('p4', 'initialSettlement', { hexIdentifiers: ['loc-P4A'] });

    const existing = [p1a, p2a, p3a, p4a];
    const newInitial = [makeEvent('p3', 'initialSettlement', { id: 'p3-new', hexIdentifiers: ['loc-P3NEW'], affectedNumbers: [4] })];
    const result = mergeEditedSettlements(existing, newInitial, 'p3');

    expect(result).toContainEqual(p1a);
    expect(result).toContainEqual(p2a);
    expect(result).toContainEqual(p4a);
    expect(result).not.toContainEqual(p3a);
    expect(result.find(e => e.id === 'p3-new')).toBeDefined();
  });
});

// ─── mergeEditedSettlements — preserves player's non-initial events ───────────

describe('mergeEditedSettlements — non-initial event preservation', () => {
  it('preserves robber block/lift events for the edited player', () => {
    const robberBlock = makeEvent('p1', 'robberBlockStarted', {
      hexIdentifiers: ['rblock_abc123'], affectedNumbers: [6], turnNumber: 3,
    });
    const robberLift = makeEvent('p1', 'robberBlockEnded', {
      hexIdentifiers: ['rblock_abc123'], turnNumber: 6,
    });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      robberBlock, robberLift,
    ];
    const result = mergeEditedSettlements(existing, [makeEvent('p1', 'initialSettlement', { id: 'n', hexIdentifiers: ['loc-C'] })], 'p1');

    expect(result).toContainEqual(robberBlock);
    expect(result).toContainEqual(robberLift);
  });

  it('preserves mid-game settlementBuilt at a different location', () => {
    const midGameSettlement = makeEvent('p1', 'settlementBuilt', {
      hexIdentifiers: ['loc-MIDGAME'], affectedNumbers: [4], turnNumber: 10,
    });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      midGameSettlement,
    ];
    const result = mergeEditedSettlements(existing, [makeEvent('p1', 'initialSettlement', { id: 'n', hexIdentifiers: ['loc-C'] })], 'p1');

    expect(result).toContainEqual(midGameSettlement);
  });
});

// ─── enterPlacement guard simulation ─────────────────────────────────────────
//
// The catan-board-scan screen calls getLinkedBuildingEventCount before entering
// placement in edit mode. These tests simulate that gate to confirm it surfaces
// the correct block/allow decision — mirroring the handler's exact logic so any
// regression in the guard is caught here.

interface EnterPlacementDeps {
  isEditMode: boolean;
  editPlayerId: string | undefined;
  exposureEvents: CatanPlayerExposureEvent[];
  /** Receives the Alert message when the guard fires; null when proceeding. */
  onAlert: (message: string) => void;
  /** Called when the guard passes and placement phase would begin. */
  onProceed: () => void;
}

/** Mirrors the enterPlacement guard in catan-board-scan.tsx. */
function simulateEnterPlacement(deps: EnterPlacementDeps): void {
  const { isEditMode, editPlayerId, exposureEvents, onAlert, onProceed } = deps;
  if (isEditMode && editPlayerId) {
    const linkedCount = getLinkedBuildingEventCount(exposureEvents, editPlayerId);
    if (linkedCount > 0) {
      onAlert(
        `has ${linkedCount} in-game building change${linkedCount === 1 ? '' : 's'} (such as a city upgrade or building removal) on top of their starting positions. Undo those changes before editing settlements.`,
      );
      return;
    }
  }
  onProceed();
}

describe('enterPlacement guard — edit mode with linked building events', () => {
  it('blocks and fires alert when a city upgrade exists on an initial settlement location', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
    expect(onAlert.mock.calls[0]![0]).toContain('1 in-game building change');
  });

  it('block message mentions plural changes when multiple linked events exist', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
      makeEvent('p1', 'buildingRemoved', { hexIdentifiers: ['loc-A'], turnNumber: 9, productionWeight: 0 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
    expect(onAlert.mock.calls[0]![0]).toContain('2 in-game building changes');
  });

  it('blocks when a manualCorrection is linked to an initial settlement', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-B'] }),
      makeEvent('p1', 'manualCorrection', { hexIdentifiers: ['loc-B'], turnNumber: 3 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).toHaveBeenCalledTimes(1);
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('proceeds when the player has only initial settlements (no linked events)', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-B'] }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('proceeds when the player has no events at all', () => {
    const events = [
      makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2'] }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('proceeds when robber blocks exist (they are NOT linked to initial settlement locations)', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'robberBlockStarted', { hexIdentifiers: ['rblock_abc'], turnNumber: 3 }),
      makeEvent('p1', 'robberBlockEnded', { hexIdentifiers: ['rblock_abc'], turnNumber: 6 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('does NOT block the target player when another player has linked events at the same location', () => {
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p2', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    // Editing p1: p2's city upgrade at loc-A must not block p1
    simulateEnterPlacement({ isEditMode: true, editPlayerId: 'p1', exposureEvents: events, onAlert, onProceed });

    expect(onAlert).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('skips the guard entirely when isEditMode is false (non-edit path always proceeds)', () => {
    // Even with linked events in the list, non-edit mode never checks the guard
    const events = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'] }),
      makeEvent('p1', 'cityUpgrade', { hexIdentifiers: ['loc-A'], turnNumber: 5, productionWeight: 2 }),
    ];
    const onAlert = jest.fn();
    const onProceed = jest.fn();

    simulateEnterPlacement({ isEditMode: false, editPlayerId: undefined, exposureEvents: events, onAlert, onProceed });

    expect(onAlert).not.toHaveBeenCalled();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });
});

// ─── End-to-end: getBuildingStatesAtTurn after merge ─────────────────────────

describe('mergeEditedSettlements — end-to-end building state (no linked events)', () => {
  it('resolves correct single building after position correction', () => {
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'], affectedNumbers: [5, 9], productionWeight: 1 }),
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'], affectedNumbers: [6, 10], productionWeight: 1 }),
    ];

    const merged = mergeEditedSettlements(existing, newInitial, 'p1');
    const buildings = getBuildingStatesAtTurn('p1', 999, merged);

    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.locationId).toBe('loc-C');
    expect(buildings[0]!.affectedNumbers).toEqual([6, 10]);
  });

  it('resolves multiple corrected settlements', () => {
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'], affectedNumbers: [5] }),
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-B'], affectedNumbers: [9] }),
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'n1', hexIdentifiers: ['loc-C'], affectedNumbers: [6] }),
      makeEvent('p1', 'initialSettlement', { id: 'n2', hexIdentifiers: ['loc-D'], affectedNumbers: [10] }),
    ];

    const merged = mergeEditedSettlements(existing, newInitial, 'p1');
    const buildings = getBuildingStatesAtTurn('p1', 999, merged);

    expect(buildings).toHaveLength(2);
    const locIds = buildings.map(b => b.locationId).sort();
    expect(locIds).toEqual(['loc-C', 'loc-D']);
  });

  it('preserves mid-game settlementBuilt when resolving buildings after edit', () => {
    const midGame = makeEvent('p1', 'settlementBuilt', {
      hexIdentifiers: ['loc-EXTRA'], affectedNumbers: [9], turnNumber: 8,
    });
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-A'], affectedNumbers: [5] }),
      midGame,
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-C'], affectedNumbers: [6] }),
    ];

    const merged = mergeEditedSettlements(existing, newInitial, 'p1');
    const buildings = getBuildingStatesAtTurn('p1', 999, merged);

    expect(buildings).toHaveLength(2);
    const locIds = buildings.map(b => b.locationId).sort();
    expect(locIds).toEqual(['loc-C', 'loc-EXTRA']);
  });

  it('other players\' buildings resolve correctly after editing one player', () => {
    const existing = [
      makeEvent('p1', 'initialSettlement', { hexIdentifiers: ['loc-P1'], affectedNumbers: [5] }),
      makeEvent('p2', 'initialSettlement', { hexIdentifiers: ['loc-P2'], affectedNumbers: [8] }),
    ];
    const newInitial = [
      makeEvent('p1', 'initialSettlement', { id: 'new-1', hexIdentifiers: ['loc-P1-NEW'], affectedNumbers: [9] }),
    ];

    const merged = mergeEditedSettlements(existing, newInitial, 'p1');

    const p1Buildings = getBuildingStatesAtTurn('p1', 999, merged);
    expect(p1Buildings).toHaveLength(1);
    expect(p1Buildings[0]!.locationId).toBe('loc-P1-NEW');
    expect(p1Buildings[0]!.affectedNumbers).toEqual([9]);

    const p2Buildings = getBuildingStatesAtTurn('p2', 999, merged);
    expect(p2Buildings).toHaveLength(1);
    expect(p2Buildings[0]!.locationId).toBe('loc-P2');
    expect(p2Buildings[0]!.affectedNumbers).toEqual([8]);
  });
});
