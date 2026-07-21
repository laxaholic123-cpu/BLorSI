# Skill Check

> Track every roll. Settle every excuse.

A polished, fully-offline mobile dice tracker for physical tabletop games. Records rolls as immutable events, calculates fair statistics, and generates humorous end-of-game verdicts — so you can finally settle the table debate.

## Features

- **Fast roll entry** — large tappable number buttons, one tap per roll, optional sound and haptic feedback
- **Player tracking** — up to 8 players with auto-advance, inline name editing, color coding
- **Accurate statistics** — frequency, expected vs. actual, streaks, droughts, player comparisons
- **Catan-Compatible Mode** — weighted number exposure, robber tracking, production analysis per player
- **Shareable results** — verdict cards (Verdict, Game Summary, Player Accolade, Rivalry, Catan Production), image export, text sharing
- **Game history** — full session list with filter tabs, session detail view, duplicate-setup shortcut
- **Settings** — haptics, sound, reduced motion, game defaults, export/import/clear data
- **Accessibility** — screen-reader labels, minimum 44pt touch targets, high-contrast dark theme, no information conveyed by color alone

## Tech Stack

- [Expo](https://expo.dev/) SDK 54
- [React Native](https://reactnative.dev/) 0.81
- [TypeScript](https://www.typescriptlang.org/) strict mode
- [Expo Router](https://expo.github.io/router/) file-based routing
- [AsyncStorage](https://react-native-async-storage.github.io/async-storage/) local persistence
- [expo-av](https://docs.expo.dev/versions/latest/sdk/av/) optional sound feedback
- [expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/) tactile feedback
- [react-native-view-shot](https://github.com/gre/react-native-view-shot) share-card image capture
- [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/) native share sheet
- [expo-media-library](https://docs.expo.dev/versions/latest/sdk/media-library/) save to Photos
- pnpm workspace monorepo

## Prerequisites

- Node.js 20+
- pnpm 9+
- Expo Go app on your device (for Expo Go testing without a build)

## Installation

```bash
# Clone the repo
git clone https://github.com/laxaholic123-cpu/BLorSI.git
cd BLorSI

# Install all workspace dependencies
pnpm install

# Start the Expo dev server
pnpm --filter @workspace/dice-tracker run dev
```

## Testing on a Device (Expo Go)

1. Install [Expo Go](https://expo.dev/go) on your iOS or Android device
2. Run `pnpm --filter @workspace/dice-tracker run dev`
3. Scan the QR code that appears in the terminal with your camera (iOS) or Expo Go (Android)

## Testing on Android Emulator

1. Install [Android Studio](https://developer.android.com/studio)
2. Create and launch an AVD (Android Virtual Device)
3. Run `pnpm --filter @workspace/dice-tracker run dev`
4. Press `a` in the terminal to open on the emulator

## Project Structure

```
artifacts/dice-tracker/
├── app/                         # Expo Router screens
│   ├── _layout.tsx              # Root layout, providers, error boundary
│   ├── (tabs)/                  # Tab navigation (Home, History, Settings)
│   ├── new-game/                # Game setup flow (modal stack)
│   │   ├── index.tsx            # Game type picker
│   │   ├── general.tsx          # General dice setup
│   │   ├── catan.tsx            # Catan-Compatible setup (exposure → active-catan)
│   │   └── quick-game.tsx       # Quick-launch shortcut
│   ├── active-game.tsx          # Live dice-entry screen (general)
│   ├── active-catan.tsx         # Live dice-entry screen (Catan)
│   ├── catan-exposure-quick.tsx # Quick exposure setup
│   ├── catan-exposure-detailed.tsx # Detailed exposure setup
│   ├── catan-development.tsx    # In-game building actions modal
│   ├── results.tsx              # Post-game results and verdict
│   ├── stats.tsx                # Live stats modal (in-game)
│   ├── session-detail.tsx       # Historical session detail
│   ├── share-card.tsx           # Share card composer
│   └── settings-info.tsx        # Methodology, Catan notice, Privacy, About
├── assets/
│   ├── fonts/                   # Inter font family
│   └── sounds/                  # roll.wav, undo.wav, done.wav (WAV, 22 kHz mono)
├── components/
│   ├── DiceGrid.tsx             # Responsive roll-entry grid
│   ├── NumberButton.tsx         # Single tappable roll button (accessible, reduced-motion)
│   ├── ErrorBoundary.tsx        # Class error boundary
│   ├── ErrorFallback.tsx        # Crash-recovery UI
│   └── KeyboardAwareScrollViewCompat.tsx
├── constants/
│   └── colors.ts                # Design tokens (dark charcoal + teal #1ABC9C)
├── context/
│   ├── GameContext.tsx           # Active session in memory, writes to AsyncStorage
│   └── SettingsContext.tsx       # App settings, persists on change
├── hooks/
│   ├── useColors.ts             # Color scheme hook (always dark)
│   └── useTimer.ts              # Elapsed-time formatter
├── services/
│   ├── catanStats.ts            # Catan-specific statistics (pure functions)
│   ├── catanVerdict.ts          # Catan verdict copy layer
│   ├── rollInput.ts             # Single entry point for all roll recording
│   ├── sound.ts                 # Optional audio feedback (expo-av)
│   ├── stats.ts                 # General statistics (pure functions)
│   ├── storage.ts               # AsyncStorage wrapper, export/import, prefill
│   └── verdict.ts               # General verdict copy layer
└── types/
    └── models.ts                # TypeScript interfaces, constants, ID generator
```

## Available Scripts

```bash
# Start the Expo dev server
pnpm --filter @workspace/dice-tracker run dev

# TypeScript check (zero errors required)
pnpm --filter @workspace/dice-tracker run typecheck

# Unit tests (146 tests across 3 suites)
cd artifacts/dice-tracker && npx jest --no-coverage
```

## Known Limitations

- **Sound**: WAV assets are bundled (`assets/sounds/`). Replace them with your own files to change the sounds.
- **Jest version**: A peer-dependency warning appears when running tests (`jest@30` vs Expo's `~29.7.0`). Tests pass — tracked as a future fix.
- **Web**: Share card image capture (`react-native-view-shot`) does not work on web; falls back to text-only sharing.
- **Expo Go**: `expo-media-library` (Save to Photos) requires a development build for full permissions on iOS.

## Statistical Methodology

All statistics are computed from the raw immutable roll-event log, never from stored aggregates.

- **Frequency** — how often each value was rolled, expressed as percentage and absolute count
- **Expected frequency** — the theoretical probability distribution for the dice mode (e.g. 2D6: 6/36 for 7)
- **Deviation** — actual% minus expected% — positive means "more than expected"
- **Streaks and droughts** — longest consecutive streak of the same value; longest gap between occurrences of a value
- **Catan exposure** — each player's weighted production potential, accounting for settlement/city placement and robber blocking. Numbers with more pips (6, 8) contribute more weight.

## Data Model

Sessions are stored as JSON objects in AsyncStorage under the `blosi:` key prefix. The schema version (`blosi:schema_version`) enables forward-compatible migrations without data loss.

Key layout:
```
blosi:schema_version        → integer
blosi:settings              → AppSettings JSON
blosi:session_ids           → string[] (ordered, newest first)
blosi:active_session_id     → string | null
blosi:session:{id}          → GameSession JSON
blosi:rolls:{sessionId}     → RollEvent[] JSON
blosi:exposures:{sessionId} → CatanPlayerExposureEvent[] JSON
blosi:prefill_session       → GameSession | null  (duplicate-setup shortcut)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for storage decisions, domain separation, and data flow.

## Technical Decisions

See [DECISIONS.md](./DECISIONS.md) for non-obvious technical choices.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the phase-by-phase history.

## Claude Code Migration Checklist

To continue development locally with Claude Code after exporting from Replit:

1. `git clone https://github.com/laxaholic123-cpu/BLorSI.git && cd BLorSI`
2. `pnpm install`
3. `pnpm --filter @workspace/dice-tracker run dev`
4. Scan the QR code with Expo Go (or press `a` for Android emulator, `i` for iOS simulator)
5. No environment variables required — the app is fully local
6. For future cloud sync: create `.env.local` from `.env.example`

## Recommended Next Steps

- **Cloud sync** — Replace `services/storage.ts` with an API client and use AsyncStorage as a local cache
- **Bluetooth dice** — Implement the `RollSource = 'bluetooth'` path in `services/rollInput.ts`
- **Friend groups** — Add `userId` to `Player`; sync becomes a filter/merge on the existing event log
- **Light theme** — Both color keys in `constants/colors.ts` use dark values; add a real light palette
- **Biometric lock** — Gate session history behind Face ID / fingerprint using `expo-local-authentication`

## License

MIT
