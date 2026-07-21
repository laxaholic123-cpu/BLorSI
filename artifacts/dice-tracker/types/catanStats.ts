/**
 * Catan-Compatible Mode statistics types.
 *
 * All types are plain data objects — no UI or React Native imports allowed here.
 */

import type { ResourceType } from '@/types/models';

// ─── Building state ───────────────────────────────────────────────────────────

/**
 * The resolved state of a single building at a specific turn.
 * Derived from the event ledger — never stored directly.
 */
export interface BuildingState {
  /** locationId = hexIdentifiers[0] from the exposure event */
  locationId: string;
  /** Dice numbers this building produces from (2–12, excluding 7) */
  affectedNumbers: number[];
  /** 1 = settlement, 2 = city */
  productionWeight: number;
  resourceType?: ResourceType;
}

// ─── Per-player production stats ──────────────────────────────────────────────

export interface CatanPlayerProductionStats {
  playerId: string;
  displayName: string;
  /** Weighted production actually received (accounting for robber) */
  totalActualProduction: number;
  /** Weighted production expected given their exposure and the dice rolled */
  totalExpectedProduction: number;
  /** actual − expected (positive = lucky, negative = unlucky) */
  productionLuck: number;
  /** (luck / expected) × 100 — percentage deviation */
  productionLuckPct: number;
  /**
   * Sum of P(number) × productionWeight for the initial settlement setup.
   * Higher = stronger initial placement.
   */
  placementStrength: number;
  /** Count of unique numbers in the initial placement */
  numberDiversity: number;
  /** Weighted production lost because a robber block was active */
  robberLostProduction: number;
  /** Buildings present at initial setup (turnNumber = 0) */
  initialBuildingCount: number;
  /** City count at end of game (most recent state) */
  finalCityCount: number;
}

// ─── Verdict dimensions ───────────────────────────────────────────────────────

export type SevenFrequency = 'low' | 'expected' | 'high';
export type CatanRollLuck = 'unlucky' | 'neutral' | 'lucky';
export type CatanExposureLuck = 'poor' | 'average' | 'strong';
export type CatanPlacementRating = 'weak' | 'average' | 'strong';

export type CatanFinalOutcome =
  | 'too_early'
  | 'dice_were_fair'
  | 'lucky_dice_lucky_exposure'
  | 'bad_dice_bad_exposure'
  | 'strong_placement_poor_luck'
  | 'weak_placement_lucky_dice'
  | 'mixed_evidence';

// ─── Verdict output ───────────────────────────────────────────────────────────

export interface CatanVerdictFindings {
  sevenFrequency: SevenFrequency;
  /** Overall roll luck relative to the full 2D6 distribution */
  rollLuck: CatanRollLuck;
  /** Whether the dice disproportionately hit each player's exposed numbers */
  exposureLuck: Record<string, CatanExposureLuck>; // playerId → luck
  /** Quality rating of each player's initial placement */
  placementRating: Record<string, CatanPlacementRating>; // playerId → rating
  finalOutcome: CatanFinalOutcome;
  headline: string;
  details: string[];
}

// ─── Full Catan stats ─────────────────────────────────────────────────────────

export interface CatanGameStats {
  totalRolls: number;
  sevenCount: number;
  sevenPct: number;
  nonSevenCount: number;
  /** 7s expected given total rolls: Math.round(6/36 × totalRolls) */
  sevenExpected: number;
  playerStats: CatanPlayerProductionStats[];
  findings: CatanVerdictFindings | null;
  isSmallSample: boolean;
  smallSampleThreshold: number;
  hasExposureData: boolean;
}

export const CATAN_SMALL_SAMPLE_THRESHOLD = 30;
