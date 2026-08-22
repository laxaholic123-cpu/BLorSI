/**
 * Board reader diagnostics — TEMPORARY.
 *
 * Exists to answer one question with a number instead of an impression: when a
 * capture reads badly, is it the geometry or the classifier?
 *
 * The reader scored 19/19 on a reference board with hand-marked corners and
 * about 8/19 on real captures where the corners came from the on-screen guide.
 * Those two runs differ in more than one thing, so neither explains the other.
 * `compareReadings` fixes that by reading the SAME decoded frame twice — once
 * with each set of corners — which isolates geometry as the only variable.
 *
 * Pure, and importing no React Native, so it stays testable under the rule the
 * rest of services/ follows.
 *
 * DELETE THIS once the question is answered. It is a measuring instrument, not
 * a feature, and it should not quietly become part of the app.
 */

import type { CatanHexDef } from '@/types/models';

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface TileMismatch {
  index: number;
  gotResource: string | null;
  gotNumber: number | null;
  wantResource: string | null;
  wantNumber: number | null;
  /** Which part was wrong — useful for telling colour errors from token errors. */
  wrong: 'resource' | 'number' | 'both';
}

export interface ReadScore {
  /** Tiles where BOTH resource and number match the truth. */
  correct: number;
  /** Tiles scored. 19 on a full board. */
  total: number;
  /** Resource right, regardless of the token. */
  resourceCorrect: number;
  /** Token right, regardless of the terrain. */
  numberCorrect: number;
  mismatches: TileMismatch[];
}

/**
 * Score a reading against the known board.
 *
 * Resource and number are scored separately as well as together, because the
 * two failures have different causes and different fixes: terrain comes from
 * colour and texture ranking, the token from pip and hole counting. A read that
 * gets every terrain right and half the numbers wrong is a very different
 * problem from one that gets neither.
 */
export function scoreReading(
  got: readonly CatanHexDef[],
  want: readonly CatanHexDef[],
): ReadScore {
  const total = want.length;
  const mismatches: TileMismatch[] = [];
  let correct = 0;
  let resourceCorrect = 0;
  let numberCorrect = 0;

  for (let index = 0; index < total; index++) {
    const g = got[index];
    const w = want[index];
    if (!w) continue;

    const gotResource = g?.resource ?? null;
    const gotNumber = g?.number ?? null;
    const wantResource = w.resource ?? null;
    const wantNumber = w.number ?? null;

    const resourceOk = gotResource === wantResource;
    const numberOk = gotNumber === wantNumber;

    if (resourceOk) resourceCorrect++;
    if (numberOk) numberCorrect++;
    if (resourceOk && numberOk) {
      correct++;
      continue;
    }

    mismatches.push({
      index,
      gotResource,
      gotNumber,
      wantResource,
      wantNumber,
      wrong: resourceOk ? 'number' : numberOk ? 'resource' : 'both',
    });
  }

  return { correct, total, resourceCorrect, numberCorrect, mismatches };
}

// ─── Export payload ───────────────────────────────────────────────────────────

export interface CornerSet {
  label: string;
  /** Normalised 0-1 against the decoded buffer, in HANDLE_HEXES order. */
  points: Array<{ x: number; y: number }>;
}

export interface ReadingSnapshot {
  label: string;
  corners: Array<{ x: number; y: number }>;
  hexes: Array<{ index: number; resource: string | null; number: number | null; confidence: string }>;
  usable: boolean;
  coverage: number;
  reason?: string;
  score?: ReadScore;
}

export interface DiagnosticPayload {
  kind: 'board-reader-diagnostic';
  version: 1;
  takenAt: string;
  buffer: { width: number; height: number };
  groundTruth: Array<{ index: number; resource: string | null; number: number | null }> | null;
  readings: ReadingSnapshot[];
}

/**
 * Build the blob that gets shared out.
 *
 * Everything needed to reproduce the run offline in `tools/`: the corner sets in
 * normalised coordinates, what each read produced per tile, and the frame
 * assessment. Paired with the saved photo it is enough to re-run the pipeline
 * without the phone.
 */
export function buildDiagnosticPayload(input: {
  bufferWidth: number;
  bufferHeight: number;
  groundTruth: readonly CatanHexDef[] | null;
  readings: ReadingSnapshot[];
}): DiagnosticPayload {
  return {
    kind: 'board-reader-diagnostic',
    version: 1,
    takenAt: new Date().toISOString(),
    buffer: { width: input.bufferWidth, height: input.bufferHeight },
    groundTruth:
      input.groundTruth?.map(h => ({
        index: h.index,
        resource: h.resource ?? null,
        number: h.number ?? null,
      })) ?? null,
    readings: input.readings,
  };
}

/** One-line summary per reading, for the share sheet's preview text. */
export function summariseForHumans(payload: DiagnosticPayload): string {
  const lines = payload.readings.map(r => {
    if (!r.usable) return `${r.label}: unusable (${r.reason ?? 'no reason'})`;
    if (!r.score) return `${r.label}: read ${r.hexes.length} tiles, no ground truth set`;
    const { correct, total, resourceCorrect, numberCorrect } = r.score;
    return `${r.label}: ${correct}/${total} exact · ${resourceCorrect}/${total} terrain · ${numberCorrect}/${total} tokens`;
  });
  return lines.join('\n');
}
