import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GameProvider } from '@/context/GameContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { ensureSchemaVersion } from '@/services/storage';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Main tab navigator */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* New Game — presented as a modal sliding up from below */}
      <Stack.Screen
        name="new-game"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      {/* Active Game — no swipe-to-dismiss so users can't leave mid-game */}
      <Stack.Screen
        name="active-game"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      {/* Results after a completed session */}
      <Stack.Screen name="results" options={{ headerShown: false }} />
      {/* Live statistics — accessible as a modal from the active game */}
      <Stack.Screen
        name="stats"
        options={{ headerShown: false, presentation: 'modal' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // Preload Ionicons so icon glyphs render on web (native bundles it automatically)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  });

  useEffect(() => {
    // Run schema migration on every launch (no-op when schema is current)
    void ensureSchemaVersion();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <SettingsProvider>
                <GameProvider>
                  <RootLayoutNav />
                </GameProvider>
              </SettingsProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
