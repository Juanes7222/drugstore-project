/**
 * Unit tests for the screen-access role matrix.
 *
 * Covers: per-group admission (including same-level boundary ties), the
 * legacy ADMIN parity with OWNER, and deny-by-default semantics for null
 * sessions, unknown roles, and unmapped screens.
 *
 * Admission semantics: a screen is granted when ANY of its listed roles
 * satisfies hasMinRole, so each list is effectively collapsed to its
 * minimum hierarchy level (CASHIER/INVENTORY_ASSISTANT=0, MANAGER/
 * ACCOUNTANT=1, OWNER/ADMIN=2, SAAS_ADMIN=3). The tests below pin that
 * behaviour explicitly, including its consequences for roles that are not
 * spelled out in a list but sit at or above its minimum level.
 */
import { describe, expect, it } from "vitest";
import { RoleType } from "@pharmacy/shared-types";
import type { PosScreen } from "@/store/slices/ui-types";
import type { LocalSession } from "../../../domain/auth";
import { canAccessScreen, SCREEN_ALLOWED_ROLES } from "./screen-access";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSession = (role: RoleType | string): LocalSession => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: "cajero@pharmacy.com",
  role,
  subscriptionId: "sub-1",
  workstationId: "ws-1",
  accessToken: "access-token-abc",
  refreshToken: "refresh-token-xyz",
  expiresAt: new Date("2099-12-31"),
  sessionId: "session-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
  sessionTrust: "SERVER_VERIFIED",
});

const ALL_ROLE_VALUES: RoleType[] = Object.values(RoleType);

/** One representative screen per allow-list group, plus the explicit lists. */
const REPRESENTATIVE_SCREENS: PosScreen[] = [
  "home",
  "sales",
  "cash-shift",
  "productos-main",
  "purchases-main",
  "sales-history",
  "user-management",
  "audit-log",
  "offline-sessions",
  "fiscal",
  "printing",
  "admin-menu",
  "recovery",
  "sync-health",
];

// ---------------------------------------------------------------------------
// Missing / invalid sessions
// ---------------------------------------------------------------------------

describe("canAccessScreen", () => {
  describe("missing or invalid sessions", () => {
    it("returns false when the session is null", () => {
      const allowed = canAccessScreen(null, "home");

      expect(allowed).toBe(false);
    });

    it("returns false when the role is unknown to the local hierarchy", () => {
      // LocalSession.role is RoleType | string; an unrecognised string gets
      // level -1 in the hierarchy table and must never be admitted.
      const session = makeSession("SUPER_GESTOR");

      expect(canAccessScreen(session, "home")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ALL_ROLES screens
  // -------------------------------------------------------------------------

  describe("shared screens (ALL_ROLES)", () => {
    it.each(ALL_ROLE_VALUES)("admits %s on home", (role) => {
      expect(canAccessScreen(makeSession(role), "home")).toBe(true);
    });

    it.each(["about", "reports", "2fa-setup"] as PosScreen[])(
      "admits CASHIER on %s",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.CASHIER), screen)).toBe(
          true,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // SALES_ROLES screens — minimum listed level is CASHIER (0)
  // -------------------------------------------------------------------------

  describe("checkout flow screens (SALES_ROLES)", () => {
    it.each([RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT])(
      "admits %s on sales (level 0 ties with the CASHIER anchor)",
      (role) => {
        expect(canAccessScreen(makeSession(role), "sales")).toBe(true);
      },
    );

    it.each([
      RoleType.ACCOUNTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.ADMIN,
      RoleType.SAAS_ADMIN,
    ])("admits %s on sales", (role) => {
      expect(canAccessScreen(makeSession(role), "sales")).toBe(true);
    });

    it.each([
      "payment",
      "receipt",
      "prescriptions",
      "returns",
      "clients",
    ] as PosScreen[])("admits CASHIER on %s", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.CASHIER), screen)).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // cash-shift — explicit list without INVENTORY_ASSISTANT/ACCOUNTANT/
  // SAAS_ADMIN, but its minimum anchor is still CASHIER (0)
  // -------------------------------------------------------------------------

  describe("cash-shift", () => {
    it.each([
      RoleType.CASHIER,
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ACCOUNTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.ADMIN,
      RoleType.SAAS_ADMIN,
    ])(
      "admits %s because admission follows the minimum listed level, not exact membership",
      (role) => {
        expect(canAccessScreen(makeSession(role), "cash-shift")).toBe(true);
      },
    );
  });

  // -------------------------------------------------------------------------
  // INVENTORY_ROLES screens — minimum listed level is INVENTORY_ASSISTANT (0)
  // -------------------------------------------------------------------------

  describe("inventory screens (INVENTORY_ROLES)", () => {
    it.each([
      RoleType.INVENTORY_ASSISTANT,
      RoleType.CASHIER,
      RoleType.ACCOUNTANT,
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.ADMIN,
      RoleType.SAAS_ADMIN,
    ])(`admits %s on productos-main`, (role) => {
      expect(canAccessScreen(makeSession(role), "productos-main")).toBe(true);
    });

    it.each([
      "products",
      "inventory-lots",
      "inventory-adjustments",
      "purchases-main",
      "suppliers",
    ] as PosScreen[])("admits INVENTORY_ASSISTANT on %s", (screen) => {
      expect(
        canAccessScreen(makeSession(RoleType.INVENTORY_ASSISTANT), screen),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // MANAGEMENT_ROLES + explicit [MANAGER, OWNER, ADMIN] lists — minimum
  // listed level is MANAGER (1)
  // -------------------------------------------------------------------------

  describe("management screens (MANAGEMENT_ROLES)", () => {
    it.each([
      RoleType.MANAGER,
      RoleType.ACCOUNTANT,
      RoleType.OWNER,
      RoleType.ADMIN,
      RoleType.SAAS_ADMIN,
    ])("admits %s on sales-history", (role) => {
      expect(canAccessScreen(makeSession(role), "sales-history")).toBe(true);
    });

    it.each([RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT])(
      "denies %s on sales-history",
      (role) => {
        expect(canAccessScreen(makeSession(role), "sales-history")).toBe(
          false,
        );
      },
    );

    it.each([
      "fiscal",
      "printing",
      "license-status",
      "sync-health",
      "local-network",
    ] as PosScreen[])("admits ACCOUNTANT on %s (level tie with MANAGER)", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.ACCOUNTANT), screen)).toBe(
        true,
      );
    });

    it.each(["user-management", "audit-log", "offline-sessions"] as PosScreen[])(
      "admits ACCOUNTANT on %s despite not being listed (level tie with MANAGER)",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.ACCOUNTANT), screen)).toBe(
          true,
        );
      },
    );

    it.each(["user-management", "audit-log", "offline-sessions"] as PosScreen[])(
      "admits SAAS_ADMIN on %s via the MANAGER anchor",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.SAAS_ADMIN), screen)).toBe(
          true,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // OWNER_ROLES screens
  // -------------------------------------------------------------------------

  describe("owner-only screens (OWNER_ROLES)", () => {
    it.each([
      RoleType.OWNER,
      RoleType.ADMIN,
      RoleType.SAAS_ADMIN,
    ])("admits %s on admin-menu", (role) => {
      expect(canAccessScreen(makeSession(role), "admin-menu")).toBe(true);
    });

    it.each([
      RoleType.MANAGER,
      RoleType.ACCOUNTANT,
      RoleType.CASHIER,
      RoleType.INVENTORY_ASSISTANT,
    ])("denies %s on admin-menu", (role) => {
      expect(canAccessScreen(makeSession(role), "admin-menu")).toBe(false);
    });

    it.each([RoleType.MANAGER, RoleType.ACCOUNTANT, RoleType.CASHIER])(
      "denies %s on recovery",
      (role) => {
        expect(canAccessScreen(makeSession(role), "recovery")).toBe(false);
      },
    );

    it.each([RoleType.OWNER, RoleType.ADMIN, RoleType.SAAS_ADMIN])(
      "admits %s on recovery",
      (role) => {
        expect(canAccessScreen(makeSession(role), "recovery")).toBe(true);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Legacy ADMIN parity
  // -------------------------------------------------------------------------

  describe("legacy ADMIN role", () => {
    it.each(REPRESENTATIVE_SCREENS)(
      "grants legacy ADMIN exactly the same access as OWNER on %s",
      (screen) => {
        const adminSession = makeSession(RoleType.ADMIN);
        const ownerSession = makeSession(RoleType.OWNER);

        expect(canAccessScreen(adminSession, screen)).toBe(
          canAccessScreen(ownerSession, screen),
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Deny-by-default semantics
  // -------------------------------------------------------------------------

  describe("deny-by-default", () => {
    it("returns false for a screen missing from the map", () => {
      // Simulates a new PosScreen added to the union before the map gains
      // its entry (the Record keeps the compiler honest at build time).
      const unmappedScreen = "brand-new-screen" as PosScreen;

      expect(canAccessScreen(makeSession(RoleType.OWNER), unmappedScreen)).toBe(
        false,
      );
    });

    it.each(Object.keys(SCREEN_ALLOWED_ROLES))(
      "maps %s to a non-empty allow-list",
      (screen) => {
        expect(
          SCREEN_ALLOWED_ROLES[screen as PosScreen].length,
        ).toBeGreaterThan(0);
      },
    );
  });
});
