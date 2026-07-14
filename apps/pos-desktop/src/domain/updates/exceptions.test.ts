/**
 * Tests for update subsystem exceptions.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  UpdateCheckFailedException,
  DownloadFailedException,
  InstallFailedException,
  MigrationFailedException,
  RollbackDetectedException,
} from "./exceptions";

describe("UpdateCheckFailedException", () => {
  it("sets errorCode UPDATE_CHECK_FAILED and includes message", () => {
    const error = new UpdateCheckFailedException("Server unreachable");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("UPDATE_CHECK_FAILED");
    expect(error.message).toContain("Server unreachable");
  });
});

describe("DownloadFailedException", () => {
  it("sets errorCode DOWNLOAD_FAILED and includes message", () => {
    const error = new DownloadFailedException("Checksum mismatch");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("DOWNLOAD_FAILED");
    expect(error.message).toContain("Checksum mismatch");
  });
});

describe("InstallFailedException", () => {
  it("sets errorCode INSTALL_FAILED and includes message", () => {
    const error = new InstallFailedException("Insufficient disk space");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("INSTALL_FAILED");
    expect(error.message).toContain("Insufficient disk space");
  });
});

describe("MigrationFailedException", () => {
  it("sets errorCode MIGRATION_FAILED and includes message", () => {
    const error = new MigrationFailedException("Schema mismatch");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("MIGRATION_FAILED");
    expect(error.message).toContain("Schema mismatch");
  });
});

describe("RollbackDetectedException", () => {
  it("sets errorCode ROLLBACK_DETECTED and includes message", () => {
    const error = new RollbackDetectedException("Version downgraded from 2.0.0 to 1.0.0");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("ROLLBACK_DETECTED");
    expect(error.message).toContain("2.0.0");
  });
});
