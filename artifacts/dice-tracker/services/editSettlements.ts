/**
 * editSettlements — helpers for replacing a player's initial settlement
 * positions without corrupting in-game history.
 *
 * Approach
 * ─────────
 * Replacing initial settlements is only safe when the player has no
 * subsequent building events (city upgrades, removals, manual corrections)
 * that reference those original location IDs.  When such events exist the
 * caller must block the edit and tell the user to undo those actions first.
 *
 * Use `getLinkedBuildingEventCount` to detect the blocked case.
 * Call `mergeEditedSettlements` only when the count is zero.
 */

import type { CatanPlayerExposureEvent } from '@/types/models';

/**
 * Event types that use hexIdentifiers[0] as a building location ID.
 * Robber events ('robberBlockStarted', 'robberBlockEnded') use 'rblock_XXX'
 * IDs that are independent of settlement location IDs and are excluded.
 */
const BUILDING_EVENT_TYPES: ReadonlyArray<CatanPlayerExposureEvent['eventType']> = [
  'initialSettlement',
  'settlementBuilt',
  'cityUpgrade',
  'buildingRemoved',
  'manualCorrection',
];

/**
 * Returns the number of in-game building events for `editPlayerId` that
 * reference one of that player's current initial-settlement location IDs.
 *
 * A result > 0 means the player has city upgrades, building removals, or
 * manual corrections on top of a starting position.  Editing initial
 * settlements in this state would leave those dependent events pointing at a
 * now-deleted location, producing phantom buildings.  The caller should block
 * the edit and prompt the user to remove the linked events first.
 *
 * Robber block/lift events are excluded because they use independent IDs.
 */
export function getLinkedBuildingEventCount(
  events: CatanPlayerExposureEvent[],
  editPlayerId: string,
): number {
  // Collect the location IDs of this player's initial settlements
  const initialLocationIds = new Set<string>(
    events
      .filter(e => e.playerId === editPlayerId && e.eventType === 'initialSettlement')
      .map(e => e.hexIdentifiers?.[0])
      .filter((id): id is string => id !== undefined && id !== ''),
  );

  if (initialLocationIds.size === 0) return 0;

  // Count non-initial building events for the player at those same location IDs
  const LINKED_TYPES: ReadonlyArray<CatanPlayerExposureEvent['eventType']> = [
    'cityUpgrade',
    'buildingRemoved',
    'manualCorrection',
  ];

  return events.filter(e => {
    if (e.playerId !== editPlayerId) return false;
    if (!LINKED_TYPES.includes(e.eventType)) return false;
    const locId = e.hexIdentifiers?.[0];
    return locId !== undefined && initialLocationIds.has(locId);
  }).length;
}

/**
 * Merges newly-placed initial-settlement events for `editPlayerId` into the
 * existing event list.
 *
 * **Precondition**: `getLinkedBuildingEventCount` must return 0 for the edited
 * player.  This function does not check the precondition — callers are
 * responsible for blocking the edit path when linked events exist.
 *
 * What is removed:
 * - Every prior `initialSettlement` event owned by `editPlayerId`.
 *
 * What is kept:
 * - ALL non-initial events for `editPlayerId` (robber blocks, mid-game
 *   settlementBuilt events at other locations, etc.)
 * - Every event belonging to other players, completely untouched.
 *
 * @param existingEvents  The full current list of exposure events.
 * @param newInitialEvents  Replacement initialSettlement records from the
 *                          board-scan placement phase; all must belong to
 *                          `editPlayerId` with eventType === 'initialSettlement'.
 * @param editPlayerId  The player whose starting positions are being replaced.
 */
export function mergeEditedSettlements(
  existingEvents: CatanPlayerExposureEvent[],
  newInitialEvents: CatanPlayerExposureEvent[],
  editPlayerId: string,
): CatanPlayerExposureEvent[] {
  // Drop only the prior initialSettlement records for the edited player.
  // All other events — for this player or any other — are preserved.
  const kept = existingEvents.filter(
    e => !(e.playerId === editPlayerId && e.eventType === 'initialSettlement'),
  );
  return [...kept, ...newInitialEvents];
}
