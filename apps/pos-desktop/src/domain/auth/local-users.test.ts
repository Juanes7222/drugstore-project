/**
 * Unit tests for local-users module — mapServerUserToLocalUserInfo.
 */
import { describe, expect, it } from "vitest";
import { mapServerUserToLocalUserInfo } from "./local-users";

describe("mapServerUserToLocalUserInfo", () => {
  it("maps displayName when present", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-1",
      displayName: "Juan Pérez",
      role: "CASHIER",
    });

    expect(result).toEqual({
      id: "u-1",
      displayName: "Juan Pérez",
      role: "CASHIER",
      avatarUrl: null,
      avatarColor: null,
      username: "",
    });
  });

  it("falls back to fullName when displayName is absent", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-2",
      fullName: "María Rodríguez",
      role: "MANAGER",
    });

    expect(result.displayName).toBe("María Rodríguez");
  });

  it("defaults displayName to empty string when both displayName and fullName are absent", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-3",
      role: "OWNER",
    });

    expect(result.displayName).toBe("");
  });

  it("passes through avatarUrl and avatarColor", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-4",
      displayName: "Carlos",
      role: "CASHIER",
      avatarUrl: "https://example.com/avatar.png",
      avatarColor: "#FF5733",
    });

    expect(result.avatarUrl).toBe("https://example.com/avatar.png");
    expect(result.avatarColor).toBe("#FF5733");
  });

  it("maps username when present", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-5",
      displayName: "Luisa",
      role: "CASHIER",
      username: "luisa.garcia",
    });

    expect(result.username).toBe("luisa.garcia");
  });

  it("defaults username to empty string when absent", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-6",
      displayName: "Pedro",
      role: "CASHIER",
    });

    expect(result.username).toBe("");
  });

  it("coerces role as-is (caller must validate against RoleType)", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-7",
      displayName: "Admin",
      role: "ADMIN",
    });

    expect(result.role).toBe("ADMIN");
  });

  it("defaults avatarUrl and avatarColor to null when absent", () => {
    const result = mapServerUserToLocalUserInfo({
      id: "u-8",
      displayName: "Test",
      role: "CASHIER",
    });

    expect(result.avatarUrl).toBeNull();
    expect(result.avatarColor).toBeNull();
  });
});
