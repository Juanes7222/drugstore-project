/**
 * Unit tests for offline auth domain exceptions.
 *
 * Covers every exception class exported from the offline auth module:
 * errorCode, message, and DomainError inheritance.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../../common/domain-error";
import {
  NoOfflineCredentialsException,
  OfflineCredentialsExpiredException,
  OfflineTokenRevokedException,
  OfflineTokenExpiredException,
  OfflineWorkstationMismatchException,
  OfflineBlessingRequiredException,
  SecureStorageUnavailableException,
  ClockDriftException,
} from "./exceptions";

describe("NoOfflineCredentialsException", () => {
  const error = new NoOfflineCredentialsException();

  it("has errorCode NO_OFFLINE_CREDENTIALS", () => {
    expect(error.errorCode).toBe("NO_OFFLINE_CREDENTIALS");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("No cached credentials");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe("NoOfflineCredentialsException");
  });
});

describe("OfflineCredentialsExpiredException", () => {
  const error = new OfflineCredentialsExpiredException();

  it("has errorCode OFFLINE_CREDENTIALS_EXPIRED", () => {
    expect(error.errorCode).toBe("OFFLINE_CREDENTIALS_EXPIRED");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("expired");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("OfflineTokenRevokedException", () => {
  const error = new OfflineTokenRevokedException();

  it("has errorCode OFFLINE_TOKEN_REVOKED", () => {
    expect(error.errorCode).toBe("OFFLINE_TOKEN_REVOKED");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("revoked");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("OfflineTokenExpiredException", () => {
  const error = new OfflineTokenExpiredException();

  it("has errorCode OFFLINE_TOKEN_EXPIRED", () => {
    expect(error.errorCode).toBe("OFFLINE_TOKEN_EXPIRED");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("expired");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("OfflineWorkstationMismatchException", () => {
  const error = new OfflineWorkstationMismatchException();

  it("has errorCode OFFLINE_WORKSTATION_MISMATCH", () => {
    expect(error.errorCode).toBe("OFFLINE_WORKSTATION_MISMATCH");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("different workstation");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("OfflineBlessingRequiredException", () => {
  const error = new OfflineBlessingRequiredException();

  it("has errorCode OFFLINE_BLESSING_REQUIRED", () => {
    expect(error.errorCode).toBe("OFFLINE_BLESSING_REQUIRED");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("blessed");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("SecureStorageUnavailableException", () => {
  const error = new SecureStorageUnavailableException();

  it("has errorCode SECURE_STORAGE_UNAVAILABLE", () => {
    expect(error.errorCode).toBe("SECURE_STORAGE_UNAVAILABLE");
  });

  it("has a descriptive message", () => {
    expect(error.message).toContain("Secure storage");
  });

  it("is an instance of DomainError", () => {
    expect(error).toBeInstanceOf(DomainError);
  });
});

describe("ClockDriftException", () => {
  it("has errorCode CLOCK_DRIFT and exposes driftMs", () => {
    const error = new ClockDriftException(5000);

    expect(error.errorCode).toBe("CLOCK_DRIFT");
    expect(error.driftMs).toBe(5000);
    expect(error.message).toContain("5000ms");
  });

  it("accepts negative drift values", () => {
    const error = new ClockDriftException(-3000);
    expect(error.driftMs).toBe(-3000);
  });

  it("is an instance of DomainError", () => {
    expect(new ClockDriftException(0)).toBeInstanceOf(DomainError);
  });
});
