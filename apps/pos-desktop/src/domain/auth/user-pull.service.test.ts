/**
 * Unit tests for UserPullService — the login-identities mirror
 * (`GET /users/login-identities` → avatar-grid cache + PGlite identity rows).
 *
 * Covers the fetch/apply split the scheduler relies on: the offline
 * early-return, the never-wipe-on-empty rule, the shared identity mapper,
 * per-row best-effort upserts, and the default HTTP client's error mapping
 * to UserPullHttpException.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createUserPullService,
  UserPullService,
  type LoginIdentityRow,
  type UserPullConfig,
} from "./user-pull.service";
import { UserPullHttpException } from "./exceptions";
import { DomainError } from "../../common/domain-error";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

vi.mock("../../common/is-online", () => ({
  isOnline: vi.fn(),
}));
import { isOnline } from "../../common/is-online";

vi.mock("../../common/sync-metadata", () => ({
  setUsersLastSyncedAt: vi.fn(),
  getUsersLastSyncedAt: vi.fn(),
}));
import { setUsersLastSyncedAt } from "../../common/sync-metadata";

vi.mock("./local-user-cache", () => ({
  cacheUsers: vi.fn(),
}));
import { cacheUsers } from "./local-user-cache";

const upsertUserIdentityMock = vi.hoisted(() => vi.fn());

vi.mock("./user-cache.service", () => ({
  createUserCacheService: vi.fn(() => ({
    upsertUserIdentity: upsertUserIdentityMock,
  })),
}));
import { createUserCacheService } from "./user-cache.service";

// ---------------------------------------------------------------------------
// Factory helpers (data construction only — no assertions hidden here)
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:3000";
const IDENTITIES_URL = `${BASE_URL}/users/login-identities?limit=100`;

const makeRow = (overrides: Partial<LoginIdentityRow> = {}): LoginIdentityRow => ({
  id: "user-1",
  displayName: "Cajero Uno",
  username: "cajero1",
  role: "CASHIER",
  hasPin: true,
  hasPassword: false,
  ...overrides,
});

const makeHttp = (): SyncHttpClient => ({ get: vi.fn() });

const makeService = (
  overrides: Partial<UserPullConfig> = {},
  http: SyncHttpClient = makeHttp(),
): { service: UserPullService; http: SyncHttpClient } => ({
  service: createUserPullService({ baseUrl: BASE_URL, ...overrides, httpClient: http }),
  http,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("UserPullService", () => {
  beforeEach(() => {
    vi.mocked(isOnline).mockReset();
    vi.mocked(isOnline).mockReturnValue(true);
    vi.mocked(cacheUsers).mockReset();
    vi.mocked(cacheUsers).mockResolvedValue(undefined);
    upsertUserIdentityMock.mockReset();
    upsertUserIdentityMock.mockResolvedValue(undefined);
    vi.mocked(setUsersLastSyncedAt).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("fetchUserIdentities", () => {
    it("requests the login-identities endpoint with Bearer and offline-token headers", async () => {
      const { service, http } = makeService({ accessToken: "access-1", offlineToken: "offline-1" });
      vi.mocked(http.get).mockResolvedValue({ users: [makeRow()] });

      const rows = await service.fetchUserIdentities();

      expect(http.get).toHaveBeenCalledWith(IDENTITIES_URL, {
        Authorization: "Bearer access-1",
        "X-Offline-Token": "offline-1",
      });
      expect(rows).toEqual([makeRow()]);
    });

    it("omits the auth headers that have no token configured", async () => {
      const { service, http } = makeService();
      vi.mocked(http.get).mockResolvedValue({ users: [] });

      await service.fetchUserIdentities();

      expect(http.get).toHaveBeenCalledWith(IDENTITIES_URL, {});
    });

    it("trims trailing slashes from the base URL", async () => {
      const { service, http } = makeService({ baseUrl: `${BASE_URL}///` });
      vi.mocked(http.get).mockResolvedValue({ users: [] });

      await service.fetchUserIdentities();

      expect(http.get).toHaveBeenCalledWith(IDENTITIES_URL, expect.anything());
    });

    it("returns an empty list when the payload carries no users array", async () => {
      const { service, http } = makeService();
      vi.mocked(http.get).mockResolvedValue({});

      const rows = await service.fetchUserIdentities();

      expect(rows).toEqual([]);
    });
  });

  describe("applyUserIdentities", () => {
    it("refreshes the avatar-grid cache through the shared identity mapper", async () => {
      const { service } = makeService();

      await service.applyUserIdentities([
        makeRow({
          id: "user-9",
          displayName: "Ana Gerente",
          username: "ana",
          role: "MANAGER",
          avatarUrl: "https://cdn.example.com/a.png",
          avatarColor: "#123456",
          hasPin: false,
          hasPassword: true,
        }),
      ]);

      expect(cacheUsers).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "user-9",
          displayName: "Ana Gerente",
          username: "ana",
          role: "MANAGER",
          avatarUrl: "https://cdn.example.com/a.png",
          avatarColor: "#123456",
          hasPin: false,
          hasPassword: true,
        }),
      ]);
    });

    it("falls back to fullName and then username when displayName is missing", async () => {
      const { service } = makeService();

      await service.applyUserIdentities([
        makeRow({ id: "user-a", displayName: undefined, fullName: "Nombre Completo", username: "usera" }),
        makeRow({ id: "user-b", displayName: undefined, fullName: undefined, username: "userb" }),
      ]);

      expect(upsertUserIdentityMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "user-a", displayName: "Nombre Completo" }),
      );
      expect(upsertUserIdentityMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "user-b", displayName: "userb" }),
      );
    });

    it("never wipes the grid cache on an empty response but still records the sync timestamp", async () => {
      // Some sessions legitimately receive `{ users: [] }` — replacing a
      // populated grid with nothing would hide every user pre-login.
      const { service } = makeService();

      await service.applyUserIdentities([]);

      expect(cacheUsers).not.toHaveBeenCalled();
      expect(upsertUserIdentityMock).not.toHaveBeenCalled();
      expect(setUsersLastSyncedAt).toHaveBeenCalledWith(expect.any(String));
    });

    it("upserts the remaining identities when one row fails", async () => {
      const { service } = makeService();
      upsertUserIdentityMock.mockRejectedValueOnce(new Error("bad row"));

      await service.applyUserIdentities([makeRow({ id: "user-a" }), makeRow({ id: "user-b" })]);

      expect(upsertUserIdentityMock).toHaveBeenCalledTimes(2);
      expect(setUsersLastSyncedAt).toHaveBeenCalledTimes(1);
    });

    it("records usersLastSyncedAt with a parseable timestamp after a successful apply", async () => {
      const { service } = makeService();

      await service.applyUserIdentities([makeRow()]);

      expect(setUsersLastSyncedAt).toHaveBeenCalledTimes(1);
      const written = vi.mocked(setUsersLastSyncedAt).mock.calls[0][0];
      expect(Number.isNaN(new Date(written).getTime())).toBe(false);
    });
  });

  describe("pullUserIdentities", () => {
    it("returns early without touching network or cache when offline", async () => {
      vi.mocked(isOnline).mockReturnValue(false);
      const { service, http } = makeService();
      vi.mocked(http.get).mockResolvedValue({ users: [makeRow()] });

      await service.pullUserIdentities();

      expect(http.get).not.toHaveBeenCalled();
      expect(cacheUsers).not.toHaveBeenCalled();
      expect(setUsersLastSyncedAt).not.toHaveBeenCalled();
    });

    it("fetches then applies when online", async () => {
      const { service, http } = makeService({ accessToken: "access-1" });
      vi.mocked(http.get).mockResolvedValue({ users: [makeRow()] });

      await service.pullUserIdentities();

      expect(http.get).toHaveBeenCalledTimes(1);
      expect(cacheUsers).toHaveBeenCalledTimes(1);
      expect(setUsersLastSyncedAt).toHaveBeenCalledTimes(1);
    });
  });

  describe("createUserPullService", () => {
    it("returns a UserPullService instance", () => {
      const { service } = makeService();

      expect(service).toBeInstanceOf(UserPullService);
    });

    it("builds the identity cache lazily per apply, not per construction", async () => {
      const { service } = makeService();

      await service.applyUserIdentities([makeRow()]);

      expect(createUserCacheService).toHaveBeenCalled();
    });
  });

  describe("default HTTP client", () => {
    it("throws UserPullHttpException carrying status and body on HTTP errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("forbidden-body", { status: 403 })),
      );
      const service = createUserPullService({ baseUrl: BASE_URL, accessToken: "access-1" });

      const error = await service.fetchUserIdentities().catch((err: unknown) => err);

      expect(error).toBeInstanceOf(UserPullHttpException);
      expect(error).toBeInstanceOf(DomainError);
      expect((error as UserPullHttpException).errorCode).toBe("USER_PULL_FAILED");
      expect((error as UserPullHttpException).statusCode).toBe(403);
      expect((error as UserPullHttpException).responseBody).toBe("forbidden-body");
    });

    it("returns the parsed payload when the response is ok", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ users: [makeRow()] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
      const service = createUserPullService({ baseUrl: BASE_URL });

      const rows = await service.fetchUserIdentities();

      expect(rows).toEqual([makeRow()]);
    });
  });
});
