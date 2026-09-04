/**
 * Tests for LocalSyncStore.applyCycleResult and forceSync.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mock for Tauri invoke — must be defined before vi.mock is hoisted
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => (mockInvoke as unknown as (...a: unknown[]) => unknown)(...args),
}));

import { useLocalSyncStore } from "./local-sync.store";
import { LocalSyncConnectionStatus } from "@pharmacy/shared-types";
import type { LocalSyncCycleResult } from "../../../domain/local-sync/local-sync-engine.service";
import { setLocalSyncEngine } from "../../../domain/local-sync/local-sync-engine-holder";

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
    lastCycleOutcome: null,
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
    mockInvoke.mockReset();
    setLocalSyncEngine(null);
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

    it("prefers the engine pendingNotRelayed count over decrementing", () => {
      useLocalSyncStore.setState({ pendingPushCount: 10 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 3,
        adoptedFromHub: 0,
        pendingNotRelayed: 4,
      });

      expect(useLocalSyncStore.getState().pendingPushCount).toBe(4);
    });

    it("accepts a zero pendingNotRelayed count instead of decrementing", () => {
      useLocalSyncStore.setState({ pendingPushCount: 10 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 3,
        adoptedFromHub: 0,
        pendingNotRelayed: 0,
      });

      expect(useLocalSyncStore.getState().pendingPushCount).toBe(0);
    });

    it("surfaces identity collisions as DUPLICATE_WORKSTATION_ID", () => {
      useLocalSyncStore.setState({ pendingPushCount: 5 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "ok",
        pushedToHub: 1,
        adoptedFromHub: 0,
        identityCollisions: 2,
      });

      const state = useLocalSyncStore.getState();
      expect(state.lastSyncError).toBe("DUPLICATE_WORKSTATION_ID:2");
      expect(state.lastSyncAt).toBe("2026-01-15T12:00:00.000Z");
    });

    it("clears the collision error once collisions drop to zero", () => {
      useLocalSyncStore.setState({ lastSyncError: "DUPLICATE_WORKSTATION_ID:2" });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "ok",
        pushedToHub: 0,
        adoptedFromHub: 0,
        identityCollisions: 0,
      });

      expect(useLocalSyncStore.getState().lastSyncError).toBeNull();
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

  describe("outcome: skipped-backoff", () => {
    it("leaves lastSyncAt, lastSyncError and pendingPushCount untouched", () => {
      useLocalSyncStore.setState({
        lastSyncAt: "2026-01-10T10:00:00.000Z",
        lastSyncError: "old error",
        pendingPushCount: 7,
      });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "skipped-backoff",
        pushedToHub: 0,
        adoptedFromHub: 0,
        hubAddress: "192.168.1.10:49500",
      });

      const state = useLocalSyncStore.getState();
      expect(state.lastSyncAt).toBe("2026-01-10T10:00:00.000Z");
      expect(state.lastSyncError).toBe("old error");
      expect(state.pendingPushCount).toBe(7);
    });
  });

  describe("lastCycleOutcome tracking", () => {
    it("starts as null before the first cycle", () => {
      expect(useLocalSyncStore.getState().lastCycleOutcome).toBeNull();
    });

    it("records the null to ok to skipped-backoff to skipped-no-hub to error sequence", () => {
      expect(useLocalSyncStore.getState().lastCycleOutcome).toBeNull();

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "ok",
        pushedToHub: 1,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("ok");

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:01:00.000Z",
        outcome: "skipped-backoff",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("skipped-backoff");

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:02:00.000Z",
        outcome: "skipped-no-hub",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("skipped-no-hub");

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:03:00.000Z",
        outcome: "error",
        pushedToHub: 0,
        adoptedFromHub: 0,
        errorMessage: "hub unreachable",
      });

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("error");
    });

    it("sets lastCycleOutcome to ok alongside counts and error-clearing", () => {
      useLocalSyncStore.setState({ lastSyncError: "previous error", pendingPushCount: 5 });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "ok",
        pushedToHub: 2,
        adoptedFromHub: 1,
      });

      const state = useLocalSyncStore.getState();

      expect(state.lastCycleOutcome).toBe("ok");
      expect(state.lastSyncError).toBeNull();
      expect(state.pendingPushCount).toBe(3);
    });

    it("sets lastCycleOutcome to error alongside the message", () => {
      useLocalSyncStore.getState().applyCycleResult({
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "error",
        pushedToHub: 0,
        adoptedFromHub: 0,
        errorMessage: "hub unreachable",
      });

      const state = useLocalSyncStore.getState();

      expect(state.lastCycleOutcome).toBe("error");
      expect(state.lastSyncError).toBe("hub unreachable");
    });

    it("sets only lastCycleOutcome on skipped-no-hub and preserves a pre-existing error", () => {
      useLocalSyncStore.setState({
        lastSyncError: "previous error",
        lastCycleOutcome: "ok",
        pendingPushCount: 7,
        lastSyncAt: "2026-01-10T10:00:00.000Z",
      });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "skipped-no-hub",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      const state = useLocalSyncStore.getState();

      expect(state.lastCycleOutcome).toBe("skipped-no-hub");
      expect(state.lastSyncError).toBe("previous error");
      expect(state.pendingPushCount).toBe(7);
      expect(state.lastSyncAt).toBe("2026-01-10T10:00:00.000Z");
    });

    it("sets only lastCycleOutcome on skipped-backoff and preserves a pre-existing error", () => {
      useLocalSyncStore.setState({
        lastSyncError: "previous error",
        lastCycleOutcome: "ok",
        pendingPushCount: 7,
        lastSyncAt: "2026-01-10T10:00:00.000Z",
      });

      useLocalSyncStore.getState().applyCycleResult({
        ranAt: new Date().toISOString(),
        outcome: "skipped-backoff",
        pushedToHub: 0,
        adoptedFromHub: 0,
      });

      const state = useLocalSyncStore.getState();

      expect(state.lastCycleOutcome).toBe("skipped-backoff");
      expect(state.lastSyncError).toBe("previous error");
      expect(state.pendingPushCount).toBe(7);
      expect(state.lastSyncAt).toBe("2026-01-10T10:00:00.000Z");
    });
  });

  describe("refreshStatus", () => {
    function mockStatusPoll() {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status")
          return {
            connectionStatus: LocalSyncConnectionStatus.CONNECTED,
            currentHubId: "ws-hub",
            currentHubAddress: "192.168.1.10:49500",
            pendingPushCount: 2,
            pendingPullCount: 0,
            lastSyncAt: null,
            lastError: null,
            backoffUntil: null,
          };
        if (cmd === "get_current_hub") return null;
        throw new Error(`unexpected invoke: ${cmd}`);
      });
    }

    it("never clears a skipped-backoff outcome", async () => {
      mockStatusPoll();
      useLocalSyncStore.setState({ lastCycleOutcome: "skipped-backoff" });

      await useLocalSyncStore.getState().refreshStatus();

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("skipped-backoff");
    });

    it("never clears an ok outcome", async () => {
      mockStatusPoll();
      useLocalSyncStore.setState({ lastCycleOutcome: "ok" });

      await useLocalSyncStore.getState().refreshStatus();

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("ok");
    });

    it("never clears an error outcome even when the poll reports no error", async () => {
      mockStatusPoll();
      useLocalSyncStore.setState({ lastCycleOutcome: "error" });

      await useLocalSyncStore.getState().refreshStatus();

      expect(useLocalSyncStore.getState().lastCycleOutcome).toBe("error");
    });
  });

  describe("forceSync", () => {
    function mockStatusRefresh() {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "get_local_sync_status")
          return {
            connectionStatus: LocalSyncConnectionStatus.CONNECTED,
            currentHubId: "ws-hub",
            currentHubAddress: "192.168.1.10:49500",
            pendingPushCount: 2,
            pendingPullCount: 0,
            lastSyncAt: null,
            lastError: null,
            backoffUntil: null,
          };
        if (cmd === "get_current_hub") return null;
        if (cmd === "force_local_sync") return undefined;
        throw new Error(`unexpected invoke: ${cmd}`);
      });
    }

    it("drives an engine cycle from the holder when one is registered", async () => {
      mockStatusRefresh();
      const runCycle = vi.fn(async (): Promise<LocalSyncCycleResult> => ({
        ranAt: "2026-01-15T12:00:00.000Z",
        outcome: "ok",
        pushedToHub: 1,
        adoptedFromHub: 0,
        pendingNotRelayed: 2,
      }));
      setLocalSyncEngine({
        start: vi.fn(),
        stop: vi.fn(),
        runCycle,
        triggerImmediateSync: vi.fn(),
      });

      await useLocalSyncStore.getState().forceSync();

      expect(runCycle).toHaveBeenCalledOnce();
      expect(mockInvoke).not.toHaveBeenCalledWith("force_local_sync");
      expect(useLocalSyncStore.getState().isLoading).toBe(false);
    });

    it("falls back to the pull-only command when no engine is registered", async () => {
      mockStatusRefresh();

      await useLocalSyncStore.getState().forceSync();

      expect(mockInvoke).toHaveBeenCalledWith("force_local_sync");
      expect(useLocalSyncStore.getState().isLoading).toBe(false);
    });
  });
});
