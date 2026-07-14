/**
 * Unit tests for the application configuration constants.
 *
 * The exported values are evaluated at module-import time from
 * `import.meta.env`. We use `vi.stubEnv` to control environment variables
 * and `vi.resetModules()` to force re-evaluation of the module on each
 * import, so each test can verify the correct default or overridden value.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults API_BASE_URL to http://localhost:3000 when VITE_API_BASE_URL is not set", async () => {
    vi.stubEnv("VITE_API_BASE_URL", undefined);

    const { API_BASE_URL } = await import("./config");
    expect(API_BASE_URL).toBe("http://localhost:3000");
  });

  it("defaults DB_PROOF_ENABLED to false when VITE_DB_PROOF is not set", async () => {
    vi.stubEnv("VITE_DB_PROOF", undefined);

    const { DB_PROOF_ENABLED } = await import("./config");
    expect(DB_PROOF_ENABLED).toBe(false);
  });

  it("reads VITE_API_BASE_URL when set to a custom value", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.pharmacy.example.com");

    const { API_BASE_URL } = await import("./config");
    expect(API_BASE_URL).toBe("https://api.pharmacy.example.com");
  });
});
