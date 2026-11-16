/** Styles for the board review screen and its panels (app/catan-board-scan.tsx). */

import { StyleSheet } from 'react-native';

export const s = StyleSheet.create({
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
  stripRoundLabel: { fontSize: 10, letterSpacing: 0.5 },
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
