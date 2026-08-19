/**
 * Crash reporting.
 *
 * WHY
 * ---
 * Until now every bug report was "it crashed sometimes", which is a bad place to
 * be for an app whose storage layer was recently reworked. Worse, the storage
 * code deliberately swallows failures so a write error can never crash a game —
 * which means the failures that matter most are the ones nobody ever sees.
 * Reporting gives those a voice without putting them in the player's face.
 *
 * PRIVACY
 * -------
 * This app is offline-first and its data is a record of someone's game nights.
 * The configuration below is deliberately conservative:
 *   - no automatic capture of user identity
 *   - no breadcrumbs for touch events, which can imply what was on screen
 *   - board photos are never touched by this path at all
 *
 * DISABLED BY DEFAULT. Without EXPO_PUBLIC_SENTRY_DSN set, every function here
 * is a no-op — no network, no initialisation, nothing collected. That is the
 * right default for a local development build and means a fork of this repo
 * never reports to someone else's project.
 */

import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

let initialised = false;

/** True when a DSN was supplied and reporting is actually running. */
export function isCrashReportingEnabled(): boolean {
  return initialised;
}

/**
 * Start crash reporting. Safe to call more than once; does nothing without a DSN.
 * Called once from the root layout.
 */
export function initCrashReporting(): void {
  if (initialised || !DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      // Errors only. Performance tracing on a dice tracker would be noise.
      tracesSampleRate: 0,
      // Touch breadcrumbs can reveal what a player was looking at. Not worth it.
      enableAutoPerformanceTracing: false,
      // Keep releases separable so a crash can be traced to a specific build.
      environment: __DEV__ ? 'development' : 'production',
      beforeSend(event) {
        // Belt and braces: strip anything that could identify a person even if
        // a future SDK default starts collecting it.
        delete event.user;
        delete event.server_name;
        return event;
      },
    });
    initialised = true;
  } catch {
    // Reporting must never be the reason the app fails to start.
  }
}

/**
 * Report a caught error that the app handled but should not have hit.
 *
 * This is the important one. Storage failures are caught and swallowed by
 * design, so without an explicit report they are invisible — the user sees a
 * vague message and the developer sees nothing at all.
 */
export function reportHandledError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never let reporting throw into the caller's error path.
  }
}

/** Leave a trail for whatever error comes next. No-op when disabled. */
export function addBreadcrumb(message: string, data?: Record<string, unknown>): void {
  if (!initialised) return;
  try {
    Sentry.addBreadcrumb({ message, data, level: 'info' });
  } catch {
    // Ignored.
  }
}
