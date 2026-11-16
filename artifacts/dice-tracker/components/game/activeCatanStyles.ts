/** Styles for the Catan game screen (app/active-catan.tsx). */

import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  noSessionText: { fontSize: 16 },
  goHomeBtn: { paddingHorizontal: 28, paddingVertical: 13, borderRadius: 12 },
  goHomeBtnText: { fontSize: 16 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, gap: 10 },
  headerLeft: { flex: 1, gap: 1 },
  headerGame: { fontSize: 16 },
  headerMode: { fontSize: 12 },
  endBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  endBtnText: { fontSize: 14 },

  playerBanner: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderLeftWidth: 4, marginHorizontal: 12, marginTop: 10, borderRadius: 10, gap: 12 },
  playerBannerLeft: { flex: 1 },
  playerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontSize: 20 },
  editIcon: { marginTop: 2 },
  playerNameInput: { fontSize: 20, borderBottomWidth: 1.5, paddingVertical: 2 },
  playerSub: { fontSize: 13, marginTop: 2 },
  playerDots: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  playerDot: {},
  rollHistory: { flexDirection: 'row', gap: 5, marginTop: 6, flexWrap: 'wrap' },
  rollPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  rollPillText: { fontSize: 13 },

  lastRollRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 12 },
  lastRollCard: { width: 100, height: 90, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  lastRollValue: { fontSize: 46 },
  statsColumn: { flex: 1, flexDirection: 'row', gap: 16 },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22 },
  statLabel: { fontSize: 12 },

  // The scrollable top content area — holds header, player banner, stats, dashboard.
  // This takes the remaining vertical space above the fixed dice pad.
  topScroll: { flex: 1 },
  topScrollContent: { paddingBottom: 8 },
  // The dice pad is OUTSIDE the scroll view so it is always visible and reachable.
  /**
   * Never shrinks. The ScrollView above it has flex:1 and will give way; the
   * roll pad is the one thing on this screen that must always be fully
   * reachable, since the whole screen exists to record a roll.
   */
  gridWrapper: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, gap: 10, flexShrink: 0 },

  sevenBtn: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  sevenBtnNumber: { fontSize: 28 },
  sevenBtnLabel: { fontSize: 14, letterSpacing: 1.5 },

  /**
   * No flex:1. It used to have it, inside a wrapper that deliberately has none
   * — so the grid was told to fill a parent that was sizing itself to the
   * grid. The ten buttons wrap onto two rows; that circularity collapsed it to
   * one, and the build-pill row below drew over the remainder. Reported from a
   * device as "most of the numbers cannot be tapped".
   */
  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },

  boardToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 9,
  },
  boardToggleText: { fontSize: 12 },

  /**
   * One line, fixed height. This sits between the scroll area and the roll pad,
   * so anything that can wrap to two lines eats the pad's space.
   */
  /**
   * Reported as "very small and blandly colored, almost did not notice it".
   * Now a solid amber bar with dark text — the only saturated block on a dark
   * screen. Height is capped rather than free, because this sits between the
   * scroll area and the roll pad and anything that can grow eats the pad.
   */
  callout: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 48,
    marginHorizontal: 12, marginBottom: 8,
  },
  calloutText: { flex: 1, fontSize: 14, lineHeight: 18 },
  numBtn: { width: '18%', aspectRatio: 1, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 },
  numBtnValue: { fontSize: 20 },
  numBtnPips: { fontSize: 9, letterSpacing: 1 },
  padLegend: { fontSize: 10, textAlign: 'center', marginBottom: 4 },

  controls: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 8, paddingBottom: 4 },
  controlBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 3 },
  controlBtnText: { fontSize: 11 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  endConfirmSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, gap: 16 },
  robberSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, gap: 16, maxHeight: '70%' },
  robberHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#555', alignSelf: 'center', marginBottom: 4 },
  robberTitle: { fontSize: 20, textAlign: 'center' },
  robberSub: { fontSize: 14, textAlign: 'center' },
  // Build row
  buildRow: { borderTopWidth: 1, borderBottomWidth: 1, flexGrow: 0, flexShrink: 0 },
  buildRowContent: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center' },
  buildPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  buildPillText: { fontSize: 13 },

  // Robber hex grid
  robberHexGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  robberHexBtn: { width: 52, height: 52, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  robberHexBtnText: { fontSize: 16 },
  robberHexBtnPips: { fontSize: 8, letterSpacing: 0.5 },

  dontAskRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dontAskText: { fontSize: 13 },
  robberActions: { flexDirection: 'row', gap: 12 },
  robberActionBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  robberActionText: { fontSize: 16 },

  // Edit settlements player picker
  playerPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1 },
  playerPickerDot: { width: 14, height: 14, borderRadius: 7, flexShrink: 0 },
  playerPickerName: { flex: 1, fontSize: 16 },
});
