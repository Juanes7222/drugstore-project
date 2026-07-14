/**
 * Tests for fiscal domain exceptions.
 */
import { describe, expect, it } from "vitest";
import {
  FiscalConfigurationError,
  ContingencyTechKeyPlaceholderError,
  FiscalCounterNotInitializedError,
  FiscalCounterExhaustedError,
  InvoiceNotFoundException,
  InvoiceNotCancellableException,
  NoActiveContingencyException,
  SaleMissingForInvoiceException,
  ReturnMissingForCreditNoteException,
} from "./exceptions";

describe("FiscalConfigurationError", () => {
  it("sets name and message via constructor", () => {
    const error = new FiscalConfigurationError("Invalid tech key");
    expect(error.name).toBe("FiscalConfigurationError");
    expect(error.errorCode).toBe("FISCAL_CONFIGURATION_ERROR");
    expect(error.message).toBe("Invalid tech key");
  });
});

describe("ContingencyTechKeyPlaceholderError", () => {
  it("uses a fixed default message", () => {
    const error = new ContingencyTechKeyPlaceholderError();
    expect(error.name).toBe("ContingencyTechKeyPlaceholderError");
    expect(error.errorCode).toBe("CONTINGENCY_TECH_KEY_PLACEHOLDER");
    expect(error.message).toMatch("tech key has not been configured");
  });
});

describe("FiscalCounterNotInitializedError", () => {
  it("includes the workstation ID in the message", () => {
    const error = new FiscalCounterNotInitializedError("ws-001");
    expect(error.errorCode).toBe("FISCAL_COUNTER_NOT_INITIALIZED");
    expect(error.message).toContain("ws-001");
    expect(error.message).toMatch(/not initialized/i);
  });
});

describe("FiscalCounterExhaustedError", () => {
  it("identifies the exhausted counter type", () => {
    const error = new FiscalCounterExhaustedError("contingency");
    expect(error.errorCode).toBe("FISCAL_COUNTER_EXHAUSTED");
    expect(error.message).toMatch(/contingency/i);
    expect(error.message).toMatch(/exhausted/i);
  });

  it("handles regular counter exhaustion", () => {
    const error = new FiscalCounterExhaustedError("regular");
    expect(error.message).toMatch(/invoice numbering range has been exhausted/i);
  });
});

describe("InvoiceNotFoundException", () => {
  it("includes the invoice ID in the message", () => {
    const error = new InvoiceNotFoundException("inv-001");
    expect(error.errorCode).toBe("INVOICE_NOT_FOUND");
    expect(error.message).toContain("inv-001");
  });
});

describe("InvoiceNotCancellableException", () => {
  it("includes invoice ID and status", () => {
    const error = new InvoiceNotCancellableException("inv-001", "TRANSMITTED_REJECTED");
    expect(error.errorCode).toBe("INVOICE_NOT_CANCELLABLE");
    expect(error.message).toContain("inv-001");
    expect(error.message).toContain("TRANSMITTED_REJECTED");
  });
});

describe("NoActiveContingencyException", () => {
  it("has a fixed message", () => {
    const error = new NoActiveContingencyException();
    expect(error.errorCode).toBe("NO_ACTIVE_CONTINGENCY");
    expect(error.message).toMatch(/no active contingency/i);
  });
});

describe("SaleMissingForInvoiceException", () => {
  it("includes the sale ID", () => {
    const error = new SaleMissingForInvoiceException("sale-001");
    expect(error.errorCode).toBe("SALE_MISSING_FOR_INVOICE");
    expect(error.message).toContain("sale-001");
  });
});

describe("ReturnMissingForCreditNoteException", () => {
  it("includes the return ID", () => {
    const error = new ReturnMissingForCreditNoteException("ret-001");
    expect(error.errorCode).toBe("RETURN_MISSING_FOR_CREDIT_NOTE");
    expect(error.message).toContain("ret-001");
  });
});
