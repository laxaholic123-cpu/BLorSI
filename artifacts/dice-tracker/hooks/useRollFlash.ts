import { useCallback, useEffect, useState } from 'react';

/**
 * Transient highlight for the number pad.
 *
 * The dice grid briefly highlights the value just tapped, to confirm the roll
 * registered. That highlight used to be cleared only when the active player
 * changed — so in a single-player game, or with auto-advance switched off, the
 * player index never changes and the highlight stayed lit indefinitely. On the
 * next turn it read as a number that was already selected rather than as a
 * record of the last roll, which is confusing when the whole screen is an input.
 *
 * Making it time out removes the ambiguity in every mode: it is a flash, not a
 * selection, and nothing about the app's state depends on it.
 *
 * The sequence counter matters — rolling the same number twice in a row must
 * restart the timer, and setting state to an identical value would not
 * re-trigger the effect on its own.
 */
export function useRollFlash(durationMs = 900): {
  value: number | null;
  flash: (value: number) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ value: number; seq: number } | null>(null);

  const flash = useCallback((value: number) => {
    setState(prev => ({ value, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const clear = useCallback(() => setState(null), []);

  const seq = state?.seq;
  useEffect(() => {
    if (seq === undefined) return;
    const timer = setTimeout(() => setState(null), durationMs);
    return () => clearTimeout(timer);
  }, [seq, durationMs]);

  return { value: state?.value ?? null, flash, clear };
}
