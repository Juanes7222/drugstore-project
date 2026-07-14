/**
 * Tests for printing subsystem domain exceptions.
 */
import { describe, expect, it } from "vitest";
import { DomainError } from "../../common/domain-error";
import {
  JobTypeAlreadyAssignedException,
  PrinterNotConfiguredException,
  NoPrinterForJobTypeException,
  PrintJobNotFoundException,
  FallbackCycleException,
  PrintPayloadNotFoundException,
  UnknownJobTypeException,
  ConfigImportException,
} from "./exceptions";

describe("JobTypeAlreadyAssignedException", () => {
  it("sets errorCode JOB_TYPE_ALREADY_ASSIGNED and includes job type and printer name", () => {
    const error = new JobTypeAlreadyAssignedException("SALE_RECEIPT", "Impresora Principal");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("JOB_TYPE_ALREADY_ASSIGNED");
    expect(error.message).toContain("SALE_RECEIPT");
    expect(error.message).toContain("Impresora Principal");
  });
});

describe("PrinterNotConfiguredException", () => {
  it("sets errorCode PRINTER_NOT_CONFIGURED and includes printer id", () => {
    const error = new PrinterNotConfiguredException("printer-1");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("PRINTER_NOT_CONFIGURED");
    expect(error.message).toContain("printer-1");
  });
});

describe("NoPrinterForJobTypeException", () => {
  it("sets errorCode NO_PRINTER_FOR_JOB_TYPE and includes job type", () => {
    const error = new NoPrinterForJobTypeException("SALE_RECEIPT");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("NO_PRINTER_FOR_JOB_TYPE");
    expect(error.message).toContain("SALE_RECEIPT");
  });
});

describe("PrintJobNotFoundException", () => {
  it("sets errorCode PRINT_JOB_NOT_FOUND and includes job id", () => {
    const error = new PrintJobNotFoundException("job-42");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("PRINT_JOB_NOT_FOUND");
    expect(error.message).toContain("job-42");
  });
});

describe("FallbackCycleException", () => {
  it("sets errorCode FALLBACK_CYCLE_DETECTED and includes printer id", () => {
    const error = new FallbackCycleException("printer-1");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("FALLBACK_CYCLE_DETECTED");
    expect(error.message).toContain("printer-1");
  });
});

describe("PrintPayloadNotFoundException", () => {
  it("sets errorCode PRINT_PAYLOAD_NOT_FOUND and includes path", () => {
    const error = new PrintPayloadNotFoundException("/tmp/payload.pdf");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("PRINT_PAYLOAD_NOT_FOUND");
    expect(error.message).toContain("/tmp/payload.pdf");
  });
});

describe("UnknownJobTypeException", () => {
  it("sets errorCode UNKNOWN_JOB_TYPE and includes job type", () => {
    const error = new UnknownJobTypeException("INVALID_TYPE");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("UNKNOWN_JOB_TYPE");
    expect(error.message).toContain("INVALID_TYPE");
  });
});

describe("ConfigImportException", () => {
  it("sets errorCode CONFIG_IMPORT_ERROR and includes detail", () => {
    const error = new ConfigImportException("Version mismatch");

    expect(error).toBeInstanceOf(DomainError);
    expect(error.errorCode).toBe("CONFIG_IMPORT_ERROR");
    expect(error.message).toContain("Version mismatch");
  });
});
