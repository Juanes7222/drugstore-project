/**
 * Tests for the update check strategy.
 */
import { describe, expect, it } from "vitest";
import { getCheckStrategy, getDefaultMinIntervalMs } from "./check-strategy";

describe("getCheckStrategy", () => {
  it("returns APP_START config with 6-hour minInterval", () => {
    const config = getCheckStrategy("APP_START");

    expect(config.trigger).toBe("APP_START");
    expect(config.minIntervalMs).toBe(6 * 60 * 60 * 1000);
    expect(config.notifyOnNoUpdate).toBe(false);
    expect(config.autoDownload).toBe(true);
  });

  it("returns PERIODIC config with 6-hour minInterval", () => {
    const config = getCheckStrategy("PERIODIC");

    expect(config.trigger).toBe("PERIODIC");
    expect(config.minIntervalMs).toBe(6 * 60 * 60 * 1000);
    expect(config.autoDownload).toBe(true);
  });

  it("returns MANUAL config with 0 minInterval and notifyOnNoUpdate", () => {
    const config = getCheckStrategy("MANUAL");

    expect(config.trigger).toBe("MANUAL");
    expect(config.minIntervalMs).toBe(0);
    expect(config.notifyOnNoUpdate).toBe(true);
    expect(config.autoDownload).toBe(false);
  });

  it("returns NETWORK_RESTORE config with 6-hour interval", () => {
    const config = getCheckStrategy("NETWORK_RESTORE");

    expect(config.trigger).toBe("NETWORK_RESTORE");
    expect(config.minIntervalMs).toBe(6 * 60 * 60 * 1000);
    expect(config.autoDownload).toBe(true);
  });

  it("returns WAKE config with 6-hour interval", () => {
    const config = getCheckStrategy("WAKE");

    expect(config.trigger).toBe("WAKE");
    expect(config.minIntervalMs).toBe(6 * 60 * 60 * 1000);
    expect(config.autoDownload).toBe(true);
  });
});

describe("getDefaultMinIntervalMs", () => {
  it("returns 6 hours in milliseconds", () => {
    expect(getDefaultMinIntervalMs()).toBe(6 * 60 * 60 * 1000);
  });
});
