# Technical Decisions — BAD LUCK OR SKILL ISSUE?

A record of non-obvious decisions made during development. Future contributors should consult this before changing major architectural choices.

---

## D1 · AsyncStorage over expo-sqlite (Phase 1)

**Decision:** Use `@react-native-async-storage/async-storage` with JSON serialization.

**Why:**
- Works in Expo Go without a native build — critical for fast iteration
- Tabletop game sessions are small data sets (hundreds of events max); SQL query performance is not a concern
- JSON serialization maps naturally to the event-log data model
- Simpler migration path for Phase 1: schema version + spread merge

**Trade-offs:**
- No structured queries across sessions (mitigated: Phase 1 history is a full scan)
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
- Keeps the active game screen clean; it never touches statistics or storage directly
- The service is the canonical integration point for Phase 2's Bluetooth input design
- Required by spec (principle #8: all inputs must use the same input-neutral event service)

---

## D4 · Statistics as pure functions (Phase 3)

**Decision:** All statistical calculations live in `services/stats.ts` as exported pure functions with no side effects.

**Why:**
- Pure functions are trivially unit-testable
- Any screen can call them without threading concerns
- The verdict copy layer (`services/verdicts.ts`) consumes function output without coupling to math

**How to apply:** Never import from `context/` inside `services/stats.ts`. Pass events as function arguments.

---

## D5 · No backend in Phase 1–6

**Decision:** The app is fully local for the initial build. No Express server, no database, no cloud functions.

**Why:**
- Matches product spec requirements exactly
- Simplifies deployment (Expo Go-compatible, no server to maintain)
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

**Decision:** Both `light` and `dark` keys in `constants/colors.ts` use the same dark charcoal + amber palette. The app does not adapt to the system light/dark preference.

**Why:**
- The product brief specifies "dark charcoal or graphite surfaces" as the visual identity
- A consistent dark theme avoids glare at the game table
- ThemePreference setting is wired for future light/system options (Phase 6)

---

## D8 · pnpm workspace (monorepo)

**Decision:** The Expo app lives in `artifacts/dice-tracker/` inside a pnpm workspace monorepo.

**Why:**
- Matches the existing project structure
- Shared `lib/api-spec`, `lib/db`, `lib/api-client-react` packages are available for future backend integration
- TypeScript project references are already configured

**How to apply:** Add new packages as workspace packages under `artifacts/` or `lib/`. Do not create a standalone Expo project outside the workspace.
