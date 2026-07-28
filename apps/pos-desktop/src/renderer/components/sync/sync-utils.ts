/**
 * Shared utilities for sync UI components.
 *
 * Extracts human-readable summaries from JSON payloads, truncates
 * error messages to hide stack traces, and provides consistent
 * string helpers for the error-entries table and drawer.
 *
 * @category Utility
 */

// ── Minimal i18n TFunction shape used by this module ────────────────────────

/** Lightweight signature matching react-i18next's `t()` for use in utilities. */
export type TFunction = (key: string, options?: Record<string, unknown>) => string;

// ── Payload summariser ─────────────────────────────────────────────────────

/**
 * Each entry maps a payload field path to a `sync.preview.*` i18n key
 * whose `{{value}}` interpolation receives the extracted string.
 * Order matters — the first match wins.
 */
const IDENTIFIER_PATHS: Array<{
  path: string[];
  tKey: string;
}> = [
  // Product internal code (most specific → checked first)
  { path: ["updateProductDto", "internalCode"], tKey: "sync.preview.code" },
  { path: ["createProductDto", "internalCode"], tKey: "sync.preview.code" },
  // Product name (no label prefix — just show the name)
  { path: ["updateProductDto", "commercialName"], tKey: "sync.preview.value" },
  { path: ["createProductDto", "commercialName"], tKey: "sync.preview.value" },
  // Barcode
  { path: ["updateProductDto", "barcodes", "0", "barcode"], tKey: "sync.preview.barcode" },
  { path: ["createProductDto", "barcodes", "0", "barcode"], tKey: "sync.preview.barcode" },
  // Sale number (metadata.localNumber)
  { path: ["metadata", "localNumber"], tKey: "sync.preview.sale" },
  // Sale ID
  { path: ["saleId"], tKey: "sync.preview.sale_id" },
  // Client business name / ID
  { path: ["createClientDto", "businessName"], tKey: "sync.preview.value" },
  { path: ["createClientDto", "identificationNumber"], tKey: "sync.preview.client_id" },
  { path: ["clientId"], tKey: "sync.preview.client" },
  // Inventory lot
  { path: ["createAdjustmentDto", "items", "0", "lotId"], tKey: "sync.preview.lot" },
  { path: ["adjustmentDto", "lotId"], tKey: "sync.preview.lot" },
  // Prescription
  { path: ["prescriptionId"], tKey: "sync.preview.prescription" },
  { path: ["prescriptionNumber"], tKey: "sync.preview.prescription" },
  // Invoice
  { path: ["invoiceId"], tKey: "sync.preview.invoice" },
  { path: ["invoiceNumber"], tKey: "sync.preview.invoice" },
  // Return
  { path: ["returnId"], tKey: "sync.preview.return" },
  { path: ["metadata", "localReturnId"], tKey: "sync.preview.return" },
  // Purchase order / reception
  { path: ["orderId"], tKey: "sync.preview.order" },
  { path: ["receptionId"], tKey: "sync.preview.reception" },
  { path: ["metadata", "localOrderId"], tKey: "sync.preview.order" },
  { path: ["metadata", "localReceptionId"], tKey: "sync.preview.reception" },
  // Shift / product metadata (lowest priority)
  { path: ["cashShiftId"], tKey: "sync.preview.shift" },
  { path: ["metadata", "productId"], tKey: "sync.preview.product" },
];

/**
 * Deep-read a value from a nested object using a dot-path-like array.
 * Returns undefined if any key along the path is missing.
 */
function getNested(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Extract a brief human-readable summary from a raw JSON payloadPreview.
 *
 * Never returns raw JSON.  Uses `t()` for all user-facing strings so the
 * output respects the active locale; passes `t` as the second argument.
 * When `t` is omitted (defensive), falls back to English operation-type
 * keys rather than hardcoded Spanish.
 */
export function summarizePayload(preview: string, t?: TFunction): string {
  if (!preview || !preview.startsWith("{")) return preview;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(preview) as Record<string, unknown>;
  } catch {
    // Truncated / invalid JSON — salvage the operation type if present.
    const opType = tryExtractOpType(preview);
    return t
      ? (opType ? t(`sync.op_type.${opType}`) : t("sync.preview.fallback"))
      : (opType ?? "Operation details");
  }

  // ── 1. Walk known identifier paths, pick the first match ──────────────
  for (const { path, tKey } of IDENTIFIER_PATHS) {
    const val = getNested(parsed, path);
    if (typeof val === "string" && val.length > 0) {
      return t ? t(tKey, { value: val }) : `[${val}]`;
    }
  }

  // ── 2. OperationType-specific compound descriptions ───────────────────
  const opType = typeof parsed.operationType === "string"
    ? parsed.operationType
    : null;

  if (opType) {
    // Sale: show localNumber from metadata
    if (opType === "SALE_CONFIRMATION") {
      const meta = parsed.metadata as Record<string, unknown> | undefined;
      if (meta && typeof meta.localNumber === "number") {
        return t
          ? t("sync.preview.sale", { value: String(meta.localNumber) })
          : `Sale #${meta.localNumber}`;
      }
    }
    // Adjustment: show reason or first lot
    if (opType === "INVENTORY_ADJUSTMENT") {
      const dto = parsed.createAdjustmentDto as Record<string, unknown> | undefined;
      if (dto && typeof dto.reason === "string" && dto.reason.length > 0) {
        return dto.reason;
      }
      if (dto && Array.isArray(dto.items) && dto.items.length > 0) {
        const first = dto.items[0] as Record<string, unknown>;
        if (typeof first.lotId === "string") {
          return t
            ? t("sync.preview.lot", { value: first.lotId })
            : `Lot: ${first.lotId}`;
        }
      }
    }
    // Return: show reason or sequential number
    if (opType === "CLIENT_RETURN") {
      if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
        return parsed.reason;
      }
      if (typeof parsed.sequentialNumber === "number") {
        return t
          ? t("sync.preview.return_number", { number: parsed.sequentialNumber })
          : `Return #${parsed.sequentialNumber}`;
      }
    }
    // Purchase operations
    if (opType.startsWith("PURCHASE_")) {
      if (typeof parsed.sequentialNumber === "number") {
        const isOrder = opType.includes("ORDER");
        return t
          ? t(isOrder ? "sync.preview.order_number" : "sync.preview.reception_number", { number: parsed.sequentialNumber })
          : `${isOrder ? "Order" : "Reception"} #${parsed.sequentialNumber}`;
      }
    }
    // Supplier return
    if (opType === "SUPPLIER_RETURN_CONFIRMATION") {
      if (typeof parsed.sequentialNumber === "number") {
        return t
          ? t("sync.preview.return_number", { number: parsed.sequentialNumber })
          : `Return #${parsed.sequentialNumber}`;
      }
    }
    // Prescription: show prescriber name
    if (opType === "PRESCRIPTION_REGISTRATION") {
      if (typeof parsed.prescriberName === "string") {
        return t
          ? t("sync.preview.prescription_doctor", { name: parsed.prescriberName })
          : `Rx: Dr. ${parsed.prescriberName}`;
      }
    }
    // Invoice transmission result
    if (opType === "INVOICE_TRANSMISSION_RESULT") {
      if (typeof parsed.invoiceId === "string" && typeof parsed.status === "string") {
        return t
          ? t("sync.preview.invoice_status", { invoiceId: parsed.invoiceId, status: parsed.status })
          : `Invoice ${parsed.invoiceId}: ${parsed.status}`;
      }
    }
    // Known op type but no identifier → use translated op type name
    return t ? t(`sync.op_type.${opType}`) : opType;
  }

  // ── 3. User ID as last-resort identifier ──────────────────────────────
  if (typeof parsed.userId === "string") {
    return t
      ? t("sync.preview.user", { value: parsed.userId })
      : `User: ${parsed.userId}`;
  }

  // ── 4. Absolute fallback — never raw JSON ────────────────────────────
  return t ? t("sync.preview.fallback") : "Operation details";
}

/**
 * Attempt to extract the operationType value from a malformed / truncated
 * JSON string via regex.  Returns null on failure.
 */
function tryExtractOpType(raw: string): string | null {
  const m = raw.match(/"operationType"\s*:\s*"([A-Z_]+)"/);
  return m ? m[1] : null;
}

// ── Error truncation ───────────────────────────────────────────────────────

/**
 * Truncate an error message at the first newline or 120 chars
 * to avoid leaking internal stack traces into the UI.
 * Returns null if message is null/empty.
 */
export function truncateError(msg: string | null): string | null {
  if (!msg) return null;
  const newlineIdx = msg.indexOf("\n");
  const firstLine = newlineIdx !== -1 ? msg.slice(0, newlineIdx) : msg;
  return firstLine.length > 120
    ? `${firstLine.slice(0, 117)}...`
    : firstLine;
}
