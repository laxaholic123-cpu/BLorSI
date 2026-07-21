import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { DiceMode } from '@/types/models';
import {
  getDiceValues,
  getGridColumns,
  shouldUseKeypad,
} from '@/services/rollInput';
import { NumberButton } from '@/components/NumberButton';
import { useColors } from '@/hooks/useColors';

interface DiceGridProps {
  diceMode: DiceMode;
  customMin?: number;
  customMax?: number;
  onValuePress: (value: number) => void;
  lastPressedValue?: number | null;
  disabled?: boolean;
}

const GAP = 8;

/**
 * Renders a responsive grid of tappable number buttons for the given dice mode.
 *
 * - Standard modes (D4–D20, 2D6): auto-sized button grid, no scrolling needed.
 * - Custom ranges ≤ 20 values: button grid.
 * - Custom ranges > 20 values: numeric text-input keypad.
 *
 * Uses onLayout to calculate button dimensions once the container is measured,
 * so buttons fill the available space optimally on every screen size.
 */
export function DiceGrid({
  diceMode,
  customMin = 1,
  customMax = 6,
  onValuePress,
  lastPressedValue,
  disabled = false,
}: DiceGridProps) {
  const colors = useColors();
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [keypadInput, setKeypadInput] = useState('');

  const useKeypad = shouldUseKeypad(diceMode, customMin, customMax);

  if (useKeypad) {
    const parsed = parseInt(keypadInput, 10);
    const isValid = !isNaN(parsed) && parsed >= customMin && parsed <= customMax;
    return (
      <View style={kpStyles.container}>
        <Text style={[kpStyles.hint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Enter a value between {customMin} and {customMax}
        </Text>
        <TextInput
          style={[
            kpStyles.input,
            {
              backgroundColor: colors.card,
              borderColor: isValid ? colors.primary : colors.border,
              color: colors.foreground,
              fontFamily: 'Inter_700Bold',
            },
          ]}
          value={keypadInput}
          onChangeText={setKeypadInput}
          keyboardType="number-pad"
          placeholder={`${customMin}–${customMax}`}
          placeholderTextColor={colors.mutedForeground}
          maxLength={String(customMax).length + 1}
          editable={!disabled}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (isValid) { onValuePress(parsed); setKeypadInput(''); }
          }}
        />
        <TouchableOpacity
          style={[kpStyles.btn, { backgroundColor: isValid ? colors.primary : colors.muted }]}
          onPress={() => { if (isValid) { onValuePress(parsed); setKeypadInput(''); } }}
          disabled={!isValid || disabled}
        >
          <Text style={[kpStyles.btnText, { color: isValid ? colors.primaryForeground : colors.mutedForeground, fontFamily: 'Inter_700Bold' }]}>
            Record Roll
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const values = getDiceValues(diceMode, customMin, customMax);
  const columns = getGridColumns(diceMode, values.length);
  const rows = Math.ceil(values.length / columns);

  const btnW = containerSize.w > 0
    ? (containerSize.w - GAP * (columns - 1)) / columns
    : 0;
  const btnH = containerSize.h > 0
    ? Math.max(56, (containerSize.h - GAP * (rows - 1)) / rows)
    : 0;

  return (
    <View
      style={[styles.grid, { gap: GAP }]}
      onLayout={e =>
        setContainerSize({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {btnW > 0 && values.map(v => (
        <NumberButton
          key={v}
          value={v}
          width={btnW}
          height={btnH}
          onPress={onValuePress}
          isHighlighted={v === lastPressedValue}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'center',
  },
});

const kpStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  hint: { fontSize: 14 },
  input: {
    width: 160,
    height: 80,
    borderRadius: 16,
    borderWidth: 2,
    fontSize: 40,
    textAlign: 'center',
  },
  btn: { paddingHorizontal: 40, paddingVertical: 16, borderRadius: 14 },
  btnText: { fontSize: 18 },
});
