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
});
