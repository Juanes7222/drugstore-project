/**
 * Unit tests for the data-import exception hierarchy: every exception carries
 * its stable errorCode and stays instanceof DomainError so callers can branch
 * on the contract rather than string matching.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  ImportExecutionFailedException,
  ImportFileInvalidException,
  ImportRowRejectedException,
  ImportValidationFailedException,
} from "./exceptions";

describe("data-import exceptions", () => {
  it("carries the IMPORT_FILE_INVALID code and message", () => {
    const error = new ImportFileInvalidException("boom");
    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("IMPORT_FILE_INVALID");
    expect(error.message).toBe("boom");
  });

  it("carries the IMPORT_VALIDATION_FAILED code", () => {
    const error = new ImportValidationFailedException("2 rows failed");
    expect(error.errorCode).toBe("IMPORT_VALIDATION_FAILED");
    expect(error.message).toBe("2 rows failed");
  });

  it("carries the IMPORT_ROW_REJECTED code", () => {
    const error = new ImportRowRejectedException("rejected");
    expect(error.errorCode).toBe("IMPORT_ROW_REJECTED");
  });

  it("carries the IMPORT_EXECUTION_FAILED code", () => {
    const error = new ImportExecutionFailedException("failed");
    expect(error.errorCode).toBe("IMPORT_EXECUTION_FAILED");
  });
});
