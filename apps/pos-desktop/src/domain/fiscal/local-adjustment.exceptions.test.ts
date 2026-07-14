import { describe, expect, it } from "vitest";
import {
  AdjustmentAuthorizationException,
  AdjustmentInvoiceNotFoundException,
  AdjustmentNotAllowedForStatusException,
  AdjustmentReasonTooShortException,
  AdjustmentNotFoundException,
  AdjustmentAlreadyReversedException,
  AdjustmentConflictException,
} from "./local-adjustment.exceptions";

describe("AdjustmentAuthorizationException", () => {
  it("carries the correct error code", () => {
    expect(new AdjustmentAuthorizationException().errorCode).toBe("ADJUSTMENT_AUTHORIZATION");
  });
});

describe("AdjustmentInvoiceNotFoundException", () => {
  it("includes the invoice id", () => {
    expect(new AdjustmentInvoiceNotFoundException("inv-1").message).toContain("inv-1");
  });
});

describe("AdjustmentNotAllowedForStatusException", () => {
  it("includes invoice id, status and adjustment type", () => {
    const e = new AdjustmentNotAllowedForStatusException("inv-1", "CANCELLED", "PRICE");
    expect(e.message).toContain("inv-1");
    expect(e.message).toContain("CANCELLED");
    expect(e.message).toContain("PRICE");
  });
});

describe("AdjustmentReasonTooShortException", () => {
  it("mentions the minimum length", () => {
    expect(new AdjustmentReasonTooShortException().message).toContain("10 characters");
  });
});

describe("AdjustmentNotFoundException", () => {
  it("includes the adjustment id", () => {
    expect(new AdjustmentNotFoundException("adj-1").message).toContain("adj-1");
  });
});

describe("AdjustmentAlreadyReversedException", () => {
  it("includes the adjustment id", () => {
    expect(new AdjustmentAlreadyReversedException("adj-1").message).toContain("adj-1");
  });
});

describe("AdjustmentConflictException", () => {
  it("includes the invoice id", () => {
    expect(new AdjustmentConflictException("inv-1").message).toContain("inv-1");
  });
});
