/**
 * Tests for the provisional CUFE calculator.
 */
import { describe, expect, it } from "vitest";
import { calculateProvisionalCufe } from "./cufe";
import type { CufeInvoiceData } from "./fiscal-types";

function makeMinimalData(overrides?: Partial<CufeInvoiceData>): CufeInvoiceData {
  return {
    sellerNit: "900123456",
    invoiceType: "ELECTRONIC_INVOICE",
    invoiceNumber: "FE-WS000001-00000001",
    issuedAt: "2026-06-15T14:30:00.000Z",
    subtotal: "50000.00",
    totalTax: "9500.00",
    totalAmount: "59500.00",
    buyerIdentification: "1012345678",
    buyerName: "JUAN PEREZ",
    taxSummaries: [
      { scheme: "IVA", rate: "19.00", taxAmount: "9500.00" },
    ],
    ...overrides,
  };
}

describe("calculateProvisionalCufe", () => {
  it("returns a 96-character uppercase hex string (SHA-384)", async () => {
    const data = makeMinimalData();
    const result = await calculateProvisionalCufe(data, "test-tech-key-12345");

    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("produces different hashes for different invoice numbers", async () => {
    const data1 = makeMinimalData({ invoiceNumber: "FE-WS000001-00000001" });
    const data2 = makeMinimalData({ invoiceNumber: "FE-WS000001-00000002" });

    const hash1 = await calculateProvisionalCufe(data1, "test-key");
    const hash2 = await calculateProvisionalCufe(data2, "test-key");

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different tech keys", async () => {
    const data = makeMinimalData();

    const hash1 = await calculateProvisionalCufe(data, "key-A");
    const hash2 = await calculateProvisionalCufe(data, "key-B");

    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different amounts", async () => {
    const data1 = makeMinimalData({ totalAmount: "59500.00" });
    const data2 = makeMinimalData({ totalAmount: "60000.00" });

    const hash1 = await calculateProvisionalCufe(data1, "same-key");
    const hash2 = await calculateProvisionalCufe(data2, "same-key");

    expect(hash1).not.toBe(hash2);
  });

  it("handles missing tax schemes gracefully (empty segments)", async () => {
    const data = makeMinimalData({
      taxSummaries: [
        { scheme: "IVA", rate: "19.00", taxAmount: "9500.00" },
      ],
    });

    const result = await calculateProvisionalCufe(data, "test-key");

    // Should produce a valid hash even when only IVA is present
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("handles multiple tax schemes in the canonical order", async () => {
    const data = makeMinimalData({
      taxSummaries: [
        { scheme: "IVA", rate: "19.00", taxAmount: "9500.00" },
        { scheme: "INC", rate: "8.00", taxAmount: "4000.00" },
      ],
    });

    const result = await calculateProvisionalCufe(data, "test-key");
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("uses default seller NIT when empty", async () => {
    const data = makeMinimalData({ sellerNit: "" });
    const result = await calculateProvisionalCufe(data, "test-key");
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("uses default buyer identification when empty", async () => {
    const data = makeMinimalData({ buyerIdentification: "" });
    const result = await calculateProvisionalCufe(data, "test-key");
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("produces deterministic output for identical inputs", async () => {
    const data = makeMinimalData();

    const hash1 = await calculateProvisionalCufe(data, "deterministic-key");
    const hash2 = await calculateProvisionalCufe(data, "deterministic-key");

    expect(hash1).toBe(hash2);
  });

  it("handles credit note invoice type", async () => {
    const data = makeMinimalData({ invoiceType: "CREDIT_NOTE" });
    const result = await calculateProvisionalCufe(data, "test-key");
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });

  it("handles cancellation invoice type", async () => {
    const data = makeMinimalData({ invoiceType: "CONTINGENCY_CANCELLATION" });
    const result = await calculateProvisionalCufe(data, "test-key");
    expect(result).toMatch(/^[0-9A-F]{96}$/);
  });
});
