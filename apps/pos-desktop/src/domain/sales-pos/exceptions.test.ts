import { describe, expect, it } from "vitest";
import {
  SaleNotInProgressException,
  PrescriptionRequiredNotSupportedException,
  PaymentAmountMismatchException,
  ChangeRequiresCashPaymentException,
  SaleNotFoundException,
} from "./exceptions";

describe("SaleNotInProgressException", () => {
  it("includes the sale id", () => {
    expect(new SaleNotInProgressException("s-1").message).toContain("s-1");
  });
});

describe("PrescriptionRequiredNotSupportedException", () => {
  it("includes the product id", () => {
    expect(new PrescriptionRequiredNotSupportedException("p-001").message).toContain("p-001");
  });
});

describe("PaymentAmountMismatchException", () => {
  it("includes total and paid amounts", () => {
    const e = new PaymentAmountMismatchException(50000, 40000);
    expect(e.message).toContain("50000");
    expect(e.message).toContain("40000");
  });
});

describe("ChangeRequiresCashPaymentException", () => {
  it("carries the correct error code", () => {
    expect(new ChangeRequiresCashPaymentException().errorCode).toBe(
      "CHANGE_REQUIRES_CASH_PAYMENT",
    );
  });
});

describe("SaleNotFoundException", () => {
  it("includes the sale id", () => {
    expect(new SaleNotFoundException("s-1").message).toContain("s-1");
  });
});
