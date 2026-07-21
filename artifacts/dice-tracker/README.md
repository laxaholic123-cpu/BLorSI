# BAD LUCK OR SKILL ISSUE?

> Track every roll. Settle every excuse.

A polished mobile dice tracker for physical tabletop games. Records rolls as immutable events, calculates fair statistics, and generates humorous end-of-game verdicts — so you can finally settle the table debate.

## Features

- **Fast roll entry** — large tappable number buttons, one tap per roll
- **Player tracking** — up to 8 players with auto-advance
- **Accurate statistics** — frequency, expected vs. actual, streaks, droughts
- **Catan-Compatible Mode** — weighted number exposure, robber tracking, production analysis
- **Local-first** — fully offline, no account required
- **Shareable results** — verdict cards and game summaries

## Tech Stack

- [Expo](https://expo.dev/) (SDK 54)
- [React Native](https://reactnative.dev/) 0.81
- [TypeScript](https://www.typescriptlang.org/) (strict mode)
- [Expo Router](https://expo.github.io/router/) (file-based routing)
- [AsyncStorage](https://react-native-async-storage.github.io/async-storage/) (local persistence)
- [React Query](https://tanstack.com/query) (future server state)
- pnpm workspace monorepo

## Prerequisites

- Node.js 20+
- pnpm 9+
- Expo Go app on your phone (for device testing)

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
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout + providers
│   ├── (tabs)/             # Tab navigation (Home, History, Settings)
│   ├── new-game/           # Game setup flow (modal stack)
│   ├── active-game.tsx     # Active game screen
│   └── results.tsx         # Results / end-of-game screen
├── assets/                 # Images, fonts
├── components/             # Shared UI components
├── constants/
│   └── colors.ts           # Design tokens (dark charcoal + amber/gold theme)
├── context/
│   ├── GameContext.tsx      # Active session state
│   └── SettingsContext.tsx  # App settings state
├── hooks/
│   └── useColors.ts        # Color scheme hook
├── services/
│   └── storage.ts          # AsyncStorage persistence layer
└── types/
    └── models.ts            # Data models and TypeScript types
```

## Available Scripts

```bash
# Start the Expo dev server
pnpm --filter @workspace/dice-tracker run dev

# TypeScript check
pnpm --filter @workspace/dice-tracker run typecheck

# Build for production
pnpm --filter @workspace/dice-tracker run build
```

## Environment Variables

See `.env.example`. No environment variables are required for local development.
The app runs entirely offline without any configuration.

## Known Limitations (Phase 1)

- Active game play and number-button entry: **Phase 2**
- Statistics module and results screen: **Phase 3**
- Catan-Compatible Mode: **Phase 4**
- Game history and share cards: **Phase 5**
- Sound effects: **Phase 6**

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
4. Scan the QR code with Expo Go
5. No environment variables required for Phase 1–6 (local-only app)
6. For future cloud sync: create `.env.local` from `.env.example`

## License

MIT
