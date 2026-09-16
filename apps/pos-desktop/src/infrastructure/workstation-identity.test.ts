/**
 * Unit tests for workstation identity resolution (zero-touch
 * self-registration).
 *
 * The module exposes `storage` and `generateUuid` as injectable seams, so
 * these tests never touch real localStorage or Web Crypto — each test wires
 * its own in-memory backend and deterministic UUID stub.
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  convergeWorkstationId,
  resolveWorkstationId,
  resolveWorkstationName,
  type IdentityStorage,
  type WorkstationIdentity,
} from "./workstation-identity";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

type MockStorage = IdentityStorage & {
  getItem: Mock<() => string | null>;
  setItem: Mock<(value: string) => void>;
};

const makeStorage = (initial: string | null = null): MockStorage => {
  let stored = initial;
  return {
    getItem: vi.fn((): string | null => stored),
    setItem: vi.fn((value: string) => {
      stored = value;
    }),
  };
};

const makeUuidGenerator = (ids: string[]): Mock<() => string> => {
  let next = 0;
  return vi.fn((): string => {
    const id = ids[next % ids.length];
    next += 1;
    return id;
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workstation-identity", () => {
  describe("resolveWorkstationId", () => {
    describe("env override (VITE_WORKSTATION_ID)", () => {
      it("wins over a persisted value and does not write to storage", () => {
        const storage = makeStorage("persisted-terminal-id");

        const result = resolveWorkstationId({
          envWorkstationId: "env-pinned-id",
          storage,
        });

        expect(result).toEqual({ workstationId: "env-pinned-id", source: "env" });
        expect(storage.setItem).not.toHaveBeenCalled();
      });

      it("trims surrounding whitespace from the env value", () => {
        const result = resolveWorkstationId({
          envWorkstationId: "  ws-dev-7  ",
          storage: makeStorage(),
        });

        expect(result.workstationId).toBe("ws-dev-7");
      });

      it("falls through to the persisted value when the env value is blank", () => {
        const storage = makeStorage("persisted-terminal-id");

        const result = resolveWorkstationId({
          envWorkstationId: "   ",
          storage,
        });

        expect(result).toEqual({
          workstationId: "persisted-terminal-id",
          source: "persisted",
        });
        expect(storage.setItem).not.toHaveBeenCalled();
      });
    });

    describe("persisted value", () => {
      it("returns a valid persisted id without generating or writing", () => {
        const storage = makeStorage("terminal-from-last-run");
        const generateUuid = makeUuidGenerator(["should-not-be-used"]);

        const result = resolveWorkstationId({ storage, generateUuid });

        expect(result).toEqual({
          workstationId: "terminal-from-last-run",
          source: "persisted",
        });
        expect(generateUuid).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
      });

      it("discards an empty persisted value and persists a fresh UUID", () => {
        const storage = makeStorage("");
        const generateUuid = makeUuidGenerator(["uuid-fresh-1"]);

        const result = resolveWorkstationId({ storage, generateUuid });

        expect(result).toEqual({ workstationId: "uuid-fresh-1", source: "generated" });
        expect(storage.setItem).toHaveBeenCalledWith("uuid-fresh-1");
      });

      it("discards a persisted value longer than 128 characters", () => {
        const storage = makeStorage("a".repeat(129));
        const generateUuid = makeUuidGenerator(["uuid-fresh-2"]);

        const result = resolveWorkstationId({ storage, generateUuid });

        expect(result).toEqual({ workstationId: "uuid-fresh-2", source: "generated" });
        expect(storage.setItem).toHaveBeenCalledWith("uuid-fresh-2");
      });
    });

    describe("first boot (nothing persisted)", () => {
      it("generates a UUID and round-trips it into storage", () => {
        const storage = makeStorage(null);
        const generateUuid = makeUuidGenerator(["uuid-first-boot"]);

        const result = resolveWorkstationId({ storage, generateUuid });

        expect(result).toEqual({ workstationId: "uuid-first-boot", source: "generated" });
        expect(generateUuid).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenCalledTimes(1);
        expect(storage.setItem).toHaveBeenCalledWith("uuid-first-boot");
        expect(storage.getItem()).toBe("uuid-first-boot");
      });

      it("still resolves when the localStorage write throws", () => {
        // Regression guard: quota/private-mode failures must never crash
        // boot. The swallow lives in the localStorage adapter; the injected
        // storage seam intentionally propagates errors to its caller.
        const setItemSpy = vi
          .spyOn(window.localStorage, "setItem")
          .mockImplementation(() => {
            throw new Error("QuotaExceededError");
          });

        let result: WorkstationIdentity | undefined;
        expect(() => {
          result = resolveWorkstationId();
        }).not.toThrow();

        setItemSpy.mockRestore();
        expect(result?.source).toBe("generated");
        expect(result?.workstationId.length).toBeGreaterThan(0);
      });
    });
  });

  describe("resolveWorkstationName", () => {
    it("uses VITE_FRIENDLY_NAME verbatim when provided", () => {
      const name = resolveWorkstationName(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeffff1234",
        "Caja Principal",
      );

      expect(name).toBe("Caja Principal");
    });

    it("derives POS XXXX from the last four characters of the id uppercased", () => {
      const name = resolveWorkstationName(
        "aaaaaaaa-bbbb-cccc-dddd-eeeeff00ab12",
      );

      expect(name).toBe("POS AB12");
    });

    it("falls back to the derived label when the friendly name is blank", () => {
      const name = resolveWorkstationName("id-ending-7777", "   ");

      expect(name).toBe("POS 7777");
    });
  });

  describe("convergeWorkstationId", () => {
    const makeReadFile = (value: string | null) => vi.fn(async () => value);
    const makeWriteFile = () => vi.fn(async (_value: string) => true);

    it("prefers the shared file and heals a diverged storage", async () => {
      const storage = makeStorage("storage-id");
      const readFile = makeReadFile("file-id");
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "file-id",
        source: "file",
        converged: true,
      });
      expect(storage.setItem).toHaveBeenCalledWith("file-id");
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("reports no convergence when file and storage already agree", async () => {
      const storage = makeStorage("same-id");
      const readFile = makeReadFile("same-id");
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "same-id",
        source: "file",
        converged: false,
      });
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("promotes a valid storage value to the missing file", async () => {
      const storage = makeStorage("persisted-id");
      const readFile = makeReadFile(null);
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "persisted-id",
        source: "persisted",
        converged: true,
      });
      expect(writeFile).toHaveBeenCalledWith("persisted-id");
    });

    it("mints a fresh id into both stores when neither exists", async () => {
      const storage = makeStorage(null);
      const generateUuid = makeUuidGenerator(["uuid-fresh-converge"]);
      const readFile = makeReadFile(null);
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({
        storage,
        generateUuid,
        readFile,
        writeFile,
      });

      expect(result).toEqual({
        workstationId: "uuid-fresh-converge",
        source: "generated",
        converged: true,
      });
      expect(storage.setItem).toHaveBeenCalledWith("uuid-fresh-converge");
      expect(writeFile).toHaveBeenCalledWith("uuid-fresh-converge");
    });

    it("discards corrupt values from both stores and generates fresh", async () => {
      const storage = makeStorage("");
      const generateUuid = makeUuidGenerator(["uuid-after-corrupt"]);
      const readFile = makeReadFile("   ");
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({
        storage,
        generateUuid,
        readFile,
        writeFile,
      });

      expect(result.workstationId).toBe("uuid-after-corrupt");
      expect(result.source).toBe("generated");
    });

    it("falls back to storage when the file value is corrupt", async () => {
      const storage = makeStorage("valid-storage-id");
      const readFile = makeReadFile("a".repeat(129));
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "valid-storage-id",
        source: "persisted",
        converged: true,
      });
    });

    it("prefers the file when the storage value is corrupt", async () => {
      const storage = makeStorage("");
      const readFile = makeReadFile("valid-file-id");
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result.workstationId).toBe("valid-file-id");
      expect(result.source).toBe("file");
    });

    it("never throws when file I/O fails", async () => {
      const storage = makeStorage("persisted-id");
      const readFile = vi.fn(async () => {
        throw new Error("disk unavailable");
      });
      const writeFile = vi.fn(async (_value: string) => {
        throw new Error("disk read-only");
      });

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "persisted-id",
        source: "persisted",
        converged: false,
      });
    });

    it("never throws when storage writes fail", async () => {
      const storage = makeStorage("stale-id");
      vi.mocked(storage.setItem).mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      const readFile = makeReadFile("file-wins-id");
      const writeFile = makeWriteFile();

      const result = await convergeWorkstationId({ storage, readFile, writeFile });

      expect(result).toEqual({
        workstationId: "file-wins-id",
        source: "file",
        converged: true,
      });
    });
  });
});
