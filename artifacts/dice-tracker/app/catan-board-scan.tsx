/**
 * Catan Board Scan Screen
 *
 * Lets the user photograph the Catan board, have it analysed by AI,
 * correct any low-confidence hexes manually, then tap hexes to record
 * each player's settlement positions — producing the same
 * CatanPlayerExposureEvent records as the existing quick/detailed setup.
 *
 * Phases:
 *   entry       → choose how to set up the board
 *   analyzing   → AI is reading the photo
 *   review      → inspect / correct the detected hex layout
 *   placement   → per-player settlement placement (hex-tap)
 *
 * Long-press any hex in the review phase to open the inline correction panel.
 * Board layouts can be saved by name and reloaded for future games.
 */

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { useColors } from '@/hooks/useColors';
import { useGame } from '@/context/GameContext';
import { useSettings } from '@/context/SettingsContext';
import { CatanHexGrid } from '@/components/CatanHexGrid';
import {
  clearSlot,
  legalRoads,
  legalSettlements,
  openingOrder,
  placeRoad,
  placeSettlement,
  placementProgress,
  settlementProblem,
  toExposureEvents,
  type PlacementSlot,
} from '@/services/catanPlacement';
import {
  deleteBoardLayout,
  loadBoardLayouts,
  makeEmptyLayout,
  saveBoardLayout,
} from '@/services/boardLayouts';
import { getBoardScanApiUrl } from '@/services/boardScanApi';
import { clearGroundTruth, saveGroundTruth } from '@/services/storage';
import { getLinkedBuildingEventCount, mergeEditedSettlements } from '@/services/editSettlements';
import { normalizePieces, type DetectedPiece } from '@/utils/normalizePieces';
import { describeChange, reconcileBoard, type BoardChange } from '@/services/boardConstraints';
import type { CatanBoardLayout, CatanHexDef, ResourceType } from '@/types/models';
import type { CatanPlayerExposureEvent } from '@/types/models';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanPhase = 'entry' | 'analyzing' | 'review' | 'placement';


// ─── Constants ────────────────────────────────────────────────────────────────

const CATAN_NUMBERS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

/**
 * Colours a player can take, chosen HERE rather than during setup.
 *
 * Picking a colour is only meaningful once the board is on screen and you can
 * see whose pieces are whose, and it is the moment people actually argue about
 * it. The five are widely separated in hue so a settlement dot stays legible
 * against any terrain, and none of them is the cream of a number token.
 */
const PLAYER_COLORS = ['#F5A623', '#4A90D9', '#7ED321', '#D0021B', '#9013FE'];

const RESOURCES: ResourceType[] = ['grain', 'ore', 'lumber', 'brick', 'wool', 'desert'];

const RESOURCE_LABELS: Record<ResourceType, string> = {
  grain:  'Grain',
  ore:    'Ore',
  lumber: 'Lumber',
  brick:  'Brick',
  wool:   'Wool',
  desert: 'Desert',
  any:    'Any',
};

const RESOURCE_COLORS: Record<ResourceType, string> = {
  grain:  '#E8B840',
  ore:    '#8A8A8A',
  lumber: '#2E5E10',
  brick:  '#C03820',
  wool:   '#58B030',
  desert: '#C8A050',
  any:    '#4A6080',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSavedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CatanBoardScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { activeSession, persistExposureEvents, exposureEvents, updateSession } = useGame();
  const { settings } = useSettings();

  // ── Edit-mode: editPlayerId is set when launched from an active game ────────
  // ── scanned: a board already read on-device by the capture screen ──────────
  const { editPlayerId, scanned } = useLocalSearchParams<{
    editPlayerId?: string;
    scanned?: string;
  }>();
  const isEditMode = Boolean(editPlayerId);

  /**
   * A board handed over from the local capture screen, if there is one.
   *
   * Parsed once at mount. Arriving with a board means the reading is already
   * done, so this screen opens straight into review rather than asking the
   * player to scan something they have just scanned.
   */
  const handedOver = React.useMemo<CatanHexDef[] | null>(() => {
    if (!scanned) return null;
    try {
      const parsed = JSON.parse(scanned) as CatanHexDef[];
      return Array.isArray(parsed) && parsed.length === 19 ? parsed : null;
    } catch {
      return null;
    }
  }, [scanned]);

  // ── Phase ──────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<ScanPhase>(handedOver ? 'review' : 'entry');

  // ── Board hexes ────────────────────────────────────────────────────────────
  const [hexes, setHexes] = useState<CatanHexDef[]>(() => handedOver ?? makeEmptyLayout());
  /** Repairs the constraint solver made to the scan, shown in review. */
  const [boardCorrections, setBoardCorrections] = useState<BoardChange[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // ── Saved layouts ──────────────────────────────────────────────────────────
  const [savedLayouts, setSavedLayouts] = useState<CatanBoardLayout[]>([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [layoutName, setLayoutName] = useState('');
  const [isSavingLayout, setIsSavingLayout] = useState(false);

  // ── Correction panel ───────────────────────────────────────────────────────
  const [correctionIdx, setCorrectionIdx] = useState<number | null>(null);
  const [correctionResource, setCorrectionResource] = useState<ResourceType | null>(null);
  const [correctionNumber, setCorrectionNumber] = useState<number | null>(null);

  // ── Placement ──────────────────────────────────────────────────────────────
  const [currentPlayerIdx, setCurrentPlayerIdx] = useState(0);

  /**
   * The opening as a SEQUENCE of turns, not a loop over players.
   *
   * A real opening is a snake draft — out along the seats and back — so the
   * last player places twice in a row and the first player also places last.
   * Every slot is addressable, so any turn can be revisited without disturbing
   * another, which is the thing whose absence forced a full restart before.
   */
  const [slots, setSlots] = useState<PlacementSlot[]>([]);
  const [activeSlot, setActiveSlot] = useState(0);
  /** Colours chosen here rather than at setup, where the board is not visible. */
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});
  const [isSavingGame, setIsSavingGame] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);

  // ── AI piece detection ─────────────────────────────────────────────────────

  // ── Derived ────────────────────────────────────────────────────────────────
  const allPlayers = activeSession?.players ?? [];
  // In edit mode only the targeted player goes through placement
  const players = isEditMode
    ? allPlayers.filter(p => p.id === editPlayerId)
    : allPlayers;
  const currentPlayer = players[currentPlayerIdx];

  const colorOf = useCallback(
    (playerId: string) =>
      colorOverrides[playerId]
      ?? players.find(p => p.id === playerId)?.color
      ?? '#F5A623',
    [colorOverrides, players],
  );
  const lowConfIndices = hexes.map((h, i) => (h.confidence === 'low' ? i : -1)).filter(i => i >= 0);

  /**
   * Say WHICH part of a flagged hex is uncertain.
   *
   * "7 hexes need your attention" was reported as confusing in real use, and
   * fairly: the reader had adjusted seven TERRAINS, the numbers on them were
   * fine, so checking the numbers found nothing wrong and the warning looked
   * like noise. Meanwhile the numbers that WERE wrong sat unflagged. Splitting
   * the count points the player at the thing that is actually unsure.
   */
  const attentionSummary = (() => {
    const numbers = lowConfIndices.filter(i => {
      const h = hexes[i];
      return h && h.resource !== 'desert' && h.number !== null;
    }).length;
    const parts: string[] = [];
    if (numbers > 0) parts.push(`${numbers} number${numbers === 1 ? '' : 's'} to check`);
    const others = lowConfIndices.length - numbers;
    if (others > 0) parts.push(`${others} resource${others === 1 ? '' : 's'} adjusted`);
    return parts.length > 0 ? parts.join(', ') : `${lowConfIndices.length} to check`;
  })();

  const haptic = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
    if (settings.hapticsEnabled) void Haptics.impactAsync(style);
  }, [settings.hapticsEnabled]);

  // ── Saved layouts ──────────────────────────────────────────────────────────
  //
  // On FOCUS, not on mount. The generator can save a layout while this screen
  // sits mounted underneath, and a mount-only read would leave it missing from
  // the list until the app restarted. Third instance of this in one session, so
  // the rule is now: anything reading storage that another screen can write
  // belongs in useFocusEffect.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadBoardLayouts().then(layouts => {
        if (!cancelled) setSavedLayouts(layouts);
      });
      return () => { cancelled = true; };
    }, []),
  );

  // ── No active session guard ────────────────────────────────────────────────
  if (!activeSession) {
    return (
      <View style={[s.centered, { flex: 1, backgroundColor: colors.background }]}>
        <Text style={[s.body, { color: colors.mutedForeground }]}>No active game session.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[s.link, { color: colors.primary }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Image analysis
  // ─────────────────────────────────────────────────────────────────────────

  const pickAndAnalyze = async (source: 'camera' | 'library') => {
    // Permission check (native only)
    if (Platform.OS !== 'web') {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Camera access needed', 'Allow camera access in your device settings to scan the board.');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Photo library access needed', 'Allow photo access in your device settings.');
          return;
        }
      }
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.65,
          base64: true,
          allowsEditing: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.65,
          base64: true,
          allowsEditing: false,
          allowsMultipleSelection: false,
        });

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0]!;
    const base64 = asset.base64;
    if (!base64) {
      Alert.alert('Error', 'Could not read image data.');
      return;
    }

    const apiUrl = getBoardScanApiUrl();
    if (!apiUrl) {
      Alert.alert(
        'AI scan unavailable',
        'Set EXPO_PUBLIC_API_BASE_URL to enable board scanning on native. Proceeding with manual setup.',
      );
      setPhase('review');
      return;
    }

    setAnalysisError(null);
    setPhase('analyzing');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: asset.mimeType ?? 'image/jpeg',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Server error ${response.status}`);
      }

      const data = await response.json() as { hexes: unknown[]; pieces?: unknown[] };
      const rawHexes = Array.isArray(data.hexes) ? data.hexes : [];

      // Merge AI result into our hex array (keep any previously set values as fallback)
      const merged = makeEmptyLayout();
      for (const h of rawHexes as Array<Partial<CatanHexDef>>) {
        const idx = h.index;
        if (typeof idx === 'number' && idx >= 0 && idx < 19) {
          merged[idx] = {
            index: idx,
            resource: (h.resource as ResourceType) ?? null,
            number: typeof h.number === 'number' ? h.number : null,
            confidence: h.confidence === 'high' ? 'high' : 'low',
          };
        }
      }
      // Force the reading into a board that could actually come out of the box.
      // A scan reporting five ore tiles or three 6s is provably wrong, and the
      // solver moves the least-confident readings rather than handing the player
      // an impossible board to correct by hand.
      const { hexes: reconciled, changes } = reconcileBoard(merged);
      setHexes(reconciled);
      setBoardCorrections(changes);
      /**
       * Detected pieces are no longer stored.
       *
       * They only ever fed the placement pre-fill, which recorded a settlement
       * as touching the ONE hex the piece sat on — when a real settlement sits
       * on a corner and touches up to three. Every pre-filled placement
       * therefore understated its owner's exposure. The scan still returns
       * them; nothing needs them until something can resolve a piece to a
       * corner rather than a tile.
       */
      setPhase('review');
    } catch (err) {
      // TypeError = network-level failure (device can't reach server).
      // Any other Error = meaningful server/parse message worth showing.
      const msg =
        err instanceof TypeError
          ? "Couldn't reach the board scanner — check your connection and try again"
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      setAnalysisError(msg);
      setPhase('review'); // Still go to review so user can set hexes manually
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Hex correction
  // ─────────────────────────────────────────────────────────────────────────

  const openCorrection = (index: number) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    const h = hexes[index];
    setCorrectionResource(h?.resource ?? null);
    setCorrectionNumber(h?.number ?? null);
    setCorrectionIdx(index);
  };

  /**
   * A productive hex without a number token cannot exist on a real board — only
   * the desert has no token. Saving one produced a hex that silently contributed
   * nothing to production, which looks identical to bad luck in the results.
   */
  const correctionIncomplete =
    correctionResource !== null && correctionResource !== 'desert' && correctionNumber === null;

  const confirmCorrection = () => {
    if (correctionIdx === null) return;
    if (correctionIncomplete) {
      haptic(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }
    haptic();
    setHexes(prev => {
      const next = [...prev];
      next[correctionIdx] = {
        index: correctionIdx,
        resource: correctionResource,
        number: correctionResource === 'desert' ? null : correctionNumber,
        confidence: 'high',
      };
      return next;
    });
    setCorrectionIdx(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Layout save / load
  // ─────────────────────────────────────────────────────────────────────────

  const handleSaveLayout = async () => {
    setIsSavingLayout(true);
    try {
      await saveBoardLayout(hexes, layoutName || 'My Board');
      const layouts = await loadBoardLayouts();
      setSavedLayouts(layouts);
      setShowSaveModal(false);
      setLayoutName('');
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleLoadLayout = (layout: CatanBoardLayout) => {
    haptic();
    setHexes(layout.hexes.map(h => ({ ...h })));
    setShowLoadModal(false);
    setPhase('review');
  };

  const handleDeleteLayout = async (id: string) => {
    await deleteBoardLayout(id);
    setSavedLayouts(prev => prev.filter(l => l.id !== id));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Settlement placement
  // ─────────────────────────────────────────────────────────────────────────

  const enterPlacement = () => {
    // In edit mode, block if the player has city upgrades / removals / manual
    // corrections on top of their starting settlement locations.  Replacing the
    // initial settlements in that state would leave those dependent events
    // pointing at now-deleted location IDs, producing phantom buildings.
    if (isEditMode && editPlayerId) {
      const linkedCount = getLinkedBuildingEventCount(exposureEvents, editPlayerId);
      if (linkedCount > 0) {
        const playerName = currentPlayer?.displayName ?? 'This player';
        Alert.alert(
          'Edit Blocked',
          `${playerName} has ${linkedCount} in-game building change${linkedCount === 1 ? '' : 's'} (such as a city upgrade or building removal) on top of their starting positions. Undo those changes before editing settlements.`,
          [{ text: 'OK' }],
        );
        return;
      }
    }
    setCurrentPlayerIdx(0);
    setPlacementError(null);
    /**
     * Photo-detected pieces no longer pre-fill placements, and that is a
     * correctness fix rather than a loss.
     *
     * A detected piece is located on a HEX, and the old flow recorded it as a
     * settlement touching that one hex. A real settlement sits on a CORNER and
     * touches up to three — so every pre-filled placement understated its
     * owner's exposure, which understates expected production and inflates
     * their apparent luck. There is no way to recover which of a hex's six
     * corners a piece is on from the hex alone, so the honest move is to let
     * the player tap it.
     */
    beginPlacement();
    setPhase('placement');
  };

  // ── Opening placement ──────────────────────────────────────────────────────

  /** Seed the snake draft when placement starts, preserving anything already set. */
  const beginPlacement = useCallback(() => {
    setSlots(prev => (prev.length === players.length * 2
      ? prev
      : openingOrder(players.map(p => p.id))));
    setActiveSlot(0);
    setPlacementError(null);
  }, [players]);

  const active = slots[activeSlot];
  /**
   * A turn is placed in two taps: the corner, then one of the two or three
   * roads leading off it. Which one we are waiting for decides what the board
   * offers, and only LEGAL targets are drawn — a mis-tap here does not look
   * like an error, it silently records production the player never had.
   */
  const awaitingRoad = Boolean(active?.settlement && !active?.road);

  const onCornerTap = (cornerId: string) => {
    if (!active) return;
    const result = placeSettlement(slots, active.index, cornerId);
    if (result.problem) {
      haptic(Haptics.ImpactFeedbackStyle.Medium);
      setPlacementError(
        result.problem === 'occupied' ? 'Someone is already on that corner.'
        : result.problem === 'too_close' ? 'Too close — settlements need a gap of at least one corner.'
        : 'That corner cannot be used.',
      );
      return;
    }
    haptic();
    setPlacementError(null);
    setSlots(result.slots);
  };

  const onRoadTap = (edgeId: string) => {
    if (!active) return;
    const result = placeRoad(slots, active.index, edgeId);
    if (result.problem) {
      haptic(Haptics.ImpactFeedbackStyle.Medium);
      setPlacementError('That road cannot be built there.');
      return;
    }
    haptic();
    setPlacementError(null);
    const next = result.slots;
    setSlots(next);
    // Move on to whatever is still outstanding, which after a clean run is the
    // next slot in the snake. Advisory only — the strip below stays tappable.
    const suggestion = placementProgress(next).suggested;
    if (suggestion !== null) setActiveSlot(suggestion);
  };

  const onClearSlot = (index: number) => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    setSlots(prev => clearSlot(prev, index));
    setActiveSlot(index);
    setPlacementError(null);
  };

  /** Corners already built on, by anyone, in that player's colour. */
  const settlementMarks = useMemo(() => {
    const marks: Record<string, string> = {};
    for (const slot of slots) {
      if (slot.settlement) marks[slot.settlement] = colorOf(slot.playerId);
    }
    return marks;
  }, [slots, colorOf]);

  const roadMarks = useMemo(() => {
    const marks: Record<string, string> = {};
    for (const slot of slots) {
      if (slot.road) marks[slot.road] = colorOf(slot.playerId);
    }
    return marks;
  }, [slots, colorOf]);

  /** Only what the active turn may legally take. Recomputed as the board fills. */
  const offeredCorners = useMemo(
    () => (active && !awaitingRoad ? legalSettlements(slots, active.index) : []),
    [slots, active, awaitingRoad],
  );
  const offeredRoads = useMemo(
    () => (active && awaitingRoad ? legalRoads(slots, active.index) : []),
    [slots, active, awaitingRoad],
  );

  const handleStartGame = async () => {
    if (isSavingGame) return;
    setIsSavingGame(true);
    try {
      /**
       * One conversion, in the service, so the corner id leads every location
       * key. Building these by hand from hex indices is what collapsed 54
       * corners onto 19 keys and silently erased one of a player's two
       * settlements — understating their expected production and inflating
       * their apparent luck.
       *
       * Roads are not emitted: exposure describes what a position PRODUCES and
       * a road produces nothing. They stay in `slots` for a future Longest Road.
       */
      const newEvents = toExposureEvents(slots, activeSession.id, hexes);

      // Colours were chosen on this screen, so they have to go back onto the
      // session or the game screen shows the setup defaults instead.
      if (Object.keys(colorOverrides).length > 0) {
        await updateSession({
          ...activeSession,
          players: activeSession.players.map(p =>
            colorOverrides[p.id] ? { ...p, color: colorOverrides[p.id]! } : p),
        });
      }

      if (isEditMode && editPlayerId) {
        // Replace only the edited player's *initial* settlement events.
        // All in-game events (city upgrades, settlements built mid-game,
        // robber blocks, manual corrections) are preserved for every player.
        const merged = mergeEditedSettlements(exposureEvents, newEvents, editPlayerId);
        await persistExposureEvents(activeSession.id, merged);
        router.back();
      } else {
        await persistExposureEvents(activeSession.id, newEvents);
        router.replace('/active-catan' as never);
      }
    } catch {
      Alert.alert('Error', 'Could not save settlement data. Please try again.');
    } finally {
      setIsSavingGame(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Skip to existing quick setup (not available in edit mode)
  // ─────────────────────────────────────────────────────────────────────────

  const handleSkip = () => router.replace('/catan-exposure-quick' as never);

  const handleBack = () => {
    if (phase === 'review') setPhase('entry');
    else if (phase === 'placement') setPhase('review');
    else if (isEditMode) router.back();
    else router.back();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Renders
  // ─────────────────────────────────────────────────────────────────────────

  const renderEntry = () => (
    <ScrollView contentContainerStyle={s.entryScroll}>
      <Text style={[s.entryTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
        How do you want to set up the board?
      </Text>
      <Text style={[s.entrySub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        Scan the board once — the app reads number tokens and resources automatically, then each player taps where their settlements are.
      </Text>

      {/* Scan options */}
      <EntryCard
        icon="camera-outline"
        title="Take a Photo"
        desc="Photograph the board right now"
        colors={colors}
        onPress={() => void pickAndAnalyze('camera')}
      />
      <EntryCard
        icon="image-outline"
        title="Pick from Library"
        desc="Use an existing photo of the board"
        colors={colors}
        onPress={() => void pickAndAnalyze('library')}
      />
      {savedLayouts.length > 0 && (
        <EntryCard
          icon="folder-open-outline"
          title="Load Saved Layout"
          desc={`${savedLayouts.length} saved board${savedLayouts.length === 1 ? '' : 's'}`}
          colors={colors}
          onPress={() => setShowLoadModal(true)}
          accent
        />
      )}
      <EntryCard
        icon="pencil-outline"
        title="Set Up Manually"
        desc="Tap each hex to enter resources and numbers"
        colors={colors}
        onPress={() => {
          setHexes(makeEmptyLayout());
          setPhase('review');
        }}
      />

      <TouchableOpacity style={s.skipLink} onPress={handleSkip}>
        <Text style={[s.skipLinkText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Skip board scan — enter numbers per player manually →
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderAnalyzing = () => (
    <View style={[s.centered, { flex: 1 }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[s.analyzingText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
        Reading the board…
      </Text>
      <Text style={[s.analyzingHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        AI is identifying each hex. This takes a few seconds.
      </Text>
    </View>
  );

  const renderReview = () => {
    const unknownCount = hexes.filter(h => h.resource === null || h.number === null).length;
    return (
      <ScrollView contentContainerStyle={s.reviewScroll}>
        {analysisError && (
          <View style={[s.errorBanner, { backgroundColor: colors.destructive + '22', borderColor: colors.destructive }]}>
            <Ionicons name="warning-outline" size={16} color={colors.destructive} />
            <Text style={[s.errorText, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
              {analysisError}. Set hexes manually by long-pressing them.
            </Text>
          </View>
        )}
        {lowConfIndices.length > 0 && (
          <View style={[s.hintBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Ionicons name="alert-circle-outline" size={16} color="#F59E0B" />
            <Text style={[s.hintText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {attentionSummary} — long-press any amber hex to correct it.
            </Text>
          </View>
        )}
        {boardCorrections.length > 0 && (
          <View style={[s.hintBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Ionicons name="construct-outline" size={16} color={colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[s.hintText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                The scan didn&apos;t match the pieces in the box, so{' '}
                {boardCorrections.length} reading{boardCorrections.length === 1 ? ' was' : 's were'} adjusted
                to make the board possible. Check these:
              </Text>
              {boardCorrections.slice(0, 6).map((change, i) => (
                <Text
                  key={`${change.hexIndex}-${change.field}-${i}`}
                  style={[s.hintText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
                >
                  • {describeChange(change)}
                </Text>
              ))}
            </View>
          </View>
        )}

        <CatanHexGrid
          hexes={hexes}
          onHexLongPress={openCorrection}
          lowConfidenceIndices={lowConfIndices}
          style={{ marginVertical: 8 }}
        />

        <Text style={[s.reviewHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Long-press any hex to correct its resource or number.
          {unknownCount > 0 ? ` ${unknownCount} hex${unknownCount === 1 ? '' : 'es'} still unknown.` : ' All hexes set ✓'}
        </Text>

        {/* Diagnostics. Temporary — see services/vision/diagnostics.ts.
            This screen is where a board gets corrected until it is right, which
            makes it the only place the true answer actually exists. */}
        <TouchableOpacity
          style={[s.secondaryBtn, { borderColor: colors.border, marginBottom: 10 }]}
          onPress={() => {
            const complete = hexes.length === 19 && hexes.every(h => h.resource !== null);
            if (!complete) {
              Alert.alert(
                'Board not complete',
                'Every hex needs a resource before this can be the answer to score against.',
              );
              return;
            }
            // Two buttons, not three. The previous version put a destructive
            // "Clear existing" between Cancel and Set, which on Android renders
            // as the neutral middle button and is very easy to hit by mistake.
            Alert.alert(
              'Set as ground truth?',
              'Captures will be scored against this board. Only do this once it matches the table exactly.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Set',
                  onPress: () => {
                    void saveGroundTruth(hexes).then(() =>
                      // Confirm, so it is never ambiguous whether it took.
                      Alert.alert('Ground truth set', 'Captures will now be scored against this board.'),
                    );
                  },
                },
              ],
            );
          }}
          onLongPress={() => {
            Alert.alert(
              'Clear ground truth?',
              'Captures will stop being scored until a new one is set.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Clear',
                  style: 'destructive',
                  onPress: () => {
                    void clearGroundTruth().then(() =>
                      Alert.alert('Cleared', 'No ground truth is set.'),
                    );
                  },
                },
              ],
            );
          }}
        >
          <Ionicons name="flask-outline" size={16} color={colors.mutedForeground} />
          <Text style={[s.secondaryBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            Set as ground truth (long-press to clear)
          </Text>
        </TouchableOpacity>

        <View style={s.reviewActions}>
          <TouchableOpacity
            style={[s.secondaryBtn, { borderColor: colors.border }]}
            onPress={() => setShowSaveModal(true)}
          >
            <Ionicons name="save-outline" size={16} color={colors.mutedForeground} />
            <Text style={[s.secondaryBtnText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Save Layout</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={enterPlacement}
          >
            <Text style={[s.primaryBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
              Continue →
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  };

  const renderPlacement = () => {
    if (slots.length === 0) return null;
    const slot = active;
    const playerId = slot?.playerId ?? players[0]?.id ?? '';
    const player = players.find(p => p.id === playerId);
    const tint = colorOf(playerId);
    const progress = placementProgress(slots);

    return (
      <ScrollView contentContainerStyle={s.placementScroll} showsVerticalScrollIndicator={false}>
        {/* Whose turn, and what the board is waiting for. */}
        <View style={[s.playerBar, { backgroundColor: colors.card, borderColor: tint, borderLeftColor: tint }]}>
          <View style={[s.playerDot, { backgroundColor: tint }]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.playerName, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
              {player?.displayName ?? 'Player'}
              <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
                {'  '}settlement {slot?.round ?? 1} of 2
              </Text>
            </Text>
            <Text style={[s.playerSub, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              {awaitingRoad
                ? 'Now tap a road leading off it.'
                : 'Tap a corner where three tiles meet.'}
            </Text>
          </View>
        </View>

        {/* Colour, chosen here where the board is actually visible. */}
        <View style={s.swatchRow}>
          {PLAYER_COLORS.map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => {
                haptic();
                setColorOverrides(prev => ({ ...prev, [playerId]: c }));
              }}
              style={[
                s.swatch,
                { backgroundColor: c, borderColor: c === tint ? colors.foreground : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Use this colour for ${player?.displayName ?? 'this player'}`}
            />
          ))}
        </View>

        <CatanHexGrid
          hexes={hexes}
          showIntersections
          legalIntersections={awaitingRoad ? [] : offeredCorners}
          intersectionMarks={settlementMarks}
          onIntersectionPress={onCornerTap}
          showRoads={awaitingRoad}
          legalRoads={offeredRoads}
          roadMarks={roadMarks}
          onRoadPress={onRoadTap}
          style={{ marginVertical: 8 }}
        />

        {placementError && (
          <Text style={[s.placementError, { color: colors.destructive, fontFamily: 'Inter_400Regular' }]}>
            {placementError}
          </Text>
        )}

        {/*
          The turn strip: the whole opening at a glance, and every turn
          reachable. Tapping a slot goes there; the trash clears just that one.
          This is what replaces "walk the whole flow backwards and lose
          everybody else's placements".
        */}
        <View style={[s.stripCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.settlementsLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
            OPENING ORDER · {progress.settlementsPlaced}/{progress.total} placed
          </Text>
          <View style={s.stripRow}>
            {slots.map(sl => {
              const isActive = sl.index === activeSlot;
              const done = Boolean(sl.settlement && sl.road);
              const part = Boolean(sl.settlement) !== Boolean(sl.road);
              return (
                <TouchableOpacity
                  key={sl.index}
                  onPress={() => { haptic(); setActiveSlot(sl.index); setPlacementError(null); }}
                  onLongPress={() => onClearSlot(sl.index)}
                  style={[
                    s.stripChip,
                    {
                      borderColor: isActive ? colors.foreground : colorOf(sl.playerId),
                      backgroundColor: done
                        ? colorOf(sl.playerId)
                        : part ? colorOf(sl.playerId) + '55' : 'transparent',
                      borderWidth: isActive ? 2 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    `${players.find(p => p.id === sl.playerId)?.displayName ?? 'Player'}, `
                    + `settlement ${sl.round} of 2, `
                    + `${done ? 'placed' : part ? 'half placed' : 'not placed'}`}
                  accessibilityHint="Tap to go to this turn, long-press to clear it"
                >
                  <Text style={[s.stripChipText, {
                    color: done ? '#FFFFFF' : colors.foreground,
                    fontFamily: 'Inter_600SemiBold',
                  }]}>
                    {(players.find(p => p.id === sl.playerId)?.displayName ?? '?').slice(0, 2)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[s.stripHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Tap any turn to go back to it · long-press to clear just that one
          </Text>
        </View>

        <TouchableOpacity
          style={[s.doneBtn, {
            backgroundColor: progress.complete && !isSavingGame ? colors.primary : colors.muted,
          }]}
          onPress={() => { if (progress.complete) void handleStartGame(); }}
          disabled={!progress.complete || isSavingGame}
          activeOpacity={0.85}
        >
          <Ionicons name="play" size={20} color={colors.primaryForeground} />
          <Text style={[s.doneBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
            {isSavingGame ? 'Starting…'
              : progress.complete ? 'Start Game'
              : `${progress.total - progress.settlementsPlaced} settlements, `
                + `${progress.total - progress.roadsPlaced} roads to go`}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const renderCorrectionPanel = () => {
    const h = correctionIdx !== null ? hexes[correctionIdx] : null;
    return (
      <View style={[s.correctionOverlay, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <View style={s.correctionHeader}>
          <Text style={[s.correctionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            Correct Hex {correctionIdx !== null ? correctionIdx + 1 : ''}
          </Text>
          <TouchableOpacity onPress={() => setCorrectionIdx(null)} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Resource picker */}
        <Text style={[s.correctionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>RESOURCE</Text>
        <View style={s.correctionResourceRow}>
          {RESOURCES.map(r => (
            <TouchableOpacity
              key={r}
              style={[
                s.resourceBtn,
                {
                  backgroundColor: correctionResource === r ? RESOURCE_COLORS[r] : colors.muted,
                  borderColor: correctionResource === r ? RESOURCE_COLORS[r] : colors.border,
                },
              ]}
              onPress={() => {
                haptic();
                setCorrectionResource(r);
                if (r === 'desert') setCorrectionNumber(null);
              }}
            >
              <Text style={[
                s.resourceBtnText,
                { color: correctionResource === r ? '#FFFFFF' : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' },
              ]}>
                {RESOURCE_LABELS[r]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Number picker (hidden for desert) */}
        {correctionResource !== 'desert' && (
          <>
            <Text style={[s.correctionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>NUMBER TOKEN</Text>
            <View style={s.correctionNumRow}>
              {CATAN_NUMBERS.map(n => (
                <TouchableOpacity
                  key={n}
                  style={[
                    s.numBtn,
                    {
                      backgroundColor: correctionNumber === n ? colors.primary : colors.muted,
                      borderColor: correctionNumber === n ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { haptic(); setCorrectionNumber(n); }}
                >
                  <Text style={[
                    s.numBtnText,
                    {
                      color: correctionNumber === n ? colors.primaryForeground
                        : (n === 6 || n === 8) ? '#CC0000' : colors.foreground,
                      fontFamily: 'Inter_700Bold',
                    },
                  ]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {correctionIncomplete && (
          <Text style={[s.correctionHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            Pick a number token — only the desert goes without one.
          </Text>
        )}

        <TouchableOpacity
          style={[
            s.confirmBtn,
            { backgroundColor: colors.primary, opacity: correctionIncomplete ? 0.4 : 1 },
          ]}
          onPress={confirmCorrection}
          disabled={correctionIncomplete}
        >
          <Text style={[s.confirmBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
            Done
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderSaveModal = () => (
    <View style={[s.modal, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <Text style={[s.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Save Board Layout</Text>
      <TextInput
        style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
        value={layoutName}
        onChangeText={setLayoutName}
        placeholder="Board name (e.g. Tuesday Game)"
        placeholderTextColor={colors.mutedForeground}
        maxLength={40}
        autoFocus
        returnKeyType="done"
      />
      <View style={s.modalActions}>
        <TouchableOpacity style={[s.modalCancel, { borderColor: colors.border }]} onPress={() => setShowSaveModal(false)}>
          <Text style={[s.modalCancelText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modalConfirm, { backgroundColor: isSavingLayout ? colors.muted : colors.primary }]}
          onPress={() => void handleSaveLayout()}
          disabled={isSavingLayout}
        >
          <Text style={[s.modalConfirmText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderLoadModal = () => (
    <View style={[s.modal, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <Text style={[s.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Saved Boards</Text>
      <ScrollView style={{ maxHeight: 280 }}>
        {savedLayouts.map(layout => (
          <View key={layout.id} style={[s.layoutRow, { borderColor: colors.border }]}>
            <TouchableOpacity style={s.layoutRowMain} onPress={() => handleLoadLayout(layout)}>
              <Text style={[s.layoutName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{layout.name}</Text>
              <Text style={[s.layoutDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {formatSavedDate(layout.savedAt)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void handleDeleteLayout(layout.id)} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <TouchableOpacity style={[s.modalCancel, { borderColor: colors.border, marginTop: 12 }]} onPress={() => setShowLoadModal(false)}>
        <Text style={[s.modalCancelText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Close</Text>
      </TouchableOpacity>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Root render
  // ─────────────────────────────────────────────────────────────────────────

  const phaseTitles: Record<ScanPhase, string> = {
    entry: isEditMode ? 'Edit Settlements' : 'Scan Board',
    analyzing: 'Scanning…',
    review: 'Review Board',
    placement: isEditMode
      ? `Edit: ${currentPlayer?.displayName ?? 'Player'}`
      : `Opening — turn ${activeSlot + 1} of ${slots.length || players.length * 2}`,
  };

  const hasModalOpen = correctionIdx !== null || showSaveModal || showLoadModal;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={8}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
          {phaseTitles[phase]}
        </Text>
        {phase !== 'placement' && !isEditMode && (
          <TouchableOpacity onPress={handleSkip} hitSlop={8}>
            <Text style={[s.headerSkip, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Skip</Text>
          </TouchableOpacity>
        )}
        {(phase === 'placement' || isEditMode) && <View style={{ width: 40 }} />}
      </View>

      {/* Phase content */}
      <View style={{ flex: 1 }}>
        {phase === 'entry' && renderEntry()}
        {phase === 'analyzing' && renderAnalyzing()}
        {phase === 'review' && renderReview()}
        {phase === 'placement' && renderPlacement()}
      </View>

      {/* Modals / overlays */}
      {hasModalOpen && (
        <TouchableOpacity
          style={s.modalBackdrop}
          activeOpacity={1}
          onPress={() => {
            setCorrectionIdx(null);
            setShowSaveModal(false);
            setShowLoadModal(false);
          }}
        />
      )}
      {correctionIdx !== null && renderCorrectionPanel()}
      {showSaveModal && renderSaveModal()}
      {showLoadModal && renderLoadModal()}
    </View>
  );
}

// ─── Entry card sub-component ─────────────────────────────────────────────────

function EntryCard({
  icon, title, desc, colors, onPress, accent = false,
}: {
  icon: string;
  title: string;
  desc: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        s.entryCard,
        {
          backgroundColor: colors.card,
          borderColor: accent ? colors.primary : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[s.entryCardIcon, { backgroundColor: accent ? colors.primary + '20' : colors.muted }]}>
        <Ionicons name={icon as any} size={26} color={accent ? colors.primary : colors.mutedForeground} />
      </View>
      <View style={s.entryCardText}>
        <Text style={[s.entryCardTitle, { color: accent ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
          {title}
        </Text>
        <Text style={[s.entryCardDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {desc}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={accent ? colors.primary : colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  headerSkip: { fontSize: 14 },

  // Entry phase
  entryScroll: { padding: 20, gap: 12 },
  entryTitle: { fontSize: 20, marginBottom: 4 },
  entrySub: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  entryCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, borderWidth: 1, gap: 14 },
  entryCardIcon: { width: 52, height: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  entryCardText: { flex: 1, gap: 2 },
  entryCardTitle: { fontSize: 16 },
  entryCardDesc: { fontSize: 13 },
  skipLink: { marginTop: 8, alignItems: 'center' },
  skipLinkText: { fontSize: 13, textDecorationLine: 'underline' },

  // Analyzing phase
  analyzingText: { fontSize: 18, marginTop: 16 },
  analyzingHint: { fontSize: 14, textAlign: 'center', paddingHorizontal: 32 },

  // Review phase
  reviewScroll: { padding: 16, gap: 10 },
  reviewHint: { fontSize: 13, textAlign: 'center' },
  reviewActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  errorBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  hintBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  primaryBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { fontSize: 16 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
  secondaryBtnText: { fontSize: 14 },

  // Placement phase
  swatchRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', paddingVertical: 4 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3 },
  stripCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  stripRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  /** 44 keeps the turn chips at a real finger target; they are also undo. */
  stripChip: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stripChipText: { fontSize: 13 },
  stripHint: { fontSize: 11, textAlign: 'center' },
  placementScroll: { padding: 16, gap: 10, paddingBottom: 40 },
  playerBar: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderLeftWidth: 4 },
  playerDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3, flexShrink: 0 },
  playerName: { fontSize: 16 },
  playerSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  selHint: { fontSize: 13, textAlign: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  addBtnText: { fontSize: 15 },
  settlementsCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  settlementsLabel: { fontSize: 11, letterSpacing: 0.8 },
  settlementRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settlementText: { fontSize: 14, flex: 1 },
  placementError: { fontSize: 13, textAlign: 'center' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 14, marginTop: 4 },
  doneBtnText: { fontSize: 17 },
  detectionBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  detectionBannerText: { fontSize: 13, flex: 1 },

  // Correction panel
  correctionOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, gap: 12, zIndex: 10,
  },
  correctionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  correctionTitle: { fontSize: 17 },
  correctionLabel: { fontSize: 11, letterSpacing: 0.8 },
  correctionResourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  correctionHint: { fontSize: 12, marginTop: 10, textAlign: 'center' },
  resourceBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  resourceBtnText: { fontSize: 13 },
  correctionNumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  numBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numBtnText: { fontSize: 15 },
  confirmBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  confirmBtnText: { fontSize: 16 },

  // Modal shared
  modalBackdrop: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9 },
  modal: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, zIndex: 10,
  },
  modalTitle: { fontSize: 18, marginBottom: 14 },
  modalInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 14 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  modalCancelText: { fontSize: 15 },
  modalConfirm: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalConfirmText: { fontSize: 15 },

  // Layout list
  layoutRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, gap: 12 },
  layoutRowMain: { flex: 1 },
  layoutName: { fontSize: 15 },
  layoutDate: { fontSize: 12, marginTop: 2 },

  // Shared
  body: { fontSize: 15 },
  link: { fontSize: 15, marginTop: 8 },
});
