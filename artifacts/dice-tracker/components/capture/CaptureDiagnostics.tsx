/** The diagnostics box under the corner step. See hooks/useCaptureDiagnostics. */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColors';
import type { ReadingSnapshot } from '@/services/vision/diagnostics';
import type { CatanHexDef } from '@/types/models';

interface Props {
  groundTruth: CatanHexDef[] | null;
  comparison: ReadingSnapshot[] | null;
  onCompare: () => void;
  onExport: () => void;
}

export function CaptureDiagnostics({ groundTruth, comparison, onCompare, onExport }: Props) {
  const colors = useColors();
  return (
    <View style={[styles.diagBox, { borderColor: colors.border }]}>
      <Text style={[styles.diagTitle, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>
        DIAGNOSTICS
      </Text>
      <Text style={[styles.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        {groundTruth
          ? 'Ground truth is set, so reads are scored automatically.'
          : 'No ground truth set. Correct a board on the next screen and tap "Set as ground truth" to get scores.'}
      </Text>

      <View style={styles.rowBtns}>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={onCompare}
        >
          <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Compare corners
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: colors.border }]}
          onPress={onExport}
        >
          <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: 'Inter_500Medium' }]}>
            Export
          </Text>
        </TouchableOpacity>
      </View>

      {comparison?.map(r => (
        <View key={r.label} style={[styles.diagResult, { borderTopColor: colors.border }]}>
          <Text style={[styles.diagLabel, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
            {r.label}
          </Text>
          {!r.usable ? (
            <Text style={[styles.diagHint, { color: '#F59E0B', fontFamily: 'Inter_400Regular' }]}>
              unusable — {r.reason ?? 'no reason given'}
            </Text>
          ) : r.score ? (
            <>
              <Text style={[styles.diagScore, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
                {r.score.correct}/{r.score.total} exact
              </Text>
              <Text style={[styles.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                terrain {r.score.resourceCorrect}/{r.score.total} · tokens{' '}
                {r.score.numberCorrect}/{r.score.total}
              </Text>
              {r.score.mismatches.slice(0, 6).map(m => (
                <Text
                  key={m.index}
                  style={[styles.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
                >
                  tile {m.index + 1}: got {m.gotResource ?? '?'} {m.gotNumber ?? '—'} · want{' '}
                  {m.wantResource ?? '?'} {m.wantNumber ?? '—'} ({m.wrong})
                </Text>
              ))}
              {r.score.mismatches.length > 6 && (
                <Text style={[styles.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                  …and {r.score.mismatches.length - 6} more (full list in Export)
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.diagHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
              read {r.hexes.length} tiles · coverage {(r.coverage * 100).toFixed(0)}%
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  secondaryBtn: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { fontSize: 15 },
  diagBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 14 },
  diagTitle: { fontSize: 11, letterSpacing: 1, marginBottom: 6 },
  diagHint: { fontSize: 12, lineHeight: 17 },
  diagResult: { borderTopWidth: 1, marginTop: 10, paddingTop: 10 },
  diagLabel: { fontSize: 13, marginBottom: 2 },
  diagScore: { fontSize: 20, marginVertical: 2 },
});
