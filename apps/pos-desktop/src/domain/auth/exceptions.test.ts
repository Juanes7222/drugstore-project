import { describe, expect, it } from "vitest";
import { InvalidCredentialsException, NoActiveSessionException, InsufficientRoleException } from "./exceptions";

describe("InvalidCredentialsException", () => {
  it("has errorCode INVALID_CREDENTIALS", () => {
    const error = new InvalidCredentialsException();
    expect(error.errorCode).toBe("INVALID_CREDENTIALS");
  });

  it("has a descriptive message", () => {
    const error = new InvalidCredentialsException();
    expect(error.message).toContain("username or password");
  });

  it("is instance of DomainError via Error", () => {
    const error = new InvalidCredentialsException();
    expect(error.name).toBe("InvalidCredentialsException");
  });
});

describe("NoActiveSessionException", () => {
  it("has errorCode NO_ACTIVE_SESSION", () => {
    const error = new NoActiveSessionException();
    expect(error.errorCode).toBe("NO_ACTIVE_SESSION");
  });

  it("includes login hint in message", () => {
    const error = new NoActiveSessionException();
    expect(error.message).toContain("logged in");
  });
});

describe("InsufficientRoleException", () => {
  it("has errorCode INSUFFICIENT_ROLE", () => {
    const error = new InsufficientRoleException("ADMIN");
    expect(error.errorCode).toBe("INSUFFICIENT_ROLE");
  });

  it("includes the required role in the message", () => {
    const error = new InsufficientRoleException("MANAGER");
    expect(error.message).toContain("MANAGER");
  });
});
