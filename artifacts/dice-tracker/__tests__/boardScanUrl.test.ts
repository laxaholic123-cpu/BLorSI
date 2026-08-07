/**
 * Tests for boardScanApi.buildBoardScanUrl — the pure URL builder.
 *
 * getBoardScanApiUrl is the runtime wrapper; buildBoardScanUrl is the
 * pure function that takes explicit values so it is fully testable without
 * mocking Platform or window.
 */

import { buildBoardScanUrl } from "@/utils/buildBoardScanUrl";

const ANALYZE_PATH = "/api-server/api/board-scan/analyze";

describe("buildBoardScanUrl", () => {
  // ── Web (Expo Web, Replit preview) ─────────────────────────────────────────

  describe("web platform", () => {
    it("uses the window origin on web", () => {
      const url = buildBoardScanUrl({
        os: "web",
        origin: "https://abc.replit.dev",
      });
      expect(url).toBe(`https://abc.replit.dev${ANALYZE_PATH}`);
    });

    it("appends the correct path to a custom origin", () => {
      const url = buildBoardScanUrl({
        os: "web",
        origin: "https://myapp.example.com",
      });
      expect(url).toBe(`https://myapp.example.com${ANALYZE_PATH}`);
    });

    it("falls through to publicDomain when origin is absent on web", () => {
      // Unlikely in practice but should not break
      const url = buildBoardScanUrl({
        os: "web",
        origin: undefined,
        publicDomain: "abc.replit.dev",
      });
      expect(url).toBe(`https://abc.replit.dev${ANALYZE_PATH}`);
    });

    it("returns empty string when neither origin nor domain is provided on web", () => {
      const url = buildBoardScanUrl({ os: "web" });
      expect(url).toBe("");
    });
  });

  // ── Native (EXPO_PUBLIC_DOMAIN — Replit dev domain) ────────────────────────

  describe("native platform — EXPO_PUBLIC_DOMAIN", () => {
    it("builds the correct URL from a bare domain", () => {
      const url = buildBoardScanUrl({
        os: "ios",
        publicDomain: "abc-00-xyz.expo.riker.replit.dev",
      });
      expect(url).toBe(
        `https://abc-00-xyz.expo.riker.replit.dev${ANALYZE_PATH}`
      );
    });

    it("strips a trailing slash from the domain", () => {
      const url = buildBoardScanUrl({
        os: "android",
        publicDomain: "abc.replit.dev/",
      });
      expect(url).toBe(`https://abc.replit.dev${ANALYZE_PATH}`);
    });

    it("prefers publicDomain over apiBaseUrl", () => {
      const url = buildBoardScanUrl({
        os: "ios",
        publicDomain: "via-domain.replit.dev",
        apiBaseUrl: "https://via-base-url.example.com",
      });
      expect(url).toContain("via-domain.replit.dev");
      expect(url).not.toContain("via-base-url");
    });
  });

  // ── Native (EXPO_PUBLIC_API_BASE_URL — production / custom deployment) ─────

  describe("native platform — EXPO_PUBLIC_API_BASE_URL fallback", () => {
    it("appends /api/board-scan/analyze to the explicit base URL", () => {
      const url = buildBoardScanUrl({
        os: "ios",
        apiBaseUrl: "https://api.myapp.com",
      });
      expect(url).toBe("https://api.myapp.com/api/board-scan/analyze");
    });

    it("strips trailing slash from apiBaseUrl", () => {
      const url = buildBoardScanUrl({
        os: "android",
        apiBaseUrl: "https://api.myapp.com/",
      });
      expect(url).toBe("https://api.myapp.com/api/board-scan/analyze");
    });
  });

  // ── Nothing configured ─────────────────────────────────────────────────────

  describe("no API configured", () => {
    it("returns empty string when no origin, domain, or base URL is provided", () => {
      expect(buildBoardScanUrl({ os: "ios" })).toBe("");
    });

    it("returns empty string when publicDomain is an empty string", () => {
      expect(buildBoardScanUrl({ os: "ios", publicDomain: "" })).toBe("");
    });

    it("returns empty string when apiBaseUrl is whitespace", () => {
      expect(buildBoardScanUrl({ os: "ios", apiBaseUrl: "   " })).toBe("");
    });
  });
});
