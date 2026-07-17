/**
 * Unit tests for local-user-cache — in-memory + persisted user cache.
 *
 * The module stores a list of LocalUserInfo in an in-memory variable
 * (cachedUsers) and a persistent storage layer (secure-storage).  Each
 * function creates a fresh storage instance, so persistence across
 * operations is maintained by the module's own cachedUsers variable.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  loadCachedUsers,
  cacheUsers,
  cacheUser,
  removeCachedUser,
  clearUserCache,
  resetUserCache,
} from "./local-user-cache";
import type { SecureStorage } from "../../infrastructure/secure-storage";
import type { LocalUserInfo } from "./local-users";

// ---------------------------------------------------------------------------
// Mock secure-storage
// ---------------------------------------------------------------------------

const { mockStorage, clearMockStore } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage: SecureStorage = {
    initialize: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
  return {
    mockStorage: storage,
    clearMockStore: () => store.clear(),
  };
});

vi.mock("../../infrastructure/secure-storage", () => ({
  createSecureStorage: vi.fn(() => mockStorage),
}));

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeUser = (overrides: Partial<LocalUserInfo> = {}): LocalUserInfo => ({
  id: "user-1",
  displayName: "Test User",
  role: "CASHIER",
  avatarUrl: null,
  avatarColor: null,
  username: "testuser",
  ...overrides,
});

const makeUsers = (count: number): LocalUserInfo[] =>
  Array.from({ length: count }, (_, i) =>
    makeUser({
      id: `user-${i + 1}`,
      displayName: `User ${i + 1}`,
      username: `user${i + 1}`,
    }),
  );

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("local-user-cache", () => {
  beforeEach(() => {
    // Reset the in-memory cache so each test starts fresh
    resetUserCache();
    // Clear the mock's internal store to prevent cross-test contamination
    clearMockStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // resetUserCache
  // -----------------------------------------------------------------------

  describe("resetUserCache", () => {
    it("invalidates the in-memory cache so the next load re-reads from storage", async () => {
      // Populate the in-memory cache by loading once
      expect(await loadCachedUsers()).toEqual([]);

      // Setup storage with data
      const storedUser = makeUser();
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([storedUser]),
      );

      // After reset, the in-memory cache is null, so load reads from storage
      resetUserCache();
      const result = await loadCachedUsers();
      expect(result).toEqual([storedUser]);
    });
  });

  // -----------------------------------------------------------------------
  // loadCachedUsers
  // -----------------------------------------------------------------------

  describe("loadCachedUsers", () => {
    it("returns empty array when nothing is stored (first use)", async () => {
      vi.mocked(mockStorage.getItem).mockResolvedValue(null);

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });

    it("returns cached data from storage when in-memory cache is null", async () => {
      const storedUser = makeUser({ displayName: "From Storage" });
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([storedUser]),
      );

      const result = await loadCachedUsers();

      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe("From Storage");
    });

    it("returns in-memory cache without hitting storage on subsequent calls", async () => {
      // First call loads from storage
      const storedUser = makeUser({ displayName: "Stored" });
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([storedUser]),
      );
      await loadCachedUsers();

      // Override storage to return different data
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([makeUser({ displayName: "Different" })]),
      );

      // Second call should return cached data, not storage
      const result = await loadCachedUsers();
      expect(result[0].displayName).toBe("Stored");
    });

    it("returns empty array for corrupt JSON", async () => {
      vi.mocked(mockStorage.getItem).mockResolvedValue("{invalid json");

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });

    it("returns empty array for non-array JSON", async () => {
      vi.mocked(mockStorage.getItem).mockResolvedValue('{"id":"not-an-array"}');

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });

    it("filters out malformed entries (missing id)", async () => {
      const valid = makeUser({ id: "valid-1" });
      const invalid = { displayName: "No ID", username: "noid" };
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([valid, invalid]),
      );

      const result = await loadCachedUsers();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid-1");
    });

    it("filters out malformed entries (missing displayName)", async () => {
      const invalid = { id: "u-1", username: "nodisplay" };
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([invalid]),
      );

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });

    it("filters out malformed entries (missing username)", async () => {
      const invalid = { id: "u-1", displayName: "No Username" };
      vi.mocked(mockStorage.getItem).mockResolvedValue(
        JSON.stringify([invalid]),
      );

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });

    it("returns empty array when storage throws", async () => {
      vi.mocked(mockStorage.getItem).mockRejectedValue(
        new Error("Storage unavailable"),
      );

      const result = await loadCachedUsers();

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // cacheUsers
  // -----------------------------------------------------------------------

  describe("cacheUsers", () => {
    it("stores users in the in-memory cache", async () => {
      const users = makeUsers(3);

      await cacheUsers(users);

      // loadCachedUsers should return cached data without hitting storage
      const result = await loadCachedUsers();
      expect(result).toHaveLength(3);
    });

    it("writes serialized data to storage via setItem", async () => {
      const users = makeUsers(2);

      await cacheUsers(users);

      expect(vi.mocked(mockStorage.setItem)).toHaveBeenCalledWith(
        "local_user_cache",
        expect.any(String),
      );
      // Verify the stored value is valid JSON
      const storedArg = vi.mocked(mockStorage.setItem).mock.calls[0][1];
      const parsed = JSON.parse(storedArg);
      expect(parsed).toHaveLength(2);
    });

    it("clamps to MAX_CACHED_USERS (50)", async () => {
      const manyUsers = makeUsers(100);

      await cacheUsers(manyUsers);

      const result = await loadCachedUsers();
      expect(result).toHaveLength(50);
    });

    it("keeps the in-memory cache when storage write fails", async () => {
      vi.mocked(mockStorage.setItem).mockRejectedValue(
        new Error("Storage full"),
      );
      const users = makeUsers(2);

      await cacheUsers(users);

      // In-memory cache should still be valid
      const result = await loadCachedUsers();
      expect(result).toHaveLength(2);
    });

    it("replaces previous cache entirely", async () => {
      await cacheUsers(makeUsers(2));
      await cacheUsers(makeUsers(1));

      const result = await loadCachedUsers();
      expect(result).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // cacheUser
  // -----------------------------------------------------------------------

  describe("cacheUser", () => {
    it("adds a new user to an empty cache", async () => {
      const user = makeUser({ id: "new-user", displayName: "New User" });

      await cacheUser(user);

      const result = await loadCachedUsers();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("new-user");
    });

    it("updates an existing user by id", async () => {
      await cacheUsers([makeUser({ id: "u-1", displayName: "Original" })]);

      await cacheUser(makeUser({ id: "u-1", displayName: "Updated" }));

      const result = await loadCachedUsers();
      expect(result).toHaveLength(1);
      expect(result[0].displayName).toBe("Updated");
    });

    it("appends a new user to existing cache", async () => {
      await cacheUsers([makeUser({ id: "u-1" })]);

      await cacheUser(makeUser({ id: "u-2", displayName: "Second" }));

      const result = await loadCachedUsers();
      expect(result).toHaveLength(2);
      expect(result[1].displayName).toBe("Second");
    });

    it("handles storage write failure without affecting in-memory cache", async () => {
      vi.mocked(mockStorage.setItem).mockRejectedValue(
        new Error("Storage full"),
      );

      await cacheUser(makeUser({ id: "u-1" }));

      // In-memory cache should have the user
      const result = await loadCachedUsers();
      expect(result).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // removeCachedUser
  // -----------------------------------------------------------------------

  describe("removeCachedUser", () => {
    it("removes an existing user by id", async () => {
      await cacheUsers([
        makeUser({ id: "u-1" }),
        makeUser({ id: "u-2" }),
        makeUser({ id: "u-3" }),
      ]);

      await removeCachedUser("u-2");

      const result = await loadCachedUsers();
      expect(result).toHaveLength(2);
      expect(result.find((u) => u.id === "u-2")).toBeUndefined();
    });

    it("does nothing when the id does not exist", async () => {
      await cacheUsers([makeUser({ id: "u-1" })]);

      await removeCachedUser("non-existent");

      const result = await loadCachedUsers();
      expect(result).toHaveLength(1);
    });

    it("does nothing when the cache is empty", async () => {
      await removeCachedUser("u-1");

      // Still an empty array (no crash)
      const result = await loadCachedUsers();
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // clearUserCache
  // -----------------------------------------------------------------------

  describe("clearUserCache", () => {
    it("clears the in-memory cache", async () => {
      await cacheUsers(makeUsers(3));

      await clearUserCache();

      const result = await loadCachedUsers();
      expect(result).toEqual([]);
    });

    it("removes the storage key", async () => {
      await cacheUsers(makeUsers(1));

      await clearUserCache();

      expect(vi.mocked(mockStorage.removeItem)).toHaveBeenCalledWith(
        "local_user_cache",
      );
    });

    it("handles storage failure without error (non-fatal)", async () => {
      await cacheUsers(makeUsers(1));
      vi.mocked(mockStorage.removeItem).mockRejectedValue(
        new Error("Storage unavailable"),
      );

      // Should not throw
      await expect(clearUserCache()).resolves.toBeUndefined();

      // In-memory cache should still be cleared
      const result = await loadCachedUsers();
      expect(result).toEqual([]);
    });
  });
});
