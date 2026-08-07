/**
 * buildBoardScanUrl — pure function, no React Native imports.
 *
 * Factored out of boardScanApi.ts so it can be imported and tested in Jest
 * without triggering react-native module resolution.
 *
 * Resolution order:
 *   1. Web with an origin   → origin + /api-server/api/board-scan/analyze
 *   2. Native + publicDomain (bare Replit dev domain, e.g. "abc.replit.dev")
 *                            → https://domain/api-server/api/board-scan/analyze
 *   3. Explicit apiBaseUrl  → base/api/board-scan/analyze
 *   4. ''                   → caller should treat as "unavailable"
 */
export function buildBoardScanUrl(opts: {
  os: string;
  origin?: string;
  publicDomain?: string;
  apiBaseUrl?: string;
}): string {
  const { os, origin, publicDomain, apiBaseUrl } = opts;

  if (os === "web" && origin) {
    return `${origin}/api-server/api/board-scan/analyze`;
  }

  const domain = (publicDomain ?? "").trim().replace(/\/$/, "");
  if (domain) return `https://${domain}/api-server/api/board-scan/analyze`;

  const base = (apiBaseUrl ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/api/board-scan/analyze` : "";
}
