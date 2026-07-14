/**
 * Tests for fiscal configuration constants and helpers.
 *
 * Uses vi.mock with getter-based factories so that import.meta.env values are
 * read lazily — at access time, not at module-evaluation time.  This lets each
 * test set env vars independently without module-caching issues.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./fiscal", () => ({
  get CONTINGENCY_TECH_KEY() {
    return (
      (import.meta as any).env.VITE_CONTINGENCY_TECH_KEY ??
      "00000000-0000-0000-0000-000000000000-PLACEHOLDER-CONFIGURE-ME"
    );
  },
  get FISCAL_TIME_ZONE() {
    return (
      (import.meta as any).env.VITE_FISCAL_TIME_ZONE ?? "America/Bogota"
    );
  },
  get CONTINGENCY_TRANSMISSION_WINDOW_HOURS() {
    return Number(
      (import.meta as any).env.VITE_CONTINGENCY_TRANSMISSION_WINDOW_HOURS ??
        "48",
    );
  },
  CONTINGENCY_NETWORK_DEBOUNCE_MS: {
    ENTER_MS: Number(
      (import.meta as any).env.VITE_CONTINGENCY_ENTER_DEBOUNCE_MS ?? "30000",
    ),
    EXIT_MS: Number(
      (import.meta as any).env.VITE_CONTINGENCY_EXIT_DEBOUNCE_MS ?? "10000",
    ),
  },
  isContingencyTechKeyPlaceholder: () => {
    const key =
      (import.meta as any).env.VITE_CONTINGENCY_TECH_KEY ??
      "00000000-0000-0000-0000-000000000000-PLACEHOLDER-CONFIGURE-ME";
    return key.includes("PLACEHOLDER");
  },
}));

import {
  CONTINGENCY_TECH_KEY,
  FISCAL_TIME_ZONE,
  CONTINGENCY_TRANSMISSION_WINDOW_HOURS,
  CONTINGENCY_NETWORK_DEBOUNCE_MS,
  isContingencyTechKeyPlaceholder,
} from "./fiscal";

beforeEach(() => {
  // Clear relevant env vars before each test so the default is exercised
  // when no override is set.
  delete (import.meta as any).env.VITE_CONTINGENCY_TECH_KEY;
  delete (import.meta as any).env.VITE_FISCAL_TIME_ZONE;
  delete (import.meta as any).env.VITE_CONTINGENCY_TRANSMISSION_WINDOW_HOURS;
});

describe("CONTINGENCY_TECH_KEY", () => {
  it("uses the placeholder default when env var is not set", () => {
    expect(CONTINGENCY_TECH_KEY).toContain("PLACEHOLDER");
  });

  it("reads VITE_CONTINGENCY_TECH_KEY from environment when set", () => {
    (import.meta as any).env.VITE_CONTINGENCY_TECH_KEY = "real-key-12345";

    expect(CONTINGENCY_TECH_KEY).toBe("real-key-12345");
  });
});

describe("FISCAL_TIME_ZONE", () => {
  it("defaults to America/Bogota", () => {
    expect(FISCAL_TIME_ZONE).toBe("America/Bogota");
  });

  it("reads VITE_FISCAL_TIME_ZONE from environment when set", () => {
    (import.meta as any).env.VITE_FISCAL_TIME_ZONE = "America/New_York";

    expect(FISCAL_TIME_ZONE).toBe("America/New_York");
  });
});

describe("CONTINGENCY_TRANSMISSION_WINDOW_HOURS", () => {
  it("defaults to 48", () => {
    expect(CONTINGENCY_TRANSMISSION_WINDOW_HOURS).toBe(48);
  });

  it("reads VITE_CONTINGENCY_TRANSMISSION_WINDOW_HOURS when set", () => {
    (import.meta as any).env.VITE_CONTINGENCY_TRANSMISSION_WINDOW_HOURS = "72";

    expect(CONTINGENCY_TRANSMISSION_WINDOW_HOURS).toBe(72);
  });
});

describe("CONTINGENCY_NETWORK_DEBOUNCE_MS", () => {
  it("has expected ENTER_MS and EXIT_MS values", () => {
    expect(CONTINGENCY_NETWORK_DEBOUNCE_MS.ENTER_MS).toBe(30000);
    expect(CONTINGENCY_NETWORK_DEBOUNCE_MS.EXIT_MS).toBe(10000);
  });
});

describe("isContingencyTechKeyPlaceholder", () => {
  it("returns true for the default placeholder key", () => {
    expect(isContingencyTechKeyPlaceholder()).toBe(true);
  });

  it("returns false for a real configured key", () => {
    (import.meta as any).env.VITE_CONTINGENCY_TECH_KEY =
      "550e8400-e29b-41d4-a716-446655440000";

    expect(isContingencyTechKeyPlaceholder()).toBe(false);
  });
});
