import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import { InvalidCredentialsException, NoActiveSessionException, InsufficientRoleException, UserPullHttpException } from "./exceptions";

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

describe("UserPullHttpException", () => {
  it("has errorCode USER_PULL_FAILED", () => {
    const error = new UserPullHttpException("http://localhost:3000/users/login-identities?limit=100", 403, "Forbidden");

    expect(error.errorCode).toBe("USER_PULL_FAILED");
  });

  it("carries the HTTP status code and response body for programmatic handling", () => {
    const error = new UserPullHttpException("http://localhost:3000/users/login-identities?limit=100", 403, "Forbidden");

    expect(error.statusCode).toBe(403);
    expect(error.responseBody).toBe("Forbidden");
  });

  it("mentions the status code and URL in the message so the scheduler's fallback matcher sees 403", () => {
    const url = "http://localhost:3000/users/login-identities?limit=100";
    const error = new UserPullHttpException(url, 403, "Forbidden");

    expect(error.message).toContain("403");
    expect(error.message).toContain(url);
  });

  it("is a DomainError", () => {
    const error = new UserPullHttpException("http://localhost:3000/users/login-identities?limit=100", 500, "boom");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe("UserPullHttpException");
  });
});
