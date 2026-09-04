/**
 * Tests for the process-wide LocalSyncEngine holder.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  setLocalSyncEngine,
  getLocalSyncEngine,
} from "./local-sync-engine-holder";
import type { LocalSyncEngine } from "./local-sync-engine.service";

function makeEngine(): LocalSyncEngine {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    runCycle: vi.fn(),
    triggerImmediateSync: vi.fn(),
  };
}

describe("local-sync-engine-holder", () => {
  beforeEach(() => {
    setLocalSyncEngine(null);
  });

  describe("getLocalSyncEngine", () => {
    it("returns null before any engine is registered", () => {
      expect(getLocalSyncEngine()).toBeNull();
    });
  });

  describe("setLocalSyncEngine", () => {
    it("returns the registered engine", () => {
      const engine = makeEngine();

      setLocalSyncEngine(engine);

      expect(getLocalSyncEngine()).toBe(engine);
    });

    it("overwrites a previously registered engine", () => {
      const first = makeEngine();
      const second = makeEngine();

      setLocalSyncEngine(first);

      setLocalSyncEngine(second);

      expect(getLocalSyncEngine()).toBe(second);
    });

    it("clears the holder when set to null", () => {
      setLocalSyncEngine(makeEngine());

      setLocalSyncEngine(null);

      expect(getLocalSyncEngine()).toBeNull();
    });
  });
});
