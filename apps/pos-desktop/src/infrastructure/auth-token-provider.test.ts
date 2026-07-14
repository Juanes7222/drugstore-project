/**
 * Unit tests for the local-storage auth token provider.
 *
 * Note: The test environment is jsdom, so `window` and `window.localStorage`
 * are always available. The `typeof window === "undefined"` guard in the
 * source is effectively dead code in this environment but is preserved for
 * safety when the module is evaluated in a non-browser context (e.g., a
 * future Tauri background script running outside the webview).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { createLocalStorageAuthTokenProvider } from "./auth-token-provider";

const ACCESS_TOKEN_KEY = "pharmacy_pos_access_token";

describe("createLocalStorageAuthTokenProvider", () => {
  const provider = createLocalStorageAuthTokenProvider();

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when localStorage has no token", async () => {
    const token = await provider.getAccessToken();
    expect(token).toBeNull();
  });

  it("returns the token value when one is stored", async () => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, "jwt-abc-123");
    const token = await provider.getAccessToken();
    expect(token).toBe("jwt-abc-123");
  });
});
