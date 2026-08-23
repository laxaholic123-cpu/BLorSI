/**
 * Board capture — line the board up in the guide, take one shot.
 *
 * WHY ONE SHOT RATHER THAN CONTINUOUS SCANNING
 * --------------------------------------------
 * This screen used to read continuously while the player held the phone over the
 * board. Two things were wrong with that, and they were connected.
 *
 * It was physically awkward: holding a whole board aligned to a fixed on-screen
 * shape, steady, for an extended period. And it did not converge — because hands
 * drift, so consecutive frames sampled slightly different physical spots and
 * disagreed with each other. Merging sums costs, so disagreement pulled
 * confidence DOWN, and confirmed tiles could un-confirm. A tile count that goes
 * backwards is not a tuning problem; it means the input was unreliable.
 *
 * The recogniser has since become strong enough to read a board correctly from a
 * single well-aligned frame, which removes the reason to take many. So: aim,
 * shoot once, read at full quality with no realtime budget, and show the result.
 * A moment of holding instead of a minute of it.
 *
 * The guide is still the coordinate system — aligning the board to it is what
 * supplies the geometry. Three separate attempts at inferring geometry
 * automatically all failed (see tools/), and none of them is needed: aiming the
 * camera answers the question by construction.
 *
 * Shooting again is still offered, but as a deliberate act rather than a loop.
 * A second aimed shot is honest evidence and merges safely; thirty drifting
 * frames a second were not.
 *
 * This tool is not affiliated with or endorsed by the publishers or owners of Catan.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Platform,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Polygon, Circle } from 'react-native-svg';

import { useColors } from '@/hooks/useColors';
import { loadPixelBuffer } from '@/services/vision/pixelSource';
import { downscale, screenToImage } from '@/services/vision/pixelBuffer';
import { readFrame } from '@/services/vision/readFrame';
import {
  CONFIDENCE_THRESHOLD,
  emptyEvidence,
  evidenceConfidence,
  guidanceForEvidence,
  mergeEvidence,
} from '@/services/vision/evidenceMerge';
import { reconcileBoard, reconcileBoardFromEvidence } from '@/services/boardConstraints';
import { HEX_CENTERS, hexOutline } from '@/services/vision/boardGeometry';
import {
  buildDiagnosticPayload,
  scoreReading,
  summariseForHumans,
  type ReadingSnapshot,
} from '@/services/vision/diagnostics';
import { loadGroundTruth } from '@/services/storage';
import { recognizeBoardText, recognizeTokenFaces } from '@/services/vision/ocrSource';
import { mapOcrToHexes } from '@/services/vision/ocrTokens';
import type { HexEvidence } from '@/services/boardConstraints';
import type { Point } from '@/services/vision/homography';
import type { CatanHexDef } from '@/types/models';

/**
 * Working width for the read.
 *
 * Far larger than the live loop could afford. With one shot there is no frame
 * budget, so the token crops keep enough pixels for the digits to survive
 * thresholding — which is what the number decode depends on.
 *
 * Raised from 1400 after measuring. At 1400 the buffer came out 1536 wide, the
 * token face about 55px across, and the pips roughly 4px — below what blob
 * counting can resolve, which is why pips were consistently UNDER-counted. Read
 * at falling resolutions the same photo scored 4, 3, 1, 2 out of 14: the decode
 * is resolution-limited, so the downscale was destroying the very detail the
 * comment above claims it preserves.
 *
 * 2400 leaves a typical phone photo (~3000px) untouched, and still halves
 * anything enormous.
 */
const TARGET_WIDTH = 2400;

/** Guide occupies this fraction of the shorter screen edge. */
const GUIDE_FILL = 0.88;

/** Canonical board half-extent, including the outer hexes' sample rings. */
const CANONICAL_EXTENT = 4.4;

type Phase = 'aiming' | 'reading' | 'adjust' | 'review';

/** A point in normalised image space, 0-1 on each axis. */
interface NormPoint { x: number; y: number }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Which hexes the four adjustable handles sit on, and what to call them.
 *
 * These are hex CENTRES, not board corners — `readFrame` wants the middle of
 * each corner tile, which is why the on-screen copy says "centre of that tile"
 * rather than "corner of the board".
 */
const HANDLE_HEXES = [0, 2, 18, 16] as const;
const HANDLE_LABELS = ['TL', 'TR', 'BR', 'BL'] as const;

const RESOURCE_LABEL: Record<string, string> = {
  grain: 'Grain', wool: 'Wool', lumber: 'Lumber',
  brick: 'Brick', ore: 'Ore', desert: 'Desert', any: '—',
};

export default function CatanCaptureScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const [phase, setPhase] = useState<Phase>('aiming');
  const [evidence, setEvidence] = useState<HexEvidence[]>(emptyEvidence);
  const [board, setBoard] = useState<CatanHexDef[]>([]);
  const [shots, setShots] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /**
   * The last photo taken, kept only so a bad read can be saved and measured.
   *
   * The reader scored 19/19 on a reference board with hand-marked corners and
   * far worse on real device captures. Nothing in `tools/` can explain that
   * without the actual failing images — every claim in services/vision was
   * measured against real photos, and a fix guessed at without one would be the
   * confident-and-wrong pattern this area keeps producing.
   *
   * Held in memory only. Nothing leaves the phone unless the player taps save.
   */
  const [lastShotUri, setLastShotUri] = useState<string | null>(null);
  const [savingShot, setSavingShot] = useState(false);

  /**
   * The decoded frame, held between capture and read.
   *
   * A ref rather than state: it is large, and nothing about rendering depends
   * on it. Kept so adjusting the corners re-reads the same photo instead of
   * asking the player to shoot again.
   */
  const bufferRef = useRef<ReturnType<typeof downscale> | null>(null);
  const [shotAspect, setShotAspect] = useState(4 / 3);

  /**
   * The four handle positions, normalised so they survive any display size.
   *
   * Seeded from exactly the guide-derived corners the reader used before this
   * step existed, so confirming without touching anything reproduces the old
   * behaviour precisely. Anything better than that comes from the player
   * actually moving them.
   */
  const [corners, setCorners] = useState<NormPoint[] | null>(null);
  const cornersRef = useRef<NormPoint[]>([]);
  cornersRef.current = corners ?? [];
  const dragStart = useRef<Record<number, NormPoint>>({});
  const [boxSize, setBoxSize] = useState<{ w: number; h: number } | null>(null);

  // ── Diagnostics (temporary; see services/vision/diagnostics.ts) ────────────
  /** The guide-derived corners, kept unmodified so they can be compared against. */
  const [guideCorners, setGuideCorners] = useState<NormPoint[] | null>(null);
  const [groundTruth, setGroundTruth] = useState<CatanHexDef[] | null>(null);
  const [comparison, setComparison] = useState<ReadingSnapshot[] | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

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

  const guidance = guidanceForEvidence(evidence);
  const confidences = evidence.map(evidenceConfidence);

  const guideRadius = (Math.min(screenW, screenH) * GUIDE_FILL) / 2;
  const toScreen = useCallback(
    (p: Point): Point => ({
      x: screenW / 2 + (p.x / CANONICAL_EXTENT) * guideRadius,
      y: screenH / 2 + (p.y / CANONICAL_EXTENT) * guideRadius,
    }),
    [screenW, screenH, guideRadius],
  );

  const capture = useCallback(async () => {
    if (!cameraRef.current) return;
    setPhase('reading');
    setError(null);
    try {
      // Full quality — there is no frame budget with a single shot, and the
      // number decode needs the detail.
      const shot = await cameraRef.current.takePictureAsync({
        quality: 0.95,
        shutterSound: false,
      });
      if (!shot?.uri) throw new Error('no image');
      setLastShotUri(shot.uri);

      const raw = await loadPixelBuffer(shot.uri);
      if (!raw) throw new Error('could not decode');
      const buffer = downscale(raw, Math.max(1, Math.round(raw.width / TARGET_WIDTH)));
      bufferRef.current = buffer;
      // Aspect comes from the BUFFER, not from shot.width/height. Those two can
      // disagree on Android, where EXIF rotation may or may not have been
      // applied by the time each is read. The handles are normalised against
      // buffer coordinates, so anything else would put them somewhere the
      // reader is not looking — and it would look fine on screen while being
      // wrong. If the decoder and <Image> ever disagree about orientation the
      // photo will look obviously squashed here, which is the failure mode to
      // prefer.
      setShotAspect(buffer.width / buffer.height);

      // The preview crops the photo — the aspect ratios differ — so this is not
      // a plain scale. See screenToImage. Normalised here so the handles can be
      // laid out at any display size.
      const seeded = HANDLE_HEXES.map(i => {
        const p = screenToImage(
          toScreen(HEX_CENTERS[i]!), screenW, screenH, buffer.width, buffer.height,
        );
        return { x: clamp01(p.x / buffer.width), y: clamp01(p.y / buffer.height) };
      });
      setCorners(seeded);
      setGuideCorners(seeded);
      setComparison(null);
      setPhase('adjust');
    } catch {
      setError('Could not read that shot. Try again.');
      setPhase('aiming');
    }
  }, [screenW, screenH, toScreen]);

  /**
   * Read the frame using whatever corners are currently set.
   *
   * Separated from capture so the corners can be corrected without retaking
   * the photo. The reader scored 19/19 on a board whose corners were marked by
   * hand and far worse when they came from the guide, so letting a player mark
   * them is the closest the app can get to the conditions that worked.
   */
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

      const merged = hexes.map(h => ({ ...h }));
      for (const r of readings) {
        const hex = merged[r.hexIndex];
        if (!hex || hex.resource === 'desert') continue; // the desert has no token
        hex.number = r.value;
        hex.confidence = 'high';
      }
      return {
        hexes: reconcileBoard(merged).hexes,
        note: `Placed ${readings.length} — ${sawSummary}`,
      };
    },
    [lastShotUri],
  );

  const runRead = useCallback(() => {
    const buffer = bufferRef.current;
    const pts = cornersRef.current;
    if (!buffer || pts.length !== 4) return;

    setPhase('reading');
    setError(null);
    try {
      const imagePoints = pts.map(p => ({
        x: p.x * buffer.width,
        y: p.y * buffer.height,
      })) as [Point, Point, Point, Point];

      const reading = readFrame(buffer, imagePoints);
      if (reading.evidence.length === 0) {
        // Back to adjust, not to aiming: the photo is fine, the corners are the
        // thing to change, and making them reshoot would discard the evidence.
        setError(reading.assessment.reason);
        setPhase('adjust');
        return;
      }

      // A second aimed shot is deliberate evidence, so merging is safe here in a
      // way it was not for a drifting loop.
      const merged = mergeEvidence(evidence, reading.evidence);
      setEvidence(merged);
      const counted = reconcileBoardFromEvidence(merged).hexes;
      setBoard(counted);
      setShots(n => n + 1);
      setPhase('review');

      // OCR runs after the board is already on screen. It is the better reader,
      // but it is also the slower one and the one that can be missing entirely,
      // so the counted board goes up first and is replaced if OCR delivers.
      void applyOcr(counted).then(({ hexes, note }) => {
        setBoard(hexes);
        if (note) setOcrNote(note);
      });
    } catch {
      setError('Could not read that shot. Try adjusting the corners.');
      setPhase('adjust');
    }
  }, [evidence, applyOcr]);

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

      const reading = readFrame(buffer, imagePoints);
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
    const { hexes, note } = await applyOcr(asHexes);
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

  /** One PanResponder per handle, rebuilt only when the display box resizes. */
  const handleResponders = useMemo(
    () =>
      HANDLE_HEXES.map((_, i) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          // Read the live position from the ref, so the responder never has to
          // be rebuilt mid-drag just because the point moved.
          onPanResponderGrant: () => {
            dragStart.current[i] = cornersRef.current[i] ?? { x: 0.5, y: 0.5 };
          },
          onPanResponderMove: (_e, g) => {
            if (!boxSize) return;
            const from = dragStart.current[i] ?? { x: 0.5, y: 0.5 };
            setCorners(prev => {
              if (!prev) return prev;
              const next = [...prev];
              next[i] = {
                x: clamp01(from.x + g.dx / boxSize.w),
                y: clamp01(from.y + g.dy / boxSize.h),
              };
              return next;
            });
          },
        }),
      ),
    [boxSize],
  );

  const useBoard = () => {
    router.push({
      pathname: '/catan-board-scan',
      params: { scanned: JSON.stringify(board) },
    } as never);
  };

  const startOver = () => {
    setEvidence(emptyEvidence());
    setBoard([]);
    setShots(0);
    setPhase('aiming');
  };

  // ── Permission ─────────────────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={[s.container, s.centred, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[s.container, s.centred, { backgroundColor: colors.background, padding: 24 }]}>
        <Ionicons name="camera-outline" size={44} color={colors.mutedForeground} />
        <Text style={[s.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Camera access needed
        </Text>
        <Text style={[s.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          The board is read entirely on this device. Nothing is uploaded and no photo is kept.
        </Text>
        <TouchableOpacity
          style={[s.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => void requestPermission()}
        >
          <Text style={[s.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
            Allow camera
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.linkBtn} onPress={() => router.back()}>
          <Text style={[s.link, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Enter the board by hand instead
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  /**
   * Save the capture to the camera roll so a bad read becomes a fixture.
   *
   * Same lazy-require and permission dance as share-card.tsx, for the same
   * reason: expo-media-library is a native module and must not be imported at
   * module scope where a web bundle would pick it up.
   */
  const saveShot = async () => {
    if (!lastShotUri || savingShot) return;
    setSavingShot(true);
    try {
      let MediaLibrary: typeof import('expo-media-library');
      try {
        MediaLibrary = require('expo-media-library');
      } catch {
        Alert.alert('Not available', 'Saving photos is not available in this build.');
        return;
      }
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to save this capture.');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(lastShotUri);
      Alert.alert('Saved', 'The capture is in your photos. Send it over with what the board actually was.');
    } catch {
      Alert.alert('Could not save', 'The photo was not saved.');
    } finally {
      setSavingShot(false);
    }
  };

  // ── Adjust the corners ─────────────────────────────────────────────────────
  if (phase === 'adjust' && lastShotUri && corners) {
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 60 : 8) }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => setPhase('aiming')} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Mark the corners
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          <Text style={[s.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'left' }]}>
            Drag each dot to the middle of that corner tile. Getting these right
            matters more than anything else — every tile is measured from them.
          </Text>

          <View
            style={{ width: '100%', aspectRatio: shotAspect, marginVertical: 12 }}
            onLayout={e => setBoxSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            <Image
              source={{ uri: lastShotUri }}
              style={{ width: '100%', height: '100%', borderRadius: 8 }}
              resizeMode="stretch"
            />

            {/* The quad being marked out, drawn under the handles. */}
            {boxSize && (
              <Svg
                style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
                pointerEvents="none"
              >
                <Polygon
                  points={corners.map(c => `${c.x * boxSize.w},${c.y * boxSize.h}`).join(' ')}
                  fill="#1ABC9C22"
                  stroke="#1ABC9C"
                  strokeWidth={2}
                />
              </Svg>
            )}

            {boxSize &&
              corners.map((c, i) => (
                <View
                  key={`handle-${i}`}
                  {...handleResponders[i]!.panHandlers}
                  style={{
                    position: 'absolute',
                    // Generous target: this is a precision drag on a small
                    // image, and the visible dot is far smaller than a finger.
                    left: c.x * boxSize.w - 26,
                    top: c.y * boxSize.h - 26,
                    width: 52,
                    height: 52,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <View style={s.handleDot}>
                    <Text style={s.handleLabel}>{HANDLE_LABELS[i]}</Text>
                  </View>
                </View>
              ))}
          </View>

          {error && (
            <Text style={[s.body, { color: '#F59E0B', fontFamily: 'Inter_400Regular' }]}>
              {error}
            </Text>
          )}

          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.primary }]} onPress={runRead}>
            <Text style={[s.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
              Read the board
            </Text>
          </TouchableOpacity>

          {/* ── Diagnostics. Temporary — see services/vision/diagnostics.ts ── */}
          <View style={[s.diagBox, { borderColor: colors.border }]}>
            <Text style={[s.diagTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
              DIAGNOSTICS
            </Text>
            <Text style={[s.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {groundTruth
                ? 'Ground truth is set, so reads are scored automatically.'
                : 'No ground truth set. Correct a board on the next screen and tap "Set as ground truth" to get scores.'}
            </Text>

            <View style={s.rowBtns}>
              <TouchableOpacity
                style={[s.secondaryBtn, { borderColor: colors.border }]}
                onPress={() => { void compareCorners(); }}
              >
                <Text style={[s.secondaryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  Compare corners
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.secondaryBtn, { borderColor: colors.border }]}
                onPress={exportDiagnostic}
              >
                <Text style={[s.secondaryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                  Export
                </Text>
              </TouchableOpacity>
            </View>

            {comparison?.map(r => (
              <View key={r.label} style={[s.diagResult, { borderTopColor: colors.border }]}>
                <Text style={[s.diagLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                  {r.label}
                </Text>
                {!r.usable ? (
                  <Text style={[s.diagHint, { color: '#F59E0B', fontFamily: 'Inter_400Regular' }]}>
                    unusable — {r.reason ?? 'no reason given'}
                  </Text>
                ) : r.score ? (
                  <>
                    <Text style={[s.diagScore, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                      {r.score.correct}/{r.score.total} exact
                    </Text>
                    <Text style={[s.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                      terrain {r.score.resourceCorrect}/{r.score.total} · tokens{' '}
                      {r.score.numberCorrect}/{r.score.total}
                    </Text>
                    {r.score.mismatches.slice(0, 6).map(m => (
                      <Text
                        key={m.index}
                        style={[s.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
                      >
                        tile {m.index + 1}: got {m.gotResource ?? '?'} {m.gotNumber ?? '—'} · want{' '}
                        {m.wantResource ?? '?'} {m.wantNumber ?? '—'} ({m.wrong})
                      </Text>
                    ))}
                    {r.score.mismatches.length > 6 && (
                      <Text style={[s.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                        …and {r.score.mismatches.length - 6} more (full list in Export)
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={[s.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    read {r.hexes.length} tiles · coverage {(r.coverage * 100).toFixed(0)}%
                  </Text>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity style={s.linkBtn} onPress={() => setPhase('aiming')}>
            <Text style={[s.link, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', textAlign: 'center' }]}>
              Shoot again
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'review') {
    const unsure = confidences.filter(c => c < CONFIDENCE_THRESHOLD).length;
    return (
      <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 60 : 8) }]}>
        <View style={[s.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[s.headerTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            What it read
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          <Text style={[s.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'left' }]}>
            {unsure === 0
              ? `Read all 19 tiles from ${shots} shot${shots === 1 ? '' : 's'}. Check it over — you can correct anything on the next screen.`
              : `${unsure} tile${unsure === 1 ? '' : 's'} came out uncertain. Another shot from a different angle usually settles them, or you can correct them on the next screen.`}
          </Text>

          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {board.map((hex, i) => {
              const sure = confidences[i]! >= CONFIDENCE_THRESHOLD;
              return (
                <View
                  key={hex.index}
                  style={[
                    s.row,
                    { borderBottomColor: colors.border, borderBottomWidth: i === board.length - 1 ? 0 : StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[s.rowIndex, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                    {hex.index + 1}
                  </Text>
                  <Text style={[s.rowMain, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
                    {RESOURCE_LABEL[hex.resource ?? 'any']}
                  </Text>
                  <Text style={[s.rowNum, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                    {hex.number ?? '—'}
                  </Text>
                  <Ionicons
                    name={sure ? 'checkmark-circle' : 'help-circle-outline'}
                    size={18}
                    color={sure ? '#1ABC9C' : '#F59E0B'}
                  />
                </View>
              );
            })}
          </View>

          {ocrNote && (
            <Text style={[s.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'left' }]}>
              Digit reader: {ocrNote}
            </Text>
          )}

          {lastShotUri && (
            <TouchableOpacity
              style={[s.saveShotBtn, { borderColor: colors.border, opacity: savingShot ? 0.6 : 1 }]}
              onPress={saveShot}
              disabled={savingShot}
            >
              <Ionicons name="download-outline" size={16} color={colors.mutedForeground} />
              <Text style={[s.secondaryText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {savingShot ? 'Saving…' : 'Save this photo (helps fix a bad read)'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: colors.primary }]} onPress={useBoard}>
            <Text style={[s.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_600SemiBold' }]}>
              Use this board
            </Text>
          </TouchableOpacity>
          <View style={s.rowBtns}>
            <TouchableOpacity
              style={[s.secondaryBtn, { borderColor: colors.border }]}
              onPress={() => setPhase('aiming')}
            >
              <Text style={[s.secondaryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
                Shoot again
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.secondaryBtn, { borderColor: colors.border }]}
              onPress={startOver}
            >
              <Text style={[s.secondaryText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
                Start over
              </Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={s.linkBtn}
            onPress={() => router.replace('/catan-board-scan' as never)}
          >
            <Text style={[s.link, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium', textAlign: 'center' }]}>
              Try the AI scanner instead
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── Aiming / reading ───────────────────────────────────────────────────────
  const readyCount = confidences.filter(c => c >= CONFIDENCE_THRESHOLD).length;

  return (
    <View style={[s.container, { backgroundColor: '#000' }]}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {HEX_CENTERS.map((_, i) => {
          const pts = hexOutline(i).map(toScreen).map(p => `${p.x},${p.y}`).join(' ');
          const done = shots > 0 && confidences[i]! >= CONFIDENCE_THRESHOLD;
          return (
            <Polygon
              key={i}
              points={pts}
              fill={done ? 'rgba(26,188,156,0.22)' : 'rgba(0,0,0,0.10)'}
              stroke={done ? '#1ABC9C' : 'rgba(255,255,255,0.7)'}
              strokeWidth={done ? 2.5 : 2}
            />
          );
        })}
        {[0, 2, 18, 16].map(i => {
          const p = toScreen(HEX_CENTERS[i]!);
          return <Circle key={`c${i}`} cx={p.x} cy={p.y} r={5} fill="#F59E0B" />;
        })}
      </Svg>

      <View style={[s.topBar, { paddingTop: insets.top + (Platform.OS === 'web' ? 60 : 8) }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={{ padding: 6 }}>
          <Ionicons name="close" size={26} color="#FFF" />
        </TouchableOpacity>
        {shots > 0 && (
          <View style={s.pill}>
            <Text style={[s.pillText, { fontFamily: 'Inter_600SemiBold' }]}>{readyCount}/19</Text>
          </View>
        )}
      </View>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
        <View style={s.statusPill}>
          <Text style={[s.statusText, { fontFamily: 'Inter_500Medium' }]} numberOfLines={2}>
            {error
              ? error
              : phase === 'reading'
                ? 'Reading the board…'
                : shots > 0
                  ? guidance.message
                  : 'Line the whole board up inside the guide, then tap the button'}
          </Text>
        </View>

        <TouchableOpacity
          style={[s.shutter, { opacity: phase === 'reading' ? 0.5 : 1 }]}
          onPress={() => void capture()}
          disabled={phase === 'reading'}
          accessibilityRole="button"
          accessibilityLabel="Capture the board"
        >
          {phase === 'reading' ? (
            <ActivityIndicator color="#000" />
          ) : (
            <View style={s.shutterInner} />
          )}
        </TouchableOpacity>

        {/* The AI reader and manual entry, for when this one cannot manage.
            Both stay one tap away rather than being a dead end. */}
        <TouchableOpacity onPress={() => router.replace('/catan-board-scan' as never)}>
          <Text style={[s.altLink, { fontFamily: 'Inter_500Medium' }]}>
            Use the AI scanner or enter the board by hand
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 18, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17 },
  card: { borderWidth: 1, borderRadius: 12, marginTop: 14, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
  rowIndex: { fontSize: 12, width: 22 },
  rowMain: { fontSize: 15, flex: 1 },
  rowNum: { fontSize: 15, width: 28, textAlign: 'right' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
  },
  pill: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillText: { color: '#FFF', fontSize: 13 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 20, gap: 16 },
  statusPill: { backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, alignSelf: 'stretch' },
  statusText: { color: '#FFF', fontSize: 14, textAlign: 'center' },
  shutter: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFF',
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.45)',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF' },
  primaryBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { fontSize: 16 },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondaryBtn: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  diagBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  diagTitle: { fontSize: 11, letterSpacing: 1, marginBottom: 6 },
  diagHint: { fontSize: 12, lineHeight: 17 },
  diagResult: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  diagLabel: { fontSize: 13, marginBottom: 2 },
  diagScore: { fontSize: 20, marginVertical: 2 },
  handleDot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#1ABC9C', borderWidth: 2, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  handleLabel: { fontSize: 8, fontWeight: '700', color: '#04201B' },
  saveShotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginBottom: 10,
  },
  secondaryText: { fontSize: 15 },
  altLink: { color: 'rgba(255,255,255,0.85)', fontSize: 13, textAlign: 'center', paddingVertical: 6 },
  linkBtn: { paddingVertical: 10 },
  link: { fontSize: 13 },
});
