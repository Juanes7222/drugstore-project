/**
 * Unit tests for local-users module — PLACEHOLDER_USERS fixture.
 */
import { describe, expect, it } from "vitest";
import { RoleType } from "@pharmacy/shared-types";
import { PLACEHOLDER_USERS } from "./local-users";

describe("PLACEHOLDER_USERS", () => {
  it("contains exactly 4 entries", () => {
    expect(PLACEHOLDER_USERS).toHaveLength(4);
  });

  it("has one OWNER, one MANAGER, and two CASHIERs", () => {
    const owners = PLACEHOLDER_USERS.filter((u) => u.role === RoleType.OWNER);
    const managers = PLACEHOLDER_USERS.filter((u) => u.role === RoleType.MANAGER);
    const cashiers = PLACEHOLDER_USERS.filter((u) => u.role === RoleType.CASHIER);

    expect(owners).toHaveLength(1);
    expect(managers).toHaveLength(1);
    expect(cashiers).toHaveLength(2);
  });

  it("every entry has all required fields populated", () => {
    for (const user of PLACEHOLDER_USERS) {
      expect(user.id).toBeTruthy();
      expect(user.displayName).toBeTruthy();
      expect(user.username).toBeTruthy();
      expect(user.role).toBeDefined();
      // avatarUrl and avatarColor can be null, but avatarColor must exist
      expect(user.avatarColor).toBeTruthy();
    }
  });

  it("no two users share the same id", () => {
    const ids = PLACEHOLDER_USERS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("users have expected ids matching their roles", () => {
    const owner = PLACEHOLDER_USERS.find((u) => u.role === RoleType.OWNER);
    expect(owner?.id).toBe("owner-1");

    const manager = PLACEHOLDER_USERS.find((u) => u.role === RoleType.MANAGER);
    expect(manager?.id).toBe("manager-1");

    const cashiers = PLACEHOLDER_USERS.filter((u) => u.role === RoleType.CASHIER);
    expect(cashiers.map((c) => c.id).sort()).toEqual(["cashier-1", "cashier-2"]);
  });
});
