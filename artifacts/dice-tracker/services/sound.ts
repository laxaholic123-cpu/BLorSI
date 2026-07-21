/**
 * Sound service — optional audio feedback for roll events and game actions.
 *
 * All playback is gated on the caller's `enabled` boolean (derived from
 * AppSettings.soundEnabled). Failures are always silent — a missing audio
 * file or an expo-av error must never interrupt game flow.
 *
 * Audio assets live in assets/sounds/:
 *   roll.wav  — short high beep played on every roll
 *   undo.wav  — lower tone played when a roll is undone
 *   done.wav  — completion chord played when a game ends
 */

import { Audio } from 'expo-av';

type SoundKey = 'roll' | 'undo' | 'done';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ASSETS: Record<SoundKey, number> = {
  roll: require('../assets/sounds/roll.wav'),
  undo: require('../assets/sounds/undo.wav'),
  done: require('../assets/sounds/done.wav'),
};

/** Simple LRU-style cache so we don't reload the same asset on each play. */
const soundCache: Partial<Record<SoundKey, Audio.Sound>> = {};

async function play(key: SoundKey, enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    // Allow playback even when the iOS silent-mode switch is on
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    let snd = soundCache[key];
    if (!snd) {
      const { sound } = await Audio.Sound.createAsync(ASSETS[key]);
      soundCache[key] = sound;
      snd = sound;
    }
    // Rewind to the start so rapid taps don't queue up
    await snd.setPositionAsync(0);
    await snd.playAsync();
  } catch {
    // Non-fatal — audio should never block game flow
  }
}

/** Fire-and-forget helpers — callers pass `settings.soundEnabled` directly. */
export const playRollSound = (enabled: boolean): void => { void play('roll', enabled); };
export const playUndoSound = (enabled: boolean): void => { void play('undo', enabled); };
export const playDoneSound = (enabled: boolean): void => { void play('done', enabled); };
