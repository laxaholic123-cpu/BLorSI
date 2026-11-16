/**
 * The board reader's measuring instruments, kept apart from the capture flow.
 *
 * Everything here answers "how good was that read, and why": an answer key to
 * score against, the same photo read with the guide's corners and the marked
 * ones, the OCR comparison, and an export. None of it is part of reading a
 * board, and all of it used to live inside the capture screen, in front of
 * every player. It is shown only with Developer tools switched on.
 *
 * OCR lives here and nowhere else: it was measured at 1 of 17 and is never
 * applied to a board, only reported.
 */

import { useCallback, useState, type MutableRefObject } from 'react';
import { Alert, Share } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { reconcileBoardFromEvidence } from '@/services/boardConstraints';
import { loadGroundTruth } from '@/services/storage';
import {
  buildDiagnosticPayload,
  scoreReading,
  summariseForHumans,
  type ReadingSnapshot,
} from '@/services/vision/diagnostics';
import type { Point } from '@/services/vision/homography';
import { recognizeBoardText, recognizeTokenFaces } from '@/services/vision/ocrSource';
import { mapOcrToHexes } from '@/services/vision/ocrTokens';
import type { PixelBuffer } from '@/services/vision/pixelBuffer';
import { readFrame } from '@/services/vision/readFrame';
import { balanceForBoard } from '@/services/vision/whiteBalance';
import type { CatanHexDef } from '@/types/models';

interface NormPoint { x: number; y: number }

interface Inputs {
  bufferRef: MutableRefObject<PixelBuffer | null>;
  cornersRef: MutableRefObject<NormPoint[]>;
  lastShotUri: string | null;
  /** The guide-derived corners, before automatic placement or the player moved them. */
  guideCorners: NormPoint[] | null;
  corners: NormPoint[] | null;
}

export function useCaptureDiagnostics({ bufferRef, cornersRef, lastShotUri, guideCorners, corners }: Inputs) {
  const [groundTruth, setGroundTruth] = useState<CatanHexDef[] | null>(null);
  const [comparison, setComparison] = useState<ReadingSnapshot[] | null>(null);

  /**
   * Reload on FOCUS, not on mount.
   *
   * Ground truth is set on the correction screen, which this screen reaches via
   * router.push — so this one stays mounted underneath and coming back does not
   * remount it. A mount-only effect therefore reads storage exactly once, before
   * the answer exists, and reports "no ground truth set" forever afterwards
   * while the value sits correctly in storage.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadGroundTruth().then(gt => {
        if (!cancelled) setGroundTruth(gt);
      });
      return () => { cancelled = true; };
    }, []),
  );

  /**
   * Overlay OCR numbers onto a read, then let the token bag repair the rest.
   *
   * Blob counting reads 9 of 18 at best — measured with the face located, at
   * full resolution, on a clean overhead shot. The tokens are printed digits
   * from a closed set of ten, so reading them as digits is the better tool, and
   * `reconcileBoard` already enforces the deck composition on whatever comes
   * back: exactly one 2, one 12, two of everything else.
   *
   * OCR is best-effort. A build without the native module, an unsupported
   * device or a failed recognition all leave the counted numbers in place
   * rather than clearing them.
   */
  const applyOcr = useCallback(
    async (hexes: CatanHexDef[]): Promise<{ hexes: CatanHexDef[]; note?: string }> => {
      // Wrapped end to end. A throw here rejects the promise and the caller's
      // diagnostic row simply never appears — which is exactly what happened
      // when nineteen concurrent bitmap decodes ran out of memory: the OCR line
      // vanished from the export with nothing at all to say why.
      try {
      const buffer = bufferRef.current;
      const pts = cornersRef.current;
      if (!lastShotUri || !buffer || pts.length !== 4) return { hexes };

      /**
       * Per-token crops first, whole board only as a fallback.
       *
       * Reading the whole photo does not work: across three captures ML Kit
       * returned harbour labels and never a number token, because an isolated
       * digit on a cream circle is not text-shaped and its detector never
       * proposes the region. Cropping to one token removes that problem, and
       * removes the geometry with it — a crop from a known hex cannot land on
       * the wrong tile.
       */
      const faces = await recognizeTokenFaces(lastShotUri, buffer.width / buffer.height, pts);
      let readings: Array<{ hexIndex: number; value: number }> = faces.readings;
      let sawSummary = faces.available
        ? `faces: ${faces.timing ?? ''} — ${(faces.raw ?? []).slice(0, 20).join(' ')}`
        : (faces.reason ?? 'faces unavailable');

      if (readings.length === 0) {
        // Fall back to the whole-board sweep, which at least finds something
        // when the crops cannot be taken at all.
        const outcome = await recognizeBoardText(
          lastShotUri,
          buffer.width / buffer.height,
          pts,
        );
        if (!outcome.available) return { hexes, note: outcome.reason };
        const seen = outcome.rawTexts ?? [];
        sawSummary +=
          ` | board: saw ${seen.length}: ${seen.slice(0, 16).join(' ')}` +
          (outcome.timing ? ` | ${outcome.timing}` : '');
        readings = mapOcrToHexes(
          outcome.texts,
          pts as unknown as [Point, Point, Point, Point],
        );
      }

      if (readings.length === 0) {
        return { hexes, note: `No numbers placed — ${sawSummary}` };
      }

      /**
       * OCR NO LONGER WRITES TO THE BOARD. Reported, not applied.
       *
       * It used to overwrite every hex it had an opinion about and stamp it
       * `confidence: 'high'`. That was defensible only while nothing else could
       * read a token at all. It is not defensible now: OCR was measured at 1 of
       * 17 on real captures, and the digit matcher that fills the board before
       * this runs is measured at 100% precision on what it accepts. Letting a
       * 6%-accurate reader overwrite a 100%-precise one, and call the result
       * confident, would undo the entire point.
       *
       * The call is kept because the diagnostic export uses what it saw, and
       * because a note costs the player nothing. If the diagnostics harness
       * goes, this goes with it.
       */
        return {
          hexes,
          note: `Saw ${readings.length}, applied none (matcher leads) — ${sawSummary}`,
        };
      } catch (err) {
        return { hexes, note: `OCR threw: ${String(err)}` };
      }
    },
    [lastShotUri],
  );

  /**
   * Read the held frame with one corner set, without merging into the session.
   *
   * Merging is what the real flow does, and it is exactly what a measurement
   * must not do — prior evidence would carry a good read into a bad one and
   * flatter the result.
   */
  const readSnapshot = useCallback(
    (label: string, pts: readonly NormPoint[]): ReadingSnapshot | null => {
      const buffer = bufferRef.current;
      if (!buffer || pts.length !== 4) return null;

      const imagePoints = pts.map(p => ({
        x: p.x * buffer.width,
        y: p.y * buffer.height,
      })) as [Point, Point, Point, Point];

      // Same pipeline as the real read, or the A/B measures a different reader.
      const reading = readFrame(balanceForBoard(buffer, imagePoints), imagePoints);
      const corners = pts.map(p => ({ x: p.x, y: p.y }));

      if (reading.evidence.length === 0) {
        return {
          label,
          corners,
          hexes: [],
          usable: false,
          coverage: reading.assessment.coverage,
          reason: reading.assessment.reason,
        };
      }

      const hexes = reconcileBoardFromEvidence(reading.evidence).hexes;
      return {
        label,
        corners,
        hexes: hexes.map(h => ({
          index: h.index,
          resource: h.resource ?? null,
          number: h.number ?? null,
          confidence: h.confidence,
        })),
        usable: true,
        coverage: reading.assessment.coverage,
        score: groundTruth ? scoreReading(hexes, groundTruth) : undefined,
      };
    },
    [groundTruth],
  );

  /**
   * The A/B that matters: same photo, both corner sets.
   *
   * Two shots cannot answer this. They differ in the corners AND in the photo,
   * so a better second result proves nothing about which one helped.
   */
  const compareCorners = useCallback(async () => {
    if (!guideCorners || !corners) return;
    const a = readSnapshot('guide corners', guideCorners);
    const b = readSnapshot('marked corners', corners);
    const rows = [a, b].filter(Boolean) as ReadingSnapshot[];
    setComparison(rows);

    /**
     * Measure the digit reader too, not just the two corner sets.
     *
     * Without this the export scores only the blob counter — which is the
     * reader we already know tops out around half on a good photo and much
     * worse on a poor one. The whole point of adding OCR was to replace it, so
     * leaving it out of the instrument means a capture cannot answer the only
     * question that now matters.
     */
    if (!b || b.hexes.length === 0) return;
    const asHexes: CatanHexDef[] = b.hexes.map(h => ({
      index: h.index,
      resource: h.resource as CatanHexDef['resource'],
      number: h.number,
      confidence: h.confidence as CatanHexDef['confidence'],
    }));
    // Also guarded: losing this row is losing the measurement.
    let hexes = asHexes;
    let note: string | undefined;
    try {
      const out = await applyOcr(asHexes);
      hexes = out.hexes;
      note = out.note;
    } catch (err) {
      note = `compare threw: ${String(err)}`;
    }
    setComparison([
      ...rows,
      {
        label: `digits (OCR) — ${note ?? 'no note'}`,
        corners: b.corners,
        hexes: hexes.map(h => ({
          index: h.index,
          resource: h.resource ?? null,
          number: h.number ?? null,
          confidence: h.confidence,
        })),
        usable: true,
        coverage: b.coverage,
        score: groundTruth ? scoreReading(hexes, groundTruth) : undefined,
      },
    ]);
  }, [guideCorners, corners, readSnapshot, applyOcr, groundTruth]);

  const exportDiagnostic = useCallback(async () => {
    const buffer = bufferRef.current;
    if (!buffer) return;
    const readings =
      comparison ??
      ([readSnapshot('marked corners', cornersRef.current)].filter(Boolean) as ReadingSnapshot[]);

    const payload = buildDiagnosticPayload({
      bufferWidth: buffer.width,
      bufferHeight: buffer.height,
      groundTruth,
      readings,
    });

    try {
      await Share.share({
        title: 'Board reader diagnostic',
        message: `${summariseForHumans(payload)}

${JSON.stringify(payload)}`,
      });
    } catch {
      Alert.alert('Could not share', 'The diagnostic was not shared.');
    }
  }, [comparison, groundTruth, readSnapshot]);

  const reset = useCallback(() => setComparison(null), []);

  return { groundTruth, comparison, compareCorners, exportDiagnostic, reset };
}
