/**
 * Live board scanning.
 *
 * Hold the phone over the board, line it up inside the on-screen guide, and the
 * reader works continuously — tiles fill in as they become certain, and the app
 * says where to point next for the ones that have not.
 *
 * WHY THE GUIDE IS NOT JUST A HINT
 * --------------------------------
 * The guide hexagon IS the coordinate system. Aligning the board to it is what
 * supplies the geometry, which is the one thing the reader cannot infer for
 * itself — fully automatic detection was prototyped and measured at no better
 * than chance, largely because most photos people take do not contain the whole
 * board. Aiming the camera solves that structurally: you cannot frame a bad
 * shot, because the guide will not line up until the board is fully in view.
 *
 * WHY PERIODIC CAPTURE RATHER THAN A FRAME PROCESSOR
 * --------------------------------------------------
 * expo-camera exposes no continuous pixel stream, so this takes a low-resolution
 * still every SCAN_INTERVAL_MS and reads that. Roughly three reads a second,
 * which is ample for guidance — the player is moving a phone by hand, not
 * tracking a moving target. Swapping in react-native-vision-camera later touches
 * only the capture loop below.
 *
 * This tool is not affiliated with or endorsed by the publishers or owners of Catan.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Polygon, Circle } from 'react-native-svg';

import { useColors } from '@/hooks/useColors';
import { loadPixelBuffer } from '@/services/vision/pixelSource';
import { downscale } from '@/services/vision/pixelBuffer';
import { readFrame } from '@/services/vision/readFrame';
import {
  emptyEvidence,
  evidenceConfidence,
  guidanceForEvidence,
  mergeEvidence,
  CONFIDENCE_THRESHOLD,
} from '@/services/vision/evidenceMerge';
import { reconcileBoardFromEvidence } from '@/services/boardConstraints';
import { HEX_CENTERS, hexOutline } from '@/services/vision/boardGeometry';
import type { HexEvidence } from '@/services/boardConstraints';
import type { Point } from '@/services/vision/homography';

/** ~3 reads a second. Fast enough to feel live, slow enough to stay ahead of. */
const SCAN_INTERVAL_MS = 320;

/** Frames are downscaled before reading — the reader needs a few thousand pixels. */
const TARGET_WIDTH = 720;

/** Guide occupies this fraction of the shorter screen edge. */
const GUIDE_FILL = 0.86;

export default function CatanLiveScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);

  const [evidence, setEvidence] = useState<HexEvidence[]>(emptyEvidence);
  const [status, setStatus] = useState('Line the board up inside the guide');
  const [scanning, setScanning] = useState(true);
  const [framesRead, setFramesRead] = useState(0);

  const guidance = guidanceForEvidence(evidence);
  const confidences = evidence.map(evidenceConfidence);

  // ── Guide geometry ─────────────────────────────────────────────────────────
  // Canonical board space is centred on the origin and spans roughly ±4.4 hex
  // radii. Map it into a centred square on screen; the same mapping is handed to
  // the reader, which is what makes the overlay and the sampling agree.
  const guideRadius = (Math.min(screenW, screenH) * GUIDE_FILL) / 2;
  const cx = screenW / 2;
  const cy = screenH / 2;
  const CANONICAL_EXTENT = 4.4;
  const toScreen = useCallback(
    (p: Point): Point => ({
      x: cx + (p.x / CANONICAL_EXTENT) * guideRadius,
      y: cy + (p.y / CANONICAL_EXTENT) * guideRadius,
    }),
    [cx, cy, guideRadius],
  );

  useEffect(() => () => { mounted.current = false; }, []);

  // ── The capture loop ───────────────────────────────────────────────────────
  const readOnce = useCallback(async () => {
    if (busy.current || !cameraRef.current) return;
    busy.current = true;
    try {
      const shot = await cameraRef.current.takePictureAsync({
        quality: 0.4,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!shot?.uri || !mounted.current) return;

      const raw = await loadPixelBuffer(shot.uri);
      if (!raw || !mounted.current) return;
      const buffer = downscale(raw, Math.max(1, Math.round(raw.width / TARGET_WIDTH)));

      // The guide is drawn in screen space; the photo has its own dimensions, so
      // express the same four corners as a fraction of each.
      const corners = [0, 2, 18, 16].map(i => {
        const s = toScreen(HEX_CENTERS[i]!);
        return { x: (s.x / screenW) * buffer.width, y: (s.y / screenH) * buffer.height };
      }) as [Point, Point, Point, Point];

      // Only spend token decoding on hexes that still need it — it is far more
      // expensive than colour sampling, and most tiles settle after a frame or two.
      const stillWeak = evidence
        .map((e, i) => (evidenceConfidence(e) < CONFIDENCE_THRESHOLD ? i : -1))
        .filter(i => i >= 0);

      const reading = readFrame(buffer, corners, { decodeTokensFor: stillWeak });
      if (!mounted.current) return;

      setStatus(reading.assessment.reason);
      if (reading.evidence.length > 0) {
        setEvidence(prev => mergeEvidence(prev, reading.evidence));
        setFramesRead(n => n + 1);
      }
    } catch {
      // A dropped frame is not an error worth surfacing — the next one is 300ms away.
    } finally {
      busy.current = false;
    }
  }, [evidence, screenW, screenH, toScreen]);

  useEffect(() => {
    if (!scanning || !permission?.granted) return;
    const timer = setInterval(() => { void readOnce(); }, SCAN_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [scanning, permission?.granted, readOnce]);

  // Stop automatically once the board is fully read — there is nothing further
  // to gain, and leaving the camera running drains the battery.
  useEffect(() => {
    if (guidance.isComplete && scanning) setScanning(false);
  }, [guidance.isComplete, scanning]);

  const handleUse = () => {
    const { hexes } = reconcileBoardFromEvidence(evidence);
    router.push({
      pathname: '/catan-board-scan',
      params: { scanned: JSON.stringify(hexes) },
    } as never);
  };

  // ── Permission gate ────────────────────────────────────────────────────────
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
        <Text style={[s.permTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Camera access needed
        </Text>
        <Text style={[s.permBody, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          The board is read entirely on this device. Nothing is uploaded and no photo is saved.
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
          <Text style={[s.linkText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Enter the board by hand instead
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const readyCount = confidences.filter(c => c >= CONFIDENCE_THRESHOLD).length;

  return (
    <View style={[s.container, { backgroundColor: '#000' }]}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Guide + per-hex progress. Hexes fill in as they become certain, so the
          player can see the scan working rather than waiting on a spinner. */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {HEX_CENTERS.map((centre, i) => {
          const pts = hexOutline(i).map(toScreen).map(p => `${p.x},${p.y}`).join(' ');
          const done = confidences[i]! >= CONFIDENCE_THRESHOLD;
          return (
            <Polygon
              key={i}
              points={pts}
              fill={done ? 'rgba(26,188,156,0.28)' : 'rgba(0,0,0,0.12)'}
              stroke={done ? '#1ABC9C' : 'rgba(255,255,255,0.55)'}
              strokeWidth={done ? 2.5 : 1.5}
            />
          );
        })}
        {/* Dot marks the four tiles the geometry is anchored to. */}
        {[0, 2, 18, 16].map(i => {
          const p = toScreen(HEX_CENTERS[i]!);
          return <Circle key={`c${i}`} cx={p.x} cy={p.y} r={4} fill="#F59E0B" />;
        })}
      </Svg>

      {/* Status */}
      <View style={[s.topBar, { paddingTop: insets.top + (Platform.OS === 'web' ? 60 : 8) }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={s.closeBtn}>
          <Ionicons name="close" size={26} color="#FFF" />
        </TouchableOpacity>
        <View style={s.progressPill}>
          <Text style={[s.progressText, { fontFamily: 'Inter_600SemiBold' }]}>
            {readyCount}/19 tiles
          </Text>
        </View>
      </View>

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 20 }]}>
        <View style={s.statusPill}>
          {scanning && !guidance.isComplete && (
            <ActivityIndicator size="small" color="#1ABC9C" style={{ marginRight: 8 }} />
          )}
          <Text style={[s.statusText, { fontFamily: 'Inter_500Medium' }]} numberOfLines={2}>
            {guidance.isComplete ? guidance.message : (framesRead > 0 ? guidance.message : status)}
          </Text>
        </View>

        {guidance.isComplete ? (
          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: '#1ABC9C' }]} onPress={handleUse}>
            <Text style={[s.primaryBtnText, { color: '#04211C', fontFamily: 'Inter_700Bold' }]}>
              Use this board
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={[s.secondaryBtn, { borderColor: 'rgba(255,255,255,0.5)' }]}
              onPress={() => setScanning(v => !v)}
            >
              <Text style={[s.secondaryText, { fontFamily: 'Inter_500Medium' }]}>
                {scanning ? 'Pause' : 'Resume'}
              </Text>
            </TouchableOpacity>
            {readyCount > 0 && (
              <TouchableOpacity
                style={[s.secondaryBtn, { borderColor: 'rgba(255,255,255,0.5)' }]}
                onPress={handleUse}
              >
                <Text style={[s.secondaryText, { fontFamily: 'Inter_500Medium' }]}>
                  Use anyway
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centred: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  permTitle: { fontSize: 18, marginTop: 8 },
  permBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 8 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeBtn: { padding: 6 },
  progressPill: {
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  progressText: { color: '#FFF', fontSize: 13 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 20, gap: 12,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.68)', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14,
  },
  statusText: { color: '#FFF', fontSize: 14, flex: 1 },
  actionRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: {
    flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  secondaryText: { color: '#FFF', fontSize: 15 },
  primaryBtn: { borderRadius: 12, paddingVertical: 15, paddingHorizontal: 28, alignItems: 'center' },
  primaryBtnText: { fontSize: 16 },
  linkBtn: { paddingVertical: 10 },
  linkText: { fontSize: 13 },
});
