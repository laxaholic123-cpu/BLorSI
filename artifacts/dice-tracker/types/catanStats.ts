/**
 * Catan-Compatible Mode statistics types.
 *
 * All types are plain data objects — no UI or React Native imports allowed here.
 */

import type { BoardPosition } from '@/types/boardState';
import type { PortType, ResourceType } from '@/types/models';

// ─── Building state ───────────────────────────────────────────────────────────

/**
 * A Catan building, resolved to a turn. Derived from the event ledger, never
 * stored directly.
 *
 * Extends the mode-agnostic `BoardPosition` so cross-mode consumers (career
 * stats, accolades) can read placements without importing anything Catan.
 * `locationId` is `hexIdentifiers[0]` from the exposure event; productionWeight
 * is 1 for a settlement and 2 for a city.
 */
export interface BuildingState extends BoardPosition {
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
  /**
   * Ports this player's initial buildings sit on.
   *
   * Deliberately NOT folded into placementStrength. Ports change trade rates,
   * not dice production, and there is no honest exchange rate between "pips"
   * and "2:1 ore access" — inventing one would be the same category of made-up
   * threshold the verdict layer was rebuilt to remove. Reported alongside
   * placement strength so a player can weigh it themselves.
   */
  portAccess: PortType[];
  /** Weighted production lost because a robber block was active */
  robberLostProduction: number;
  /** Buildings present at initial setup (turnNumber = 0) */
  initialBuildingCount: number;
  /** City count at end of game (most recent state) */
  finalCityCount: number;
  /**
   * Where this player's actual production lands among simulated fair games with
   * the same placements and robber timeline, 0–100. Low = genuinely unlucky.
   *
   * This is the honest measure of luck; productionLuckPct is descriptive only,
   * because the same percentage means very different things at 40 rolls and 150.
   * Undefined when the caller did not request simulation (career aggregation and
   * live in-game views skip it for speed).
   */
  productionLuckPercentile?: number;
  /** Mean production across simulated fair games. */
  productionSimMean?: number;
  /** Standard deviation of production across simulated fair games. */
  productionSimStdDev?: number;
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
  /**
   * Per-player production percentile, when simulation ran. Surfaced so the
   * results and share screens can print the real number next to the verdict
   * label rather than only the label.
   */
  luckPercentile?: Record<string, number>; // playerId → 0-100
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
