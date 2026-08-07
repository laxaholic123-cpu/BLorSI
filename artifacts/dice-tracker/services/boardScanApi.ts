/**
 * boardScanApi — runtime wrapper around buildBoardScanUrl.
 *
 * `buildBoardScanUrl` lives in utils/buildBoardScanUrl.ts (no RN imports)
 * so it can be unit-tested in Jest without react-native module resolution.
 * This file adds the `Platform` / `process.env` wiring for the live app.
 */

import { Platform } from "react-native";
import { buildBoardScanUrl } from "@/utils/buildBoardScanUrl";

export { buildBoardScanUrl } from "@/utils/buildBoardScanUrl";

/** Returns the full URL for the board-scan analyze endpoint, or '' if unavailable. */
export function getBoardScanApiUrl(): string {
  return buildBoardScanUrl({
    os: Platform.OS,
    origin:
      Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : undefined,
    publicDomain: process.env.EXPO_PUBLIC_DOMAIN,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  });
}
