/**
 * Tests for entityIdentity — per-operation entity extraction used by
 * conflict detection on both the TypeScript merge and the Rust hub.
 *
 * Each operation type reads its entity id from a documented lookup order;
 * unknown shapes and unparseable payloads yield null so the caller falls
 * back to `hash:<payloadHash>`.
 */

import { describe, expect, it } from "vitest";
import type { LocalOperation } from "@pharmacy/shared-types";
import { ConflictReason } from "@pharmacy/shared-types";
import { entityIdentity, mergeLocalOperations } from "./operation-merge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let uuidCounter = 0;

function makeOp(
  operationType: string,
  payload: Record<string, unknown>,
  overrides: Partial<LocalOperation> = {},
): LocalOperation {
  uuidCounter += 1;
  return {
    operationUuid: overrides.operationUuid ?? `uuid-${uuidCounter}`,
    operationType,
    payload: JSON.stringify(payload),
    payloadHash: overrides.payloadHash ?? `hash-${uuidCounter}`,
    sourceWorkstationId: overrides.sourceWorkstationId ?? "ws-1",
    sourceCreatedAt: overrides.sourceCreatedAt ?? "2026-01-10T10:00:00.000Z",
    retryCount: 0,
    ...overrides,
  };
}

function identityOf(operationType: string, payload: Record<string, unknown>): string | null {
  return entityIdentity(makeOp(operationType, payload));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("entityIdentity", () => {
  describe("SALE_CONFIRMATION", () => {
    it("reads metadata.localSaleId first", () => {
      const identity = identityOf("SALE_CONFIRMATION", {
        metadata: { localSaleId: "sale-1", localNumber: 7 },
        localSaleId: "sale-payload",
      });

      expect(identity).toBe("sale-1");
    });

    it("falls back to metadata.localNumber serialised as a string", () => {
      const identity = identityOf("SALE_CONFIRMATION", {
        metadata: { localNumber: 42 },
      });

      expect(identity).toBe("42");
    });

    it("falls back to payload.localSaleId", () => {
      const identity = identityOf("SALE_CONFIRMATION", { localSaleId: "sale-9" });

      expect(identity).toBe("sale-9");
    });

    it("treats an empty localSaleId as missing", () => {
      const identity = identityOf("SALE_CONFIRMATION", {
        metadata: { localSaleId: "", localNumber: 3 },
      });

      expect(identity).toBe("3");
    });
  });

  describe("SHIFT_OPEN and SHIFT_CLOSURE", () => {
    it("reads payload.cashShiftId first", () => {
      const identity = identityOf("SHIFT_OPEN", {
        cashShiftId: "shift-1",
        metadata: { cashShiftId: "shift-meta" },
      });

      expect(identity).toBe("shift-1");
    });

    it("falls back to metadata.cashShiftId", () => {
      const identity = identityOf("SHIFT_CLOSURE", {
        metadata: { cashShiftId: "shift-2" },
      });

      expect(identity).toBe("shift-2");
    });
  });

  describe("PRODUCT_CREATION and PRODUCT_UPDATE", () => {
    it("reads metadata.productId first", () => {
      const identity = identityOf("PRODUCT_CREATION", {
        metadata: { productId: "prod-meta" },
        createProductDto: { internalCode: "CODE-1" },
      });

      expect(identity).toBe("prod-meta");
    });

    it("falls back to createProductDto.internalCode", () => {
      const identity = identityOf("PRODUCT_CREATION", {
        createProductDto: { internalCode: "CODE-2", id: "id-ignored" },
      });

      expect(identity).toBe("CODE-2");
    });

    it("reads updateProductDto for PRODUCT_UPDATE", () => {
      const identity = identityOf("PRODUCT_UPDATE", {
        updateProductDto: { id: "prod-7" },
      });

      expect(identity).toBe("prod-7");
    });
  });

  describe("CLIENT_CREATION and CLIENT_UPDATE", () => {
    it("reads metadata.clientId first", () => {
      const identity = identityOf("CLIENT_CREATION", {
        metadata: { clientId: "client-meta" },
        createClientDto: { identificationNumber: "123" },
      });

      expect(identity).toBe("client-meta");
    });

    it("falls back to createClientDto.identificationNumber", () => {
      const identity = identityOf("CLIENT_CREATION", {
        createClientDto: { identificationNumber: "998877", fullName: "Ana" },
      });

      expect(identity).toBe("998877");
    });

    it("falls back to updateClientDto.fullName", () => {
      const identity = identityOf("CLIENT_UPDATE", {
        updateClientDto: { fullName: "Luis Perez" },
      });

      expect(identity).toBe("Luis Perez");
    });
  });

  describe("CLIENT_DEACTIVATE", () => {
    it("reads deactivateClientDto.clientId", () => {
      const identity = identityOf("CLIENT_DEACTIVATE", {
        deactivateClientDto: { clientId: "client-3" },
        clientId: "client-payload",
      });

      expect(identity).toBe("client-3");
    });
  });

  describe("INVENTORY_ADJUSTMENT", () => {
    it("reads payload.lotId first", () => {
      const identity = identityOf("INVENTORY_ADJUSTMENT", {
        lotId: "lot-1",
        metadata: { adjustmentId: "adj-meta" },
      });

      expect(identity).toBe("lot-1");
    });

    it("falls back to metadata.adjustmentId", () => {
      const identity = identityOf("INVENTORY_ADJUSTMENT", {
        metadata: { adjustmentId: "adj-5" },
      });

      expect(identity).toBe("adj-5");
    });
  });

  describe("CLIENT_RETURN", () => {
    it("reads payload.sequentialNumber first", () => {
      const identity = identityOf("CLIENT_RETURN", {
        sequentialNumber: 11,
        receiptNumber: 22,
      });

      expect(identity).toBe("11");
    });

    it("falls back to payload.receiptNumber", () => {
      const identity = identityOf("CLIENT_RETURN", { receiptNumber: 99 });

      expect(identity).toBe("99");
    });
  });

  describe("CLIENT_CREDIT_PAYMENT and CLIENT_CREDIT_PAYMENT_ANNULMENT", () => {
    it("reads payload.sequentialNumber", () => {
      const identity = identityOf("CLIENT_CREDIT_PAYMENT", {
        sequentialNumber: 4,
        paymentId: "pay-ignored",
      });

      expect(identity).toBe("4");
    });

    it("falls back to payload.paymentId on annulment", () => {
      const identity = identityOf("CLIENT_CREDIT_PAYMENT_ANNULMENT", {
        paymentId: "pay-8",
      });

      expect(identity).toBe("pay-8");
    });
  });

  describe("PRESCRIPTION_REGISTRATION", () => {
    it("reads payload.prescriptionNumber first", () => {
      const identity = identityOf("PRESCRIPTION_REGISTRATION", {
        prescriptionNumber: "RX-1",
        prescriptionId: "id-ignored",
      });

      expect(identity).toBe("RX-1");
    });

    it("falls back to payload.prescriptionId", () => {
      const identity = identityOf("PRESCRIPTION_REGISTRATION", {
        prescriptionId: "rx-id-2",
      });

      expect(identity).toBe("rx-id-2");
    });
  });

  describe("invoice operation family", () => {
    it("reads payload.invoiceNumber", () => {
      const identity = identityOf("INVOICE_TRANSMISSION", {
        invoiceNumber: "FEV-100",
        invoiceId: "id-ignored",
      });

      expect(identity).toBe("FEV-100");
    });

    it("falls back to metadata.localSaleId", () => {
      const identity = identityOf("FISCAL_DOCUMENT_SYNC", {
        metadata: { localSaleId: "sale-4" },
      });

      expect(identity).toBe("sale-4");
    });
  });

  describe("purchase operation family", () => {
    it("reads payload.sequentialNumber", () => {
      const identity = identityOf("PURCHASE_ORDER_CONFIRMATION", {
        sequentialNumber: 31,
        orderId: "order-ignored",
      });

      expect(identity).toBe("31");
    });

    it("falls back to payload.orderId", () => {
      const identity = identityOf("SUPPLIER_RETURN_CONFIRMATION", {
        orderId: "order-9",
      });

      expect(identity).toBe("order-9");
    });
  });

  describe("RESOLUTION_ALLOCATION", () => {
    it("reads payload.resolutionId first", () => {
      const identity = identityOf("RESOLUTION_ALLOCATION", {
        resolutionId: "res-1",
        prefix: "FE",
      });

      expect(identity).toBe("res-1");
    });

    it("falls back to payload.prefix", () => {
      const identity = identityOf("RESOLUTION_ALLOCATION", { prefix: "FE" });

      expect(identity).toBe("FE");
    });
  });

  describe("AUDIT_LOG_BATCH", () => {
    it("returns a unique batch identity per operationUuid", () => {
      const first = entityIdentity(
        makeOp("AUDIT_LOG_BATCH", {}, { operationUuid: "audit-1" }),
      );

      const second = entityIdentity(
        makeOp("AUDIT_LOG_BATCH", {}, { operationUuid: "audit-2" }),
      );

      expect(first).toBe("batch:audit-1");
      expect(second).toBe("batch:audit-2");
    });
  });

  describe("fallback", () => {
    it("returns null for an unknown operation type", () => {
      const identity = identityOf("SOMETHING_NEW", { someField: "x" });

      expect(identity).toBeNull();
    });

    it("returns null when the payload is not JSON", () => {
      const op = makeOp("SALE_CONFIRMATION", {});

      const identity = entityIdentity({ ...op, payload: "{not-json" });

      expect(identity).toBeNull();
    });

    it("returns null when no recognised entity id is present", () => {
      const identity = identityOf("SALE_CONFIRMATION", { total: 100 });

      expect(identity).toBeNull();
    });
  });
});

describe("mergeLocalOperations — entity-based conflict detection", () => {
  it("never rejects audit batches from different workstations", () => {
    const local = [
      makeOp("AUDIT_LOG_BATCH", { events: 1 }, { operationUuid: "audit-a", sourceWorkstationId: "ws-1" }),
    ];
    const incoming = [
      makeOp("AUDIT_LOG_BATCH", { events: 2 }, { operationUuid: "audit-b", sourceWorkstationId: "ws-2" }),
    ];

    const { winningOperations, rejectedOperations } = mergeLocalOperations(local, incoming);

    expect(winningOperations).toHaveLength(2);
    expect(rejectedOperations).toHaveLength(0);
  });

  it("rejects a later adjustment to the same lot even when quantities differ", () => {
    const local = [
      makeOp(
        "INVENTORY_ADJUSTMENT",
        { lotId: "lot-1", quantity: 5 },
        { operationUuid: "adj-first", payloadHash: "hash-a", sourceWorkstationId: "ws-1", sourceCreatedAt: "2026-01-10T10:00:00.000Z" },
      ),
    ];
    const incoming = [
      makeOp(
        "INVENTORY_ADJUSTMENT",
        { lotId: "lot-1", quantity: 9 },
        { operationUuid: "adj-second", payloadHash: "hash-b", sourceWorkstationId: "ws-2", sourceCreatedAt: "2026-01-10T11:00:00.000Z" },
      ),
    ];

    const { winningOperations, rejectedOperations } = mergeLocalOperations(local, incoming);

    expect(winningOperations.map((op) => op.operationUuid)).toEqual(["adj-first"]);
    expect(rejectedOperations).toHaveLength(1);
    expect(rejectedOperations[0].operation.operationUuid).toBe("adj-second");
    expect(rejectedOperations[0].reason).toBe(ConflictReason.FIRST_WRITE_WINS);
    expect(rejectedOperations[0].winningOperationUuid).toBe("adj-first");
  });

  it("accepts unknown shapes with different payload hashes", () => {
    const local = [
      makeOp("SOMETHING_NEW", { v: 1 }, { operationUuid: "new-a", payloadHash: "hash-a", sourceWorkstationId: "ws-1" }),
    ];
    const incoming = [
      makeOp("SOMETHING_NEW", { v: 2 }, { operationUuid: "new-b", payloadHash: "hash-b", sourceWorkstationId: "ws-2" }),
    ];

    const { winningOperations, rejectedOperations } = mergeLocalOperations(local, incoming);

    expect(winningOperations).toHaveLength(2);
    expect(rejectedOperations).toHaveLength(0);
  });

  it("rejects unknown shapes sharing the same payload hash", () => {
    const local = [
      makeOp("SOMETHING_NEW", { v: 1 }, { operationUuid: "new-a", payloadHash: "hash-same", sourceWorkstationId: "ws-1" }),
    ];
    const incoming = [
      makeOp("SOMETHING_NEW", { v: 1 }, { operationUuid: "new-b", payloadHash: "hash-same", sourceWorkstationId: "ws-2", sourceCreatedAt: "2026-01-10T12:00:00.000Z" }),
    ];

    const { rejectedOperations } = mergeLocalOperations(local, incoming);

    expect(rejectedOperations).toHaveLength(1);
    expect(rejectedOperations[0].reason).toBe(ConflictReason.FIRST_WRITE_WINS);
  });
});
