/**
 * Tests for DomainError — the framework-free base error class.
 *
 * Every domain exception in this application extends DomainError, so
 * getting the base class right matters for catch-block discrimination.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "./domain-error";

describe("DomainError", () => {
  it("sets errorCode and message from constructor arguments", () => {
    const error = new DomainError("SHIFT_ALREADY_OPEN", "A shift is already open for this workstation");

    expect(error.errorCode).toBe("SHIFT_ALREADY_OPEN");
    expect(error.message).toBe("A shift is already open for this workstation");
  });

  it("is an instance of the built-in Error class", () => {
    const error = new DomainError("TEST_CODE", "test message");

    expect(error).toBeInstanceOf(Error);
  });

  it("carries its constructor name as the name property", () => {
    const error = new DomainError("TEST_CODE", "test message");

    expect(error.name).toBe("DomainError");
  });

  it("captures a stack trace when thrown and caught", () => {
    const error = new DomainError("THROW_TEST", "thrown to check stack");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("DomainError");
  });
});
