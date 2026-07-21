/**
 * SettingsContext — loads AppSettings from storage and exposes an update
 * function that persists changes immediately.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppSettings } from '@/types/models';
import { DEFAULT_SETTINGS } from '@/types/models';
import { loadSettings, saveSettings } from '@/services/storage';

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>({ ...DEFAULT_SETTINGS });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setIsLoading(false);
    });
  }, []);

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>) => {
      const next: AppSettings = { ...settings, ...updates };
      setSettings(next);
      await saveSettings(next);
    },
    [settings],
  );

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
