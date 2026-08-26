/**
 * Tests for LocalSyncStore.applyCycleResult
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useLocalSyncStore } from "./local-sync.store";
import { LocalSyncConnectionStatus } from "@pharmacy/shared-types";
import type { LocalSyncCycleResult } from "../../../domain/local-sync/local-sync-engine.service";

function resetStore() {
  useLocalSyncStore.setState({
    peers: [],
    currentHub: null,
    hubOverride: null,
    status: LocalSyncConnectionStatus.DISCONNECTED,
    pendingPushCount: 0,
    pendingPullCount: 0,
    lastSyncAt: null,
    lastSyncError: null,
    hubScores: [],
    conflicts: [],
    isEnabled: true,
    isInitialized: false,
    isLoading: false,
  });
}

describe("useLocalSyncStore — applyCycleResult", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("outcome: ok", () => {
    it("sets lastSyncAt and clears lastSyncError", () => {
      useLocalSyncStore.setState({ lastSyncError: "previous error", pendingPushCount: 5 });

      const result: LocalSyncCycleResult = {
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "ok",
        pushedToHub: 2,
        adoptedFromHub: 1,
      };

      useLocalSyncStore.getState().applyCycleResult(result);

      const state = useLocalSyncStore.getState();
      expect(state.lastSyncAt).toBe("2026-01-15T12:00:00.000Z");
      expect(state.lastSyncError).toBeNull();
    });

    it("decrements pendingPushCount by pushedToHub", () => {
      useLocalSyncStore.setState({ pendingPushCount: 5 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 3,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().pendingPushCount).toBe(2);
    });

    it("floors pendingPushCount at zero when pushed exceeds pending", () => {
      useLocalSyncStore.setState({ pendingPushCount: 1 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 10,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().pendingPushCount).toBe(0);
    });

    it("keeps pendingPushCount at zero when already zero", () => {
      useLocalSyncStore.setState({ pendingPushCount: 0 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 5,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().pendingPushCount).toBe(0);
    });
  });

  describe("outcome: error", () => {
    it("sets lastSyncError to the provided errorMessage", () => {
      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "error",
        pushedToHub: 0,
        adoptedFromHub: 0,
        errorMessage: "hub unreachable",
      });

      expect(useLocalSyncStore.getState().lastSyncError).toBe("hub unreachable");
    });

    it("defaults lastSyncError when errorMessage is absent", () => {
      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "error",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().lastSyncError).toBe("LAN sync cycle failed");
    });

    it("does not change lastSyncAt on error", () => {
      useLocalSyncStore.setState({ lastSyncAt: "2026-01-10T10:00:00.000Z" });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "error",
        pushedToHub: 0,
        adoptedFromHub: 0,
        errorMessage: "fail",
      });

      expect(useLocalSyncStore.getState().lastSyncAt).toBe("2026-01-10T10:00:00.000Z");
    });
  });

  describe("outcome: skipped-no-hub", () => {
    it("leaves lastSyncAt, lastSyncError and pendingPushCount untouched", () => {
      useLocalSyncStore.setState({
        lastSyncAt: "2026-01-10T10:00:00.000Z",
        lastSyncError: "old error",
        pendingPushCount: 7,
      });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "skipped-no-hub",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      const state = useLocalSyncStore.getState();
      expect(state.lastSyncAt).toBe("2026-01-10T10:00:00.000Z");
      expect(state.lastSyncError).toBe("old error");
      expect(state.pendingPushCount).toBe(7);
    });
  });
});
