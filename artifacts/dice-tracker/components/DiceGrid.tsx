import React, { useState } from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import type { DiceMode } from '@/types/models';
import {
  getDiceValues,
  getGridColumns,
} from '@/services/rollInput';
import { NumberButton } from '@/components/NumberButton';
import { useColors } from '@/hooks/useColors';

interface DiceGridProps {
  diceMode: DiceMode;
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
  onValuePress,
  lastPressedValue,
  disabled = false,
}: DiceGridProps) {
  const colors = useColors();
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const values = getDiceValues(diceMode);
  const columns = getGridColumns(diceMode);
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

