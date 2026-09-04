/**
 * Unit tests for shutdownServices() — tears down a Services bundle created
 * by initializeServices() so a discarded bundle (StrictMode double-mount,
 * stale late init, tests) goes fully silent instead of firing orphan pushes.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { shutdownServices, type Services } from "./use-service-init";
import {
  getLocalSyncEngine,
  setLocalSyncEngine,
} from "../../domain/local-sync/local-sync-engine-holder";
import {
  notifyPendingEntry,
  setPushTrigger,
} from "../../domain/sync/sync-queue-notifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFakeServices = (overrides: Record<string, unknown> = {}) =>
  ({
    localSyncEngine: { stop: vi.fn(), start: vi.fn(), triggerImmediateSync: vi.fn() },
    syncScheduler: { stop: vi.fn(), start: vi.fn(), syncNow: vi.fn() },
    updateService: { stopTelemetryFlush: vi.fn(), startTelemetryFlush: vi.fn() },
    printerHealthService: { stop: vi.fn(), start: vi.fn() },
    ...overrides,
  }) as unknown as Services;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("shutdownServices", () => {
  beforeEach(() => {
    setPushTrigger(null);
    setLocalSyncEngine(null);
    vi.restoreAllMocks();
  });

  describe("stops every background loop", () => {
    it("stops the engine, scheduler, telemetry, and printer health", () => {
      const services = makeFakeServices();

      shutdownServices(services);

      expect(services.localSyncEngine.stop).toHaveBeenCalledTimes(1);
      expect(services.syncScheduler.stop).toHaveBeenCalledTimes(1);
      expect(services.updateService.stopTelemetryFlush).toHaveBeenCalledTimes(1);
      expect(services.printerHealthService.stop).toHaveBeenCalledTimes(1);
    });

    it("is safe to call twice — second call never throws", () => {
      const services = makeFakeServices();

      shutdownServices(services);

      expect(() => shutdownServices(services)).not.toThrow();
      expect(services.localSyncEngine.stop).toHaveBeenCalledTimes(2);
    });
  });

  describe("never throws", () => {
    it("swallows faulty services and still stops the rest", () => {
      const printerHealthStop = vi.fn();
      const services = makeFakeServices({
        localSyncEngine: {
          stop: vi.fn(() => {
            throw new Error("engine already stopped");
          }),
        },
        syncScheduler: {
          stop: vi.fn(() => {
            throw new Error("scheduler already stopped");
          }),
        },
        updateService: {
          stopTelemetryFlush: vi.fn(() => {
            throw new Error("telemetry never started");
          }),
        },
        printerHealthService: { stop: printerHealthStop },
      });

      expect(() => shutdownServices(services)).not.toThrow();
      expect(printerHealthStop).toHaveBeenCalledTimes(1);
    });

    it("swallows a missing telemetry stop without breaking teardown", () => {
      const services = makeFakeServices({
        updateService: {},
      });

      expect(() => shutdownServices(services)).not.toThrow();
      expect(services.localSyncEngine.stop).toHaveBeenCalledTimes(1);
      expect(services.syncScheduler.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe("clears the engine holder conditionally", () => {
    it("clears the holder when it still points at this bundle", () => {
      const services = makeFakeServices();
      setLocalSyncEngine(services.localSyncEngine);

      shutdownServices(services);

      expect(getLocalSyncEngine()).toBeNull();
    });

    it("leaves the holder alone when a newer bundle owns it", () => {
      const staleServices = makeFakeServices();
      const liveServices = makeFakeServices();
      setLocalSyncEngine(liveServices.localSyncEngine);

      shutdownServices(staleServices);

      expect(getLocalSyncEngine()).toBe(liveServices.localSyncEngine);
    });

    it("leaves a null holder alone", () => {
      const services = makeFakeServices();
      setLocalSyncEngine(null);

      shutdownServices(services);

      expect(getLocalSyncEngine()).toBeNull();
    });
  });

  describe("leaves foreign push triggers alone", () => {
    it("does not remove a trigger owned by another bundle", () => {
      const services = makeFakeServices();
      const foreignTrigger = vi.fn();
      setPushTrigger(foreignTrigger);

      shutdownServices(services);
      notifyPendingEntry();

      expect(foreignTrigger).toHaveBeenCalledTimes(1);
    });
  });
});
