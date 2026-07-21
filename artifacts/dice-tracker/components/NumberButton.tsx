import React, { useCallback, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSettings } from '@/context/SettingsContext';

interface NumberButtonProps {
  value: number;
  onPress: (value: number) => void;
  width: number;
  height: number;
  isHighlighted?: boolean;
  disabled?: boolean;
}

/**
 * A large tappable button showing a dice result value.
 * Animates a brief scale-down on press for tactile feedback.
 * Respects the reducedMotion accessibility setting.
 */
export function NumberButton({
  value,
  onPress,
  width,
  height,
  isHighlighted = false,
  disabled = false,
}: NumberButtonProps) {
  const colors = useColors();
  const { settings } = useSettings();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    if (settings.reducedMotion) {
      // Skip animation entirely for users who prefer reduced motion
      onPress(value);
      return;
    }
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.87, duration: 65, useNativeDriver: true }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 350,
        useNativeDriver: true,
      }),
    ]).start();
    onPress(value);
  }, [onPress, scale, settings.reducedMotion, value]);

  // Scale font size with button height for readability
  const fontSize = Math.min(44, Math.max(18, Math.round(height * 0.38)));
  const borderRadius = Math.min(18, Math.round(height * 0.18));

  return (
    <Animated.View style={{ width, height, transform: [{ scale }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          {
            borderRadius,
            backgroundColor: isHighlighted ? colors.primary : colors.card,
            borderColor: isHighlighted ? colors.primary : colors.border,
          },
        ]}
        onPress={handlePress}
        disabled={disabled}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Roll ${value}`}
        accessibilityHint="Records this as your roll"
        accessibilityState={{ disabled }}
      >
        <Text
          style={[
            styles.label,
            {
              fontSize,
              color: isHighlighted ? colors.primaryForeground : colors.foreground,
              fontFamily: 'Inter_700Bold',
            },
          ]}
          accessible={false}
        >
          {value}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
