/**
 * Tests for the assistant command registry and role-based filtering.
 */
import { describe, expect, it } from "vitest";
import { COMMANDS, getCommandsForRole } from "./commands";

describe("COMMANDS", () => {
  it("defines at least 15 commands", () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(15);
  });

  it("every command has required fields", () => {
    for (const cmd of COMMANDS) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(cmd.group).toBeTruthy();
      expect(cmd.audience).toMatch(/^(cashier|manager|both)$/);
      expect(typeof cmd.execute).toBe("function");
    }
  });

  it("includes a 'Nueva venta' command for both roles", () => {
    const newSale = COMMANDS.find((c) => c.id === "cmd.new-sale");
    expect(newSale).toBeDefined();
    expect(newSale!.audience).toBe("both");
  });

  it("includes manager-only commands", () => {
    const managerOnly = COMMANDS.filter((c) => c.audience === "manager");
    expect(managerOnly.length).toBeGreaterThan(0);
  });

  it("includes cashier-only commands", () => {
    const cashierOnly = COMMANDS.filter((c) => c.audience === "cashier");
    expect(cashierOnly.length).toBeGreaterThan(0);
  });
});

describe("getCommandsForRole", () => {
  it("returns all commands for MANAGER role", () => {
    const result = getCommandsForRole("MANAGER");
    expect(result).toEqual(COMMANDS);
  });

  it("returns all commands for ADMIN role", () => {
    const result = getCommandsForRole("ADMIN");
    expect(result).toEqual(COMMANDS);
  });

  it("returns all commands for OWNER role", () => {
    const result = getCommandsForRole("OWNER");
    expect(result).toEqual(COMMANDS);
  });

  it("filters manager commands for CASHIER role", () => {
    const result = getCommandsForRole("CASHIER");

    for (const cmd of result) {
      expect(cmd.audience === "cashier" || cmd.audience === "both").toBe(true);
    }
  });

  it("does not include manager-only commands for cashier", () => {
    const result = getCommandsForRole("CASHIER");
    const managerIds = COMMANDS.filter((c) => c.audience === "manager").map((c) => c.id);
    const resultIds = result.map((c) => c.id);

    for (const id of managerIds) {
      expect(resultIds).not.toContain(id);
    }
  });

  it("returns only cashier+both when role is null", () => {
    const result = getCommandsForRole(null);

    for (const cmd of result) {
      expect(cmd.audience === "cashier" || cmd.audience === "both").toBe(true);
    }
  });

  it("returns empty intersection for unknown role", () => {
    const result = getCommandsForRole("GUEST");
    const guestIds = result.map((c) => c.id);
    const bothOrCashierIds = COMMANDS.filter(
      (c) => c.audience === "cashier" || c.audience === "both",
    ).map((c) => c.id);

    expect(guestIds).toEqual(bothOrCashierIds);
  });
});
