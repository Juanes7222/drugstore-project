/**
 * Unit tests for the screen-access role matrix.
 *
 * Admission semantics: EXACT membership. A screen is granted only when the
 * session's role appears verbatim in its allow-list — no hierarchy
 * collapse. The earlier hasMinRole behaviour silently admitted same-level
 * roles the lists never named (an ACCOUNTANT opened every manager screen
 * and then hit server 403s behind nearly every request), so these tests
 * pin the exact-membership contract instead, including its consequences:
 * SAAS_ADMIN is denied on the screens that spell out [MANAGER, OWNER,
 * ADMIN] only, and fiscal follows OWNER_ROLES because the server rejects
 * MANAGER on the certificate/config endpoints behind it.
 *
 * Covered: per-group admission, deny-by-default semantics (null sessions,
 * unknown role strings, unmapped screens), legacy ADMIN parity with OWNER,
 * and an exhaustive screen-by-role matrix derived from the documented
 * groups below.
 *
 * The expected ALL_ROLES membership is spelled out explicitly instead of
 * Object.values(RoleType): array equality is order-sensitive, and the
 * shared enum's declaration order is free to change without any access
 * semantic changing (a reordering here once produced ten false failures).
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

/** All seven roles, in the order the source lists them. Explicit (not
 *  Object.values(RoleType)) so enum declaration order cannot flip these
 *  comparisons; the completeness guard below catches new/removed roles. */
const ALL_ROLES_EXPECTED: RoleType[] = [
  RoleType.CASHIER,
  RoleType.INVENTORY_ASSISTANT,
  RoleType.ACCOUNTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

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
// Documented access groups (mirrors the contract in screen-access.ts;
// declared here independently so source drift fails these tests)
// ---------------------------------------------------------------------------

const PRE_AUTH_SCREENS: PosScreen[] = [
  "login",
  "forgot-password",
  "reset-password",
  "company-setup",
  "certificate-setup",
  "licensing-plans",
];

const ALL_ROLES_SCREENS: PosScreen[] = [
  ...PRE_AUTH_SCREENS,
  "home",
  "about",
  "reports",
  "2fa-setup",
];

const FLOOR_SCREENS: PosScreen[] = [
  "sales",
  "payment",
  "receipt",
  "prescriptions",
  "returns",
  "clients",
  "cash-shift",
];

const INVENTORY_SCREENS: PosScreen[] = [
  "productos-main",
  "products",
  "inventory-lots",
  "inventory-adjustments",
  "purchases-main",
  "suppliers",
  "purchase-orders",
  "purchase-receptions",
  "supplier-returns",
];

const SALES_HISTORY_SCREENS: PosScreen[] = ["sales-history"];

const SALES_HISTORY_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

const MANAGEMENT_SCREENS: PosScreen[] = [
  "license-status",
  "printing",
  "printers",
  "print-queue",
  "setup-wizard",
  "sync-health",
  "local-network",
];

/** Screens whose list names MANAGER/OWNER/ADMIN explicitly (no SAAS_ADMIN). */
const MANAGER_OWNER_ADMIN_SCREENS: PosScreen[] = [
  "user-management",
  "audit-log",
  "offline-sessions",
];

const OWNER_SCREENS: PosScreen[] = ["fiscal", "admin-menu", "recovery"];

const FLOOR_ROLES: RoleType[] = [
  RoleType.CASHIER,
  RoleType.INVENTORY_ASSISTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

const INVENTORY_ROLES: RoleType[] = [
  RoleType.INVENTORY_ASSISTANT,
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

const MANAGEMENT_ROLES: RoleType[] = [
  RoleType.MANAGER,
  RoleType.OWNER,
  RoleType.ADMIN,
  RoleType.SAAS_ADMIN,
];

const OWNER_ROLES: RoleType[] = [RoleType.OWNER, RoleType.ADMIN, RoleType.SAAS_ADMIN];

const EVERY_MAPPED_SCREEN: PosScreen[] = [
  ...ALL_ROLES_SCREENS,
  ...FLOOR_SCREENS,
  ...INVENTORY_SCREENS,
  ...SALES_HISTORY_SCREENS,
  ...MANAGEMENT_SCREENS,
  ...MANAGER_OWNER_ADMIN_SCREENS,
  ...OWNER_SCREENS,
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

    it("denies an unknown role string on every kind of screen", () => {
      // LocalSession.role is RoleType | string; an unrecognised string is
      // not member of any allow-list under exact membership.
      const session = makeSession("SUPER_GESTOR");

      expect(canAccessScreen(session, "home")).toBe(false);
      expect(canAccessScreen(session, "sales")).toBe(false);
      expect(canAccessScreen(session, "productos-main")).toBe(false);
      expect(canAccessScreen(session, "admin-menu")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // RoleType completeness — a new role must be decided, not silently leak
  // -------------------------------------------------------------------------

  describe("RoleType completeness", () => {
    it("declares exactly the seven roles this matrix documents", () => {
      expect([...Object.values(RoleType)].sort()).toEqual(
        [...ALL_ROLES_EXPECTED].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // ALL_ROLES screens
  // -------------------------------------------------------------------------

  describe("shared screens (ALL_ROLES)", () => {
    it.each(ALL_ROLES_EXPECTED)("admits %s on home", (role) => {
      expect(canAccessScreen(makeSession(role), "home")).toBe(true);
    });

    it.each(ALL_ROLES_SCREENS)("admits CASHIER on %s", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.CASHIER), screen)).toBe(
        true,
      );
    });

    it.each(ALL_ROLES_SCREENS)(
      "admits ACCOUNTANT on %s (its only admitted group)",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.ACCOUNTANT), screen)).toBe(
          true,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Floor screens — exact list, ACCOUNTANT excluded
  // -------------------------------------------------------------------------

  describe("checkout flow screens (FLOOR_ROLES)", () => {
    it.each(FLOOR_ROLES)("admits %s on sales", (role) => {
      expect(canAccessScreen(makeSession(role), "sales")).toBe(true);
    });

    it.each(FLOOR_SCREENS)("admits INVENTORY_ASSISTANT on %s", (screen) => {
      expect(
        canAccessScreen(makeSession(RoleType.INVENTORY_ASSISTANT), screen),
      ).toBe(true);
    });

    it.each(FLOOR_SCREENS)(
      "denies ACCOUNTANT on %s despite sharing the MANAGER hierarchy level",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.ACCOUNTANT), screen)).toBe(
          false,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Inventory screens — CASHIER and ACCOUNTANT are not members
  // -------------------------------------------------------------------------

  describe("inventory screens (INVENTORY_ROLES)", () => {
    it.each(INVENTORY_ROLES)("admits %s on productos-main", (role) => {
      expect(canAccessScreen(makeSession(role), "productos-main")).toBe(true);
    });

    it.each(INVENTORY_SCREENS)(
      "admits INVENTORY_ASSISTANT on %s",
      (screen) => {
        expect(
          canAccessScreen(makeSession(RoleType.INVENTORY_ASSISTANT), screen),
        ).toBe(true);
      },
    );

    it.each([RoleType.CASHIER, RoleType.ACCOUNTANT])(
      "denies %s on productos-main",
      (role) => {
        expect(canAccessScreen(makeSession(role), "productos-main")).toBe(
          false,
        );
      },
    );

    it.each(INVENTORY_SCREENS)("denies CASHIER on %s", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.CASHIER), screen)).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Management screens — ACCOUNTANT deliberately absent
  // -------------------------------------------------------------------------

  describe("sales-history screen (SALES_HISTORY_ROLES — cashier read-only)", () => {
    it.each(SALES_HISTORY_ROLES)("admits %s on sales-history", (role) => {
      expect(canAccessScreen(makeSession(role), "sales-history")).toBe(true);
    });

    it.each([RoleType.INVENTORY_ASSISTANT, RoleType.ACCOUNTANT])(
      "denies %s on sales-history",
      (role) => {
        expect(canAccessScreen(makeSession(role), "sales-history")).toBe(
          false,
        );
      },
    );
  });

  describe("management screens (MANAGEMENT_ROLES)", () => {
    it.each(MANAGEMENT_SCREENS)(
      "denies ACCOUNTANT on %s (not listed even at the MANAGER level)",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.ACCOUNTANT), screen)).toBe(
          false,
        );
      },
    );

    it.each(MANAGEMENT_SCREENS)("admits MANAGER on %s", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.MANAGER), screen)).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Explicit [MANAGER, OWNER, ADMIN] screens — SAAS_ADMIN denied too
  // -------------------------------------------------------------------------

  describe("explicitly listed screens ([MANAGER, OWNER, ADMIN])", () => {
    it.each([
      RoleType.MANAGER,
      RoleType.OWNER,
      RoleType.ADMIN,
    ] as const)("admits %s on user-management", (role) => {
      expect(canAccessScreen(makeSession(role), "user-management")).toBe(true);
    });

    it.each([
      RoleType.CASHIER,
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ACCOUNTANT,
      RoleType.SAAS_ADMIN,
    ])("denies %s on user-management", (role) => {
      expect(canAccessScreen(makeSession(role), "user-management")).toBe(
        false,
      );
    });

    it.each(MANAGER_OWNER_ADMIN_SCREENS)(
      "denies SAAS_ADMIN on %s because exact membership does not consult hierarchy",
      (screen) => {
        expect(canAccessScreen(makeSession(RoleType.SAAS_ADMIN), screen)).toBe(
          false,
        );
      },
    );

    it.each(MANAGER_OWNER_ADMIN_SCREENS)("admits ADMIN on %s", (screen) => {
      expect(canAccessScreen(makeSession(RoleType.ADMIN), screen)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Owner-only screens — fiscal moved here with admin-menu and recovery
  // -------------------------------------------------------------------------

  describe("owner-only screens (OWNER_ROLES)", () => {
    it.each(OWNER_ROLES)("admits %s on admin-menu", (role) => {
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

    it.each(OWNER_ROLES)("admits %s on recovery", (role) => {
      expect(canAccessScreen(makeSession(role), "recovery")).toBe(true);
    });

    it.each([RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ACCOUNTANT])(
      "denies %s on recovery",
      (role) => {
        expect(canAccessScreen(makeSession(role), "recovery")).toBe(false);
      },
    );

    // The server answers 403 to MANAGER on the fiscal certificate/config
    // endpoints, so the fiscal screen follows OWNER_ROLES, not
    // MANAGEMENT_ROLES.
    it.each([RoleType.OWNER, RoleType.ADMIN, RoleType.SAAS_ADMIN])(
      "admits %s on fiscal",
      (role) => {
        expect(canAccessScreen(makeSession(role), "fiscal")).toBe(true);
      },
    );

    it("denies MANAGER on fiscal (server rejects its certificate/config requests)", () => {
      expect(canAccessScreen(makeSession(RoleType.MANAGER), "fiscal")).toBe(
        false,
      );
    });

    it.each([RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ACCOUNTANT])(
      "denies %s on fiscal",
      (role) => {
        expect(canAccessScreen(makeSession(role), "fiscal")).toBe(false);
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

  // -------------------------------------------------------------------------
  // Exhaustive matrix — every mapped screen behaves exactly as its
  // documented group prescribes, for all seven roles.
  // -------------------------------------------------------------------------

  describe("exhaustive screen-by-role matrix", () => {
    interface GroupExpectation {
      screens: PosScreen[];
      admitted: RoleType[];
    }

    const EXPECTED_GROUPS: GroupExpectation[] = [
      { screens: ALL_ROLES_SCREENS, admitted: ALL_ROLES_EXPECTED },
      { screens: FLOOR_SCREENS, admitted: FLOOR_ROLES },
      { screens: INVENTORY_SCREENS, admitted: INVENTORY_ROLES },
      { screens: SALES_HISTORY_SCREENS, admitted: SALES_HISTORY_ROLES },
      { screens: MANAGEMENT_SCREENS, admitted: MANAGEMENT_ROLES },
      {
        screens: MANAGER_OWNER_ADMIN_SCREENS,
        admitted: [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
      },
      { screens: OWNER_SCREENS, admitted: OWNER_ROLES },
    ];

    it("covers every entry of SCREEN_ALLOWED_ROLES exactly once", () => {
      // EVERY_MAPPED_SCREEN is the flat union of all documented groups. If a
      // screen were listed in two groups it would appear twice here, so the
      // length mismatch against the map's unique keys fails the assertion.
      expect([...EVERY_MAPPED_SCREEN].sort()).toEqual(
        Object.keys(SCREEN_ALLOWED_ROLES).sort(),
      );
    });

    it.each(EXPECTED_GROUPS.flatMap(({ screens, admitted }) =>
      screens.map((screen) => ({ screen, admitted })),
    ))("maps $screen exactly to its documented roles", ({ screen, admitted }) => {
      expect(SCREEN_ALLOWED_ROLES[screen]).toEqual(admitted);
    });

    it.each(EXPECTED_GROUPS.flatMap(({ screens, admitted }) =>
      screens.flatMap((screen) =>
        ALL_ROLES_EXPECTED.map((role) => ({
          screen,
          role,
          expected: admitted.includes(role),
        })),
      ),
    ))("resolves $role on $screen to $expected", ({
      screen,
      role,
      expected,
    }) => {
      expect(canAccessScreen(makeSession(role), screen)).toBe(expected);
    });
  });
});
