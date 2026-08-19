/**
 * Sound service — optional audio feedback for roll events and game actions.
 *
 * All playback is gated on the caller's `enabled` boolean (derived from
 * AppSettings.soundEnabled). Failures are always silent — a missing audio file
 * or a playback error must never interrupt game flow.
 *
 * Audio assets live in assets/sounds/:
 *   roll.wav  — short high beep played on every roll
 *   undo.wav  — lower tone played when a roll is undone
 *   done.wav  — completion chord played when a game ends
 *
 * Migrated from expo-av, which is deprecated in SDK 54 and would have blocked
 * the SDK 55 upgrade. expo-audio's player is synchronous to create and control,
 * so the old async cache-and-await dance is gone: players are built once at
 * module load and simply seeked and played.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

type SoundKey = 'roll' | 'undo' | 'done';

const ASSETS: Record<SoundKey, number> = {
  roll: require('../assets/sounds/roll.wav'),
  undo: require('../assets/sounds/undo.wav'),
  done: require('../assets/sounds/done.wav'),
};

/**
 * One player per sound, created lazily and kept for the life of the app.
 *
 * Three short WAVs is a trivial amount of memory, and reusing the player is
 * what makes rapid taps feel instant — recreating it per roll would add audible
 * latency to the most frequent interaction in the app.
 */
const players: Partial<Record<SoundKey, AudioPlayer>> = {};

/** iOS silences audio when the hardware switch is on unless told otherwise. */
let audioModeConfigured = false;

function configureAudioMode(): void {
  if (audioModeConfigured) return;
  audioModeConfigured = true;
  void setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
    // Non-fatal — worst case the sound is muted on a silenced iPhone.
  });
}

function getPlayer(key: SoundKey): AudioPlayer | null {
  const existing = players[key];
  if (existing) return existing;
  try {
    const player = createAudioPlayer(ASSETS[key]);
    players[key] = player;
    return player;
  } catch {
    return null;
  }
}

function play(key: SoundKey, enabled: boolean): void {
  if (!enabled) return;
  try {
    configureAudioMode();
    const player = getPlayer(key);
    if (!player) return;
    // Rewind first so rapid taps retrigger rather than being ignored while the
    // previous playback is still running.
    player.seekTo(0);
    player.play();
  } catch {
    // Non-fatal — audio should never block game flow.
  }
}

/** Fire-and-forget helpers — callers pass `settings.soundEnabled` directly. */
export const playRollSound = (enabled: boolean): void => play('roll', enabled);
export const playUndoSound = (enabled: boolean): void => play('undo', enabled);
export const playDoneSound = (enabled: boolean): void => play('done', enabled);

/** Release the native players. Only needed by tests and teardown. */
export function releaseSounds(): void {
  for (const key of Object.keys(players) as SoundKey[]) {
    try {
      players[key]?.remove();
    } catch {
      // Already released, or never created.
    }
    delete players[key];
  }
  audioModeConfigured = false;
}
