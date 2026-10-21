/**
 * @vitest-environment node
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@pharmacy/database/local";

const originalSharedArrayBuffer = globalThis.SharedArrayBuffer;

/** Simulate a runtime without cross-origin isolation (packaged Tauri app). */
const removeSharedArrayBuffer = () => {
  delete (globalThis as any).SharedArrayBuffer;
  vi.resetModules();
};

afterEach(() => {
  globalThis.SharedArrayBuffer = originalSharedArrayBuffer;
  vi.resetModules();
});

describe("shared-array-buffer-polyfill", () => {
  it("defines SharedArrayBuffer when the runtime does not expose it", async () => {
    removeSharedArrayBuffer();

    await import("./shared-array-buffer-polyfill");

    expect(typeof globalThis.SharedArrayBuffer).toBe("function");
  });

  it("keeps an existing SharedArrayBuffer untouched", async () => {
    const sentinel = class {} as unknown as SharedArrayBufferConstructor;
    globalThis.SharedArrayBuffer = sentinel;
    vi.resetModules();

    await import("./shared-array-buffer-polyfill");

    expect(globalThis.SharedArrayBuffer).toBe(sentinel);
  });

  it("lets Prisma run a parameterized raw query without a native SharedArrayBuffer", async () => {
    removeSharedArrayBuffer();
    await import("./shared-array-buffer-polyfill");

    const pg = new PGlite("memory://");
    const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) });

    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ v: number }>>(
        "SELECT $1::int AS v",
        42,
      );

      expect(rows[0]?.v).toBe(42);
    } finally {
      await prisma.$disconnect();
    }
  });
});
