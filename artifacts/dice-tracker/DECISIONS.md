# Technical Decisions — Skill Check

A record of non-obvious decisions made during development. Future contributors should consult this before changing major architectural choices.

---

## D1 · AsyncStorage over expo-sqlite (Phase 1)

**Decision:** Use `@react-native-async-storage/async-storage` with JSON serialization.

**Why:**
- Simple JSON persistence, no native build step of its own
  (SUPERSEDED IN PART: the app now requires a development build regardless — see D-LATE below)
- Tabletop game sessions are small data sets (hundreds of events max); SQL query performance is not a concern
- JSON serialization maps naturally to the event-log data model
- Simpler migration path: schema version + spread merge

**Trade-offs:**
- No structured queries across sessions (mitigated: history is a full scan; this is acceptable at this scale)
- No transactions (mitigated: all write failures are non-fatal; session integrity is maintained by writing session index separately from event arrays)

**Revisit when:** sessions routinely exceed 10,000 events or cross-session aggregate queries become necessary.

---

## D2 · Immutable roll events (all phases)

**Decision:** Roll events are never overwritten. Undo marks `deletedAt`. Correction creates a new event with `correctionOfEventId` pointing to the original.

**Why:**
- Preserves a complete audit trail for all statistical outputs
- Allows replaying the session from any point in time
- Enables future cloud sync with clean conflict resolution (no update-in-place race conditions)
- Required by spec

**How to apply:** Never call `AsyncStorage.setItem` with a modified roll event. Always create new events.

---

## D3 · Single RollInputService (Phase 2)

**Decision:** All roll entry paths — touchscreen, future Bluetooth, imported history, corrections — flow through one `RollInputService.recordRoll()` function.

**Why:**
- Keeps active-game screens clean; they never touch statistics or storage directly
- The service is the canonical integration point for future Bluetooth input
- Required by spec (principle #8: all inputs must use the same input-neutral event service)

---

## D4 · Statistics as pure functions (Phase 3)

**Decision:** All statistical calculations live in `services/stats.ts` as exported pure functions with no side effects.

**Why:**
- Pure functions are trivially unit-testable
- Any screen can call them without threading concerns
- The verdict copy layer (`services/verdict.ts`) consumes function output without coupling to math

**How to apply:** Never import from `context/` inside `services/stats.ts`. Pass events as function arguments.

---

## D5 · No backend in Phase 1–6

**Decision:** The app is fully local for the initial build. No Express server, no database, no cloud functions.

**Why:**
- Matches product spec requirements exactly
- Simplifies deployment (no server to maintain)
- AsyncStorage is sufficient for structured per-device session data

**Revisit when:** the user explicitly requests cloud sync, friend groups, or social sharing.

---

## D6 · UUID generation without native crypto (all phases)

**Decision:** Use `Date.now().toString(36) + Math.random().toString(36).substring(2, 11)`.

**Why:**
- `uuid` package uses `crypto.getRandomValues()` which crashes on iOS/Android in some Expo Go versions
- `expo-crypto` v55+ has known Expo Go crashes (pinned to 15.0.x)
- The collision probability for session-scoped IDs is negligible at tabletop game scale

---

## D7 · Dark-only theme (Phase 1)

**Decision:** Both `light` and `dark` keys in `constants/colors.ts` use the same dark charcoal + teal palette. The app does not adapt to the system light/dark preference.

**Why:**
- The product brief specifies "dark charcoal or graphite surfaces" as the visual identity
- A consistent dark theme avoids glare at the game table
- `ThemePreference` setting is wired and ready for a future light/system option

**Revisit when:** a light theme is explicitly requested.

---

## D8 · pnpm workspace (monorepo) (Phase 1)

**Decision:** The Expo app lives in `artifacts/dice-tracker/` inside a pnpm workspace monorepo.

**Why:**
- Matches the existing project structure
- Shared `lib/api-spec`, `lib/db`, `lib/api-client-react` packages are available for future backend integration
- TypeScript project references are already configured

**How to apply:** Add new packages as workspace packages under `artifacts/` or `lib/`. Do not create a standalone Expo project outside the workspace.

---

## D9 · WAV files over MP3/OGG for sound assets (Phase 6)

**Decision:** Audio assets are 22 kHz mono 16-bit PCM WAV files generated at build time from a Node.js script.

**Why:**
- WAV is universally supported on iOS and Android via expo-audio without transcoding
- No codec licensing concerns
- Files are small (2–8 KB) at 22 kHz and short duration (55–180 ms)
- Generated programmatically so they can be reproduced or customized without external tools

**Trade-offs:**
- Slightly larger than MP3 at equivalent duration (negligible at this size)

---

## D10 · Sound service caches Audio.Sound instances (Phase 6)

**Decision:** `services/sound.ts` keeps a module-level `soundCache` map and reuses loaded `Audio.Sound` objects, rewinding them with `setPositionAsync(0)` before each play.

**Why:**
- `Audio.Sound.createAsync()` is async and adds latency; re-creating on every roll would feel sluggish
- Rewinding is synchronous-equivalent and ensures rapid taps don't queue sounds
- Cached instances are garbage-collected when the module is unloaded (on app exit)

---

## D11 · react-native-view-shot for share card image capture (Phase 5)

**Decision:** Use `captureRef()` from `react-native-view-shot` to snapshot card Views as images for sharing.

**Why:**
- Only library that can capture a rendered RN View as a file URI compatible with expo-sharing
- Works on both iOS and Android with no native configuration
- Web fallback: text-only sharing via `Share.share()` (captureRef is not available in the browser)

**How to apply:** Always wrap image-capture calls in `Platform.OS !== 'web'` guards.
