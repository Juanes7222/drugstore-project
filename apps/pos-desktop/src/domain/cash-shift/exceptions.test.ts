import { describe, expect, it } from "vitest";
import {
  ShiftAlreadyOpenException,
  ShiftNotOpenException,
  MissingClosingCashCountsException,
  InvalidCashCountForNonCashMethodException,
  PaymentMethodNotFoundException,
} from "./exceptions";

describe("ShiftAlreadyOpenException", () => {
  it("carries SHIFT_ALREADY_OPEN code", () => {
    expect(new ShiftAlreadyOpenException().errorCode).toBe("SHIFT_ALREADY_OPEN");
  });
});

describe("ShiftNotOpenException", () => {
  it("carries SHIFT_NOT_OPEN code", () => {
    expect(new ShiftNotOpenException().errorCode).toBe("SHIFT_NOT_OPEN");
  });
});

describe("MissingClosingCashCountsException", () => {
  it("lists the missing payment methods", () => {
    const error = new MissingClosingCashCountsException(["Efectivo", "Tarjeta"]);
    expect(error.message).toContain("Efectivo");
    expect(error.message).toContain("Tarjeta");
  });
});

describe("InvalidCashCountForNonCashMethodException", () => {
  it("carries the correct error code", () => {
    expect(new InvalidCashCountForNonCashMethodException().errorCode).toBe(
      "INVALID_CASH_COUNT_FOR_NON_CASH_METHOD",
    );
  });
});

describe("PaymentMethodNotFoundException", () => {
  it("includes the payment method id in the message", () => {
    const error = new PaymentMethodNotFoundException("pm-42");
    expect(error.message).toContain("pm-42");
  });
});
