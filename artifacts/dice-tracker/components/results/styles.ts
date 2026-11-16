/** Styles for the results screen and its sections (app/results.tsx). */

import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16, flex: 1 },
  bodyText: { fontSize: 16 },

  scroll: { paddingHorizontal: 16 },
  verdictPlayers: { marginTop: 12, gap: 6 },
  verdictPlayerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verdictPlayerDot: { width: 10, height: 10, borderRadius: 5 },
  verdictPlayerName: { fontSize: 14, maxWidth: '45%' },
  verdictPlayerBand: { fontSize: 13 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },

  // Winner banner
  winnerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  winnerBannerText: { flex: 1, gap: 2 },
  winnerBannerName: { fontSize: 22 },
  winnerBannerSub: { fontSize: 13 },

  noWinnerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  noWinnerTitle: { fontSize: 20, flex: 1 },

  // Chips
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 12 },

  // Verdict
  /** Left-edged in the player's colour, so the table is scannable by colour. */
  accoladeCard: { borderWidth: 1, borderLeftWidth: 4, borderRadius: 10, padding: 12, gap: 3 },
  accoladeHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accoladeDot: { width: 8, height: 8, borderRadius: 4 },
  accoladeName: { fontSize: 11, letterSpacing: 0.8, flex: 1 },
  accoladeRank: { fontSize: 11 },
  accoladeTitle: { fontSize: 17 },
  accoladeDetail: { fontSize: 13, lineHeight: 18 },
  verdictCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 8, marginBottom: 4 },
  verdictHeadline: { fontSize: 18 },
  verdictBody: { fontSize: 14, lineHeight: 22 },
  accoladeBreakdown: { marginTop: 6, gap: 1 },
  questionBlock: { gap: 2, paddingBottom: 8 },
  questionText: { fontSize: 12 },
  answerText: { fontSize: 14, lineHeight: 20 },
  exposureRes: { fontSize: 12, width: 58, textTransform: 'capitalize' },
  exposureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  exposureNum: { fontSize: 15, width: 26 },
  exposureWeight: { fontSize: 11, flex: 1 },
  exposureCount: { fontSize: 12, width: 78, textAlign: 'right' },
  verdictNote: { fontSize: 11, opacity: 0.7, marginTop: 4 },

  // Card
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 4 },
  playerCard: { marginBottom: 10, borderLeftWidth: 4 },

  // Stat boxes
  statRow: { flexDirection: 'row', paddingVertical: 14 },
  statBox: { flex: 1, alignItems: 'center', gap: 3 },
  statBoxValue: { fontSize: 20 },
  statBoxLabel: { fontSize: 11 },

  // Distribution legend
  chartLegend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    marginBottom: 0,
    paddingHorizontal: 4,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 12 },

  // Frequency table
  freqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  freqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  freqText: { fontSize: 13 },
  colHdr: { fontSize: 10, letterSpacing: 0.8 },
  freqColVal: { width: 32 },
  freqColBar: { flex: 1, marginHorizontal: 8 },
  freqColNum: { width: 44, textAlign: 'right' },
  freqColDev: { width: 46, textAlign: 'right' },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  // Player summaries
  playerHeading: { fontSize: 15, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  playerNote: { fontSize: 12, paddingHorizontal: 16, paddingBottom: 10, lineHeight: 18 },

  // Events
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  eventText: { flex: 1, fontSize: 14, lineHeight: 20 },

  // Winner picker
  winnerHeader: { alignItems: 'center', gap: 8, paddingTop: 40, paddingBottom: 24, paddingHorizontal: 24 },
  winnerTitle: { fontSize: 28 },
  winnerSub: { fontSize: 14, textAlign: 'center' },
  winnerList: { paddingHorizontal: 20, gap: 10, paddingBottom: 20 },
  winnerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  playerDot: { width: 14, height: 14, borderRadius: 7 },
  winnerCardName: { flex: 1, fontSize: 16 },
  winnerFooter: { padding: 20, borderTopWidth: 1 },

  // Done button
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 14,
  },
  doneBtnText: { fontSize: 17 },

  // Footer action row (Share + Done)
  footerRow: { flexDirection: 'row', gap: 10 },
  footerShareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
  },
  footerShareBtnText: { fontSize: 16 },
  footerDoneBtn: { flex: 1 },

  // Inline share preview card (below verdict)
  sharePreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 12,
  },
  sharePreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sharePreviewText: { flex: 1, gap: 2 },
  sharePreviewLabel: { fontSize: 14 },
  sharePreviewDesc: { fontSize: 12 },
  sharePreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  sharePreviewBtnText: { fontSize: 13 },
});
