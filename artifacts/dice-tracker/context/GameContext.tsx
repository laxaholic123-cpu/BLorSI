/**
 * GameContext — manages the active game session in memory and persists it
 * after every meaningful change.
 *
 * Rules:
 * - The active session is restored from storage on mount
 * - Roll events and exposure events are loaded lazily with the session
 * - No session state is mutated directly: callers receive update functions
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CatanPlayerExposureEvent, GameSession, RollEvent } from '@/types/models';
import {
  getActiveSessionId,
  loadExposureEvents,
  loadRollEvents,
  loadSession,
  saveExposureEvents,
  saveRollEvents,
  saveSession,
  setActiveSessionId,
} from '@/services/storage';

interface GameContextValue {
  activeSession: GameSession | null;
  rollEvents: RollEvent[];
  exposureEvents: CatanPlayerExposureEvent[];
  isLoading: boolean;
  /** Re-load the active session from storage (e.g. after an app resume) */
  loadActiveGame: () => Promise<void>;
  /** Begin a new session: saves to storage and sets as active */
  startSession: (session: GameSession) => Promise<void>;
  /** Persist a modified session (e.g. after player advance or status change) */
  updateSession: (session: GameSession) => Promise<void>;
  /** Clear the active session from context and storage */
  endSession: () => Promise<void>;
  /** Replace roll events in context only (call persistRollEvents to save) */
  setRollEvents: (events: RollEvent[]) => void;
  /** Replace roll events in context and persist to storage */
  persistRollEvents: (sessionId: string, events: RollEvent[]) => Promise<void>;
  /** Replace exposure events in context only */
  setExposureEvents: (events: CatanPlayerExposureEvent[]) => void;
  /** Replace exposure events in context and persist to storage */
  persistExposureEvents: (sessionId: string, events: CatanPlayerExposureEvent[]) => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [rollEvents, setRollEvents] = useState<RollEvent[]>([]);
  const [exposureEvents, setExposureEvents] = useState<CatanPlayerExposureEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadActiveGame = useCallback(async () => {
    setIsLoading(true);
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        setActiveSession(null);
        return;
      }
      const session = await loadSession(sessionId);
      if (session && session.status === 'active') {
        setActiveSession(session);
        const rolls = await loadRollEvents(sessionId);
        setRollEvents(rolls);
        if (session.gameType === 'catan') {
          const exposures = await loadExposureEvents(sessionId);
          setExposureEvents(exposures);
        }
      } else {
        // Stale active session ID — clear it
        await setActiveSessionId(null);
        setActiveSession(null);
      }
    } catch {
      setActiveSession(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActiveGame();
  }, [loadActiveGame]);

  const startSession = useCallback(async (session: GameSession) => {
    setActiveSession(session);
    setRollEvents([]);
    setExposureEvents([]);
    await saveSession(session);
    await setActiveSessionId(session.id);
  }, []);

  const updateSession = useCallback(async (session: GameSession) => {
    setActiveSession(session);
    await saveSession(session);
  }, []);

  const endSession = useCallback(async () => {
    setActiveSession(null);
    setRollEvents([]);
    setExposureEvents([]);
    await setActiveSessionId(null);
  }, []);

  const persistRollEvents = useCallback(async (sessionId: string, events: RollEvent[]) => {
    setRollEvents(events);
    await saveRollEvents(sessionId, events);
  }, []);

  const persistExposureEvents = useCallback(
    async (sessionId: string, events: CatanPlayerExposureEvent[]) => {
      setExposureEvents(events);
      await saveExposureEvents(sessionId, events);
    },
    [],
  );

  return (
    <GameContext.Provider
      value={{
        activeSession,
        rollEvents,
        exposureEvents,
        isLoading,
        loadActiveGame,
        startSession,
        updateSession,
        endSession,
        setRollEvents,
        persistRollEvents,
        setExposureEvents,
        persistExposureEvents,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}
