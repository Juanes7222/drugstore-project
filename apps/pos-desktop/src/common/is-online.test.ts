/**
 * Tests for the isOnline() utility.
 *
 * Since jsdom does not fire real online/offline events by default, we
 * control navigator.onLine via Object.defineProperty before each test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isOnline } from "./is-online";

describe("isOnline", () => {
  beforeEach(() => {
    // jsdom defaults navigator.onLine to true; we override per test.
  });

  afterEach(() => {
    // Restore online after each test so subsequent tests start clean.
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("returns true when the browser reports being online", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });

    expect(isOnline()).toBe(true);
  });

  it("returns false when the browser reports being offline", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    expect(isOnline()).toBe(false);
  });

  it("returns false when navigator is undefined (non-browser context)", () => {
    const originalNavigator = (globalThis as any).navigator;
    delete (globalThis as any).navigator;
    try {
      expect(isOnline()).toBe(false);
    } finally {
      (globalThis as any).navigator = originalNavigator;
    }
  });
});
