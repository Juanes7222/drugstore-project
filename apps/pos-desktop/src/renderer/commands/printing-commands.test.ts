/**
 * Tests for the PRINTING_COMMANDS palette array.
 */
import { describe, expect, it } from "vitest";
import { PRINTING_COMMANDS } from "./printing-commands";

describe("PRINTING_COMMANDS", () => {
  it("is a non-empty array", () => {
    expect(PRINTING_COMMANDS.length).toBeGreaterThan(0);
  });

  it("every command has a unique id", () => {
    const ids = PRINTING_COMMANDS.map((c) => c.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it("every command has required fields (id, label, labelEs, action)", () => {
    for (const cmd of PRINTING_COMMANDS) {
      expect(cmd.id).toBeDefined();
      expect(cmd.label).toBeDefined();
      expect(cmd.labelEs).toBeDefined();
      expect(cmd.action).toBeDefined();
    }
  });

  it("every command has category set to 'printing'", () => {
    for (const cmd of PRINTING_COMMANDS) {
      expect(cmd.category).toBe("printing");
    }
  });

  it("every command has minRole set", () => {
    for (const cmd of PRINTING_COMMANDS) {
      expect(cmd.minRole).toBeDefined();
    }
  });

  it("has at least one help command (id starts with 'cmd.help')", () => {
    const helpCommands = PRINTING_COMMANDS.filter((c) =>
      c.id.startsWith("cmd.help"),
    );

    expect(helpCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("has at least one queue management command", () => {
    const queueCommands = PRINTING_COMMANDS.filter((c) =>
      c.id.includes("print-queue"),
    );

    expect(queueCommands.length).toBeGreaterThanOrEqual(1);
  });

  it("each command's action starts with 'route:' or 'action:'", () => {
    for (const cmd of PRINTING_COMMANDS) {
      expect(
        cmd.action.startsWith("route:") || cmd.action.startsWith("action:"),
      ).toBe(true);
    }
  });
});
