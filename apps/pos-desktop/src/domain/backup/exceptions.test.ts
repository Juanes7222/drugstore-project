/**
 * Tests for backup subsystem exceptions.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  BackupInProgressException,
  BackupFailedException,
  RestoreFailedException,
  UploadFailedException,
} from "./exceptions";

describe("BackupInProgressException", () => {
  it("sets errorCode to BACKUP_IN_PROGRESS", () => {
    const error = new BackupInProgressException();

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("BACKUP_IN_PROGRESS");
    expect(error.message).toContain("already in progress");
  });
});

describe("BackupFailedException", () => {
  it("sets errorCode to BACKUP_FAILED and includes message", () => {
    const error = new BackupFailedException("Disk full");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("BACKUP_FAILED");
    expect(error.message).toContain("Disk full");
  });
});

describe("RestoreFailedException", () => {
  it("sets errorCode to RESTORE_FAILED and includes message", () => {
    const error = new RestoreFailedException("Checksum mismatch");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("RESTORE_FAILED");
    expect(error.message).toContain("Checksum mismatch");
  });
});

describe("UploadFailedException", () => {
  it("sets errorCode to UPLOAD_FAILED and includes message", () => {
    const error = new UploadFailedException("Server returned 503");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("UPLOAD_FAILED");
    expect(error.message).toContain("Server returned 503");
  });
});
