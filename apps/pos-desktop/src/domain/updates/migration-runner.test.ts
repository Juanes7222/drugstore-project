/**
 * Tests for the migration runner.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { createMigrationRunner } from "./migration-runner";
import { MigrationFailedException } from "./exceptions";

function createMockPrisma() {
  const logStore: any[] = [];
  return {
    migrationLog: {
      findMany: vi.fn(async (args?: any) => {
        if (args?.where?.success === true) {
          return logStore.filter((e) => e.success).map((e) => ({
            ...e,
            appliedAt: new Date(e.appliedAt),
          }));
        }
        return logStore.map((e) => ({ ...e, appliedAt: new Date(e.appliedAt) }));
      }),
      create: vi.fn(async (args: any) => {
        const entry = { ...args.data, appliedAt: new Date(args.data.appliedAt) };
        logStore.push(entry);
        return entry;
      }),
    },
    $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MigrationRunner", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
  });

  describe("listApplied", () => {
    it("returns empty array when no migrations have been applied", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [],
      });

      const applied = await runner.listApplied();

      expect(applied).toEqual([]);
    });
  });

  describe("runPending", () => {
    it("applies all pending SQL migrations", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-init", type: "SQL", payload: "CREATE TABLE test (id INT)" },
          { name: "002-add-column", type: "SQL", payload: "ALTER TABLE test ADD name TEXT" },
        ],
      });

      const results = await runner.runPending();

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it("skips already-applied migrations", async () => {
      // First apply
      const runner1 = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-init", type: "SQL", payload: "CREATE TABLE test (id INT)" },
        ],
      });
      await runner1.runPending();

      // Second run with same migration
      const runner2 = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-init", type: "SQL", payload: "CREATE TABLE test (id INT)" },
        ],
      });
      const results = await runner2.runPending();

      // Should not re-apply
      expect(results).toHaveLength(0);
    });

    it("throws MigrationFailedException on migration error", async () => {
      mockPrisma.$executeRawUnsafe = vi.fn().mockRejectedValue(
        new Error("Syntax error"),
      );

      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-bad-sql", type: "SQL", payload: "INVALID SQL" },
        ],
      });

      await expect(runner.runPending()).rejects.toThrow(MigrationFailedException);
    });

    it("throws for unknown migration type", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-unknown", type: "UNKNOWN" as any, payload: "{}" },
        ],
      });

      await expect(runner.runPending()).rejects.toThrow(MigrationFailedException);
    });

    it("throws for CUSTOM migrations with file path", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-custom", type: "CUSTOM", payload: { filePath: "/bundle/migrate.js" } },
        ],
        bundlePath: "/bundle",
      });

      await expect(runner.runPending()).rejects.toThrow(MigrationFailedException);
    });

    it("applies CUSTOM migrations with inline code", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          {
            name: "001-custom",
            type: "CUSTOM",
            payload: { code: "return Promise.resolve();" },
          },
        ],
      });

      const results = await runner.runPending();

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it("applies PRISMA type migrations via $executeRawUnsafe", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-prisma", type: "PRISMA", payload: "ALTER TABLE test ADD COLUMN c TEXT" },
        ],
      });

      const results = await runner.runPending();

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        "ALTER TABLE test ADD COLUMN c TEXT",
      );
    });

    it("throws MigrationFailedException when PRISMA payload is empty", async () => {
      const runner = createMigrationRunner({
        prisma: mockPrisma as any,
        migrations: [
          { name: "001-empty", type: "PRISMA", payload: "" },
        ],
      });

      await expect(runner.runPending()).rejects.toThrow(MigrationFailedException);
    });
  });
});
