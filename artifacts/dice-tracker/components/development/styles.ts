/** Styles for the build menu (app/catan-development.tsx). */

import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 18 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  scroll: { padding: 16, gap: 10 },
  chosenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 2 },
  chosenTitle: { fontSize: 17, flex: 1 },
  changeLink: { fontSize: 13 },
  sectionLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 4 },

  actionCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  actionCardContent: { flex: 1, gap: 2 },
  actionCardTitle: { fontSize: 15 },
  actionCardDesc: { fontSize: 12, lineHeight: 17 },

  actionForm: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 14, marginTop: 4 },

  subsection: { gap: 8 },
  subLabel: { fontSize: 10, letterSpacing: 1 },

  playerBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  playerDot: { width: 10, height: 10, borderRadius: 5 },
  playerBtnText: { flex: 1, fontSize: 15 },

  numGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  numBtn: { width: 52, height: 52, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numBtnValue: { fontSize: 16 },
  numBtnPips: { fontSize: 8, letterSpacing: 0.5 },

  buildingBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  buildingBtnContent: { flex: 1 },
  buildingBtnTitle: { fontSize: 14 },
  buildingBtnSub: { fontSize: 12 },

  emptyText: { fontSize: 13, fontStyle: 'italic', paddingVertical: 4 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  submitBtn: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  submitBtnText: { fontSize: 16 },
});
