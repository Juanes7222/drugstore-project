/**
 * Tests for the rollback detector.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createRollbackDetector } from "./rollback-detector";

describe("RollbackDetector", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("checkForRollback", () => {
    it("returns needsRollback=false on first run", async () => {
      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);

      const result = await detector.checkForRollback();

      expect(result.needsRollback).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("increments crash counter on same-version startups", async () => {
      // First run
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 0, version: "2.0.0" }),
      );

      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);

      const result = await detector.checkForRollback();

      expect(result.needsRollback).toBe(false);
    });

    it("detects rollback needed after max consecutive crashes", async () => {
      // Simulate 3 previous crashes (count = 3 means we've already tried)
      const detector1 = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 0, version: "1.0.0" }),
      );
      // First run detects version change, sets count to 1
      await detector1.checkForRollback();

      // Now we need to simulate the sentinel showing count = 4 after crashes
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 3, version: "2.0.0" }),
      );
      const detector2 = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);

      const result = await detector2.checkForRollback();

      expect(result.needsRollback).toBe(true);
      expect(result.reason).toContain("crashed");
    });

    it("resets counter when version changes", async () => {
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 5, version: "1.0.0" }),
      );

      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);

      const result = await detector.checkForRollback();

      // Version changed, counter should be reset
      expect(result.needsRollback).toBe(false);
    });

    it("returns needsRollback=false when sentinel read fails", async () => {
      // Corrupt data
      sessionStorage.setItem(".last-update-startup", "{invalid json}");

      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);

      const result = await detector.checkForRollback();

      expect(result.needsRollback).toBe(false);
    });
  });

  describe("markStartupSuccess", () => {
    it("clears the sentinel count", async () => {
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 2, version: "2.0.0" }),
      );

      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);
      await detector.markStartupSuccess();

      const raw = sessionStorage.getItem(".last-update-startup");
      const parsed = JSON.parse(raw!);
      expect(parsed.count).toBe(0);
    });
  });

  describe("resetCrashCount", () => {
    it("resets the crash counter to 0", async () => {
      sessionStorage.setItem(
        ".last-update-startup",
        JSON.stringify({ count: 5, version: "2.0.0" }),
      );

      const detector = createRollbackDetector({
        prisma: {},
        currentVersion: "2.0.0",
      } as any);
      await detector.resetCrashCount();

      const raw = sessionStorage.getItem(".last-update-startup");
      const parsed = JSON.parse(raw!);
      expect(parsed.count).toBe(0);
    });
  });
});
