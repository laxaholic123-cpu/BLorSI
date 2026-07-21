import { Stack } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function NewGameLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { fontFamily: 'Inter_600SemiBold', color: colors.foreground },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {/* index screen manages its own header */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="quick-game" options={{ headerShown: false }} />
      <Stack.Screen name="general" options={{ title: 'General Dice Game' }} />
      <Stack.Screen name="catan" options={{ title: 'Settlement Mode' }} />
      <Stack.Screen name="custom" options={{ title: 'Custom Game' }} />
    </Stack>
  );
}
