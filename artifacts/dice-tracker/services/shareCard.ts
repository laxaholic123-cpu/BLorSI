/**
 * Share card utilities.
 *
 * Pure functions — no side effects, no UI imports, no storage calls.
 * Shared between results.tsx and share-card.tsx so card-type selection
 * logic lives in one place.
 */

import type { GameSession } from '@/types/models';
import { getSessionModeAdapter } from '@/services/modes';

// ─── Card type ────────────────────────────────────────────────────────────────

export type CardType = 'verdict' | 'summary' | 'accolade' | 'rivalry' | 'production';

export const CARD_METADATA: Record<
  CardType,
  { label: string; icon: string; desc: string }
> = {
  verdict:  { label: 'Verdict Card',      icon: 'trophy-outline',           desc: 'The final dice verdict' },
  summary:  { label: 'Game Summary',      icon: 'bar-chart-outline',        desc: 'Rolls, stats & duration' },
  accolade: { label: 'Player Accolades',  icon: 'ribbon-outline',           desc: 'An accolade for every player' },
  rivalry:  { label: 'Rivalry Card',      icon: 'swap-horizontal-outline',  desc: 'Head-to-head (2-player)' },
  production: { label: 'Production',      icon: 'home-outline',             desc: 'Board production table' },
};

// ─── Best-card selector ───────────────────────────────────────────────────────

/**
 * Return the most interesting share card type for a given session.
 *
 * Priority:
 *   1. Board mode + ≥2 players + exposure  → production
 *   2. Exactly 2 players                   → rivalry
 *   3. Single player OR ≥3 players         → verdict
 *   4. Fallback                            → summary
 *
 * Pure function — safe to call in render.
 */
export function selectBestShareCard(
  session: GameSession,
  hasExposureData: boolean,
): CardType {
  const mode = getSessionModeAdapter(session);
  if (
    mode?.hasBoardState(session) &&
    session.players.length >= 2 &&
    hasExposureData
  ) {
    return 'production';
  }
  if (session.players.length === 2) {
    return 'rivalry';
  }
  if (session.players.length >= 1) {
    return 'verdict';
  }
  return 'summary';
}

/** Return true if `value` is a valid CardType string. */
export function isCardType(value: string | undefined | null): value is CardType {
  if (!value) return false;
  return Object.keys(CARD_METADATA).includes(value);
}
