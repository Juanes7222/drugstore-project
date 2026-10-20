/**
 * Isolation control for the POS-local database.
 *
 * `window.__db` is the app's own devtools surface, exposed by
 * use-service-init.ts when VITE_DEV_MODE=true (which the e2e build sets). Using
 * it means the suite drives the same database handle the application uses, with
 * no second connection and no duplicated schema knowledge.
 *
 * Its job here is isolation: `resetLocalDatabase()` wipes PGlite and reloads the
 * app, so every spec starts from an empty local database and a genuine fresh
 * login. Without it the previous spec's session leaks into the next one, and a
 * spec that "logs in" as a different role silently keeps the previous user's
 * session — exactly the kind of false green this suite exists to eliminate.
 *
 * The readers below exist for one reason: a flow that is correct on the server
 * can still be WRONG in the POS's own database. The server is the far copy;
 * the local row is the one the cashier refunds against, re-prints and
 * reconciles. So the suite asserts both sides and reconciles them field by
 * field (see `reconcile.ts`).
 *
 * `queryLocal` is the one place in the suite that uses `executeAsyncScript`:
 * `__db.query` is async and the synchronous `browser.execute` cannot await it.
 * It is a handful of calls per spec, not the flood that made async execution
 * time out before (see the note at the top of e2e/helpers.ts).
 */
import { browser } from "@wdio/globals";

interface DbDevtools {
  reset(opts?: { force?: boolean }): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
}

declare global {
  interface Window {
    __db?: DbDevtools;
  }
}

const RESET_TIMEOUT_MS = 180_000;

/**
 * Run a read-only SQL query against the POS-local database.
 *
 * Uses `executeAsyncScript` because `__db.query` is async and the synchronous
 * `browser.execute` cannot await it. This is the one place in the suite that
 * does: it is a handful of calls per run, which is not the flood that made
 * async execution time out before.
 */
export async function queryLocal<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const rows = await browser.executeAsync(
    (statement: string, values: unknown[], done: (result: unknown) => void) => {
      const devtools = window.__db;
      if (!devtools) {
        done([{ __error: "window.__db is not available" }]);
        return;
      }
      // Dates are flattened to ISO strings HERE, while they are still real Date
      // objects.
      //
      // Crossing the WebDriver bridge does not preserve them: a `Date` arrives
      // as an empty object, so every `DateTime` column silently became `{}`.
      // That is why `lot.entryDate` — which the reception service sets
      // explicitly to `new Date()` — read back as absent, and why the specs saw a
      // lot with stock but no dates at all rather than an obvious failure.
      const serialiseDates = (row: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          out[key] =
            value instanceof Date
              ? Number.isNaN(value.getTime())
                ? null
                : value.toISOString()
              : value;
        }
        return out;
      };

      devtools
        .query(statement, values)
        .then((result) => {
          const list: unknown[] = Array.isArray(result)
            ? result
            : [
                {
                  __error: `unexpected local query result: ${JSON.stringify(result)}`,
                },
              ];
          done(
            list.map((row) =>
              row && typeof row === "object"
                ? serialiseDates(row as Record<string, unknown>)
                : row,
            ),
          );
        })
        .catch((error: unknown) => done([{ __error: String(error) }]));
    },
    sql,
    params,
  );

  if (!Array.isArray(rows)) {
    throw new Error(`unexpected local query result: ${JSON.stringify(rows)}`);
  }
  const failure = (rows[0] as { __error?: string } | undefined)?.__error;
  if (failure) {
    throw new Error(`local query failed: ${failure}`);
  }
  return rows as T[];
}

/**
 * Clients the POS holds locally.
 *
 * The POS serves the cart's client search straight out of this table
 * (ClientsService.search queries the local Prisma), so an empty table means the
 * search cannot find anything no matter what the server holds.
 */
export async function fetchLocalClients(): Promise<
  Array<{ identificationNumber: string; fullName: string }>
> {
  return queryLocal<{ identificationNumber: string; fullName: string }>(
    'SELECT "identificationNumber", "fullName" FROM "Client" ORDER BY "fullName"',
  );
}

/**
 * Sales the POS holds locally, with the workstation each belongs to.
 *
 * The failure text for a sale that never arrives is otherwise unreadable: a
 * missing row and a row whose search fails look identical from the UI. This
 * separates them.
 */
export async function fetchLocalSales(): Promise<
  Array<{
    localNumber: string;
    workstationId: string;
    operationalState: string;
  }>
> {
  const rows = await queryLocal<{
    localNumber: string;
    workstationId: string;
    operationalState: string;
  }>(
    `SELECT "localNumber", "workstationId", "operationalState"
       FROM "Sale" ORDER BY "localNumber"`,
  );
  return rows;
}

/**
 * Items of a locally held sale, with how many lot assignments each carries.
 *
 * A sale can be present and still be unreturnable: the return reverses stock
 * into the lots the sale consumed, so an item with zero assignments is a sale
 * the register cannot refund. Counting them separates "never arrived" from
 * "arrived unusable".
 */
export async function fetchLocalSaleItems(
  localNumber: number,
): Promise<Array<{ itemId: string; lotCount: number }>> {
  return queryLocal<{ itemId: string; lotCount: number }>(
    `SELECT si.id AS "itemId", count(sil.id)::int AS "lotCount"
       FROM "SaleItem" si
       LEFT JOIN "SaleItemLot" sil ON sil."saleItemId" = si.id
      WHERE si."saleId" = (SELECT id FROM "Sale" WHERE "localNumber" = $1)
      GROUP BY si.id
      ORDER BY si.id`,
    [String(localNumber)],
  );
}

/** Sync cursor timestamps the POS persists; null means that pull never completed. */
export async function fetchLocalSyncMetadata(): Promise<
  Record<string, string | null>
> {
  return browser.execute(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) out[key] = localStorage.getItem(key) ?? "";
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Sale mirror
// ---------------------------------------------------------------------------

export interface LocalSaleItem {
  productId: string;
  commercialName: string;
  quantity: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  discountReason: string | null;
  /** Lot assignment, as "lotId×quantity" pairs sorted by lot id. */
  lots: string;
}

export interface LocalSalePayment {
  methodName: string;
  category: string;
  amount: number;
  isCash: boolean;
}

export interface LocalSaleDetail {
  localNumber: number;
  operationalState: string;
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  totalAmount: number;
  changeAmount: number;
  cashShiftId: string;
  clientIdentificationNumber: string | null;
  clientName: string | null;
  items: LocalSaleItem[];
  payments: LocalSalePayment[];
}

/**
 * The POS's own copy of a sale, projected the way `fetchServerSale` projects
 * the server's row so the two can be compared field by field.
 *
 * The server's row is the far copy; this one is what the cashier refunds
 * against, re-prints and reconciles. A sale that reached the server but was
 * written wrong here — a missing lot assignment, a payment row that never
 * landed, a change amount of 0 — is invisible to every server-side assertion
 * in the suite, and it breaks the flows that read the local row.
 */
export async function fetchLocalSaleDetail(
  localNumber: number,
): Promise<LocalSaleDetail | null> {
  const header = await queryLocal<{
    localNumber: string;
    operationalState: string;
    subtotal: string;
    totalDiscount: string;
    totalTax: string;
    totalAmount: string;
    changeAmount: string;
    cashShiftId: string;
    clientIdentificationNumber: string | null;
    clientName: string | null;
  }>(
    `SELECT "localNumber", "operationalState", subtotal, "totalDiscount",
            "totalTax", "totalAmount", "changeAmount", "cashShiftId",
            "clientIdentificationNumberSnapshot" AS "clientIdentificationNumber",
            "clientNameSnapshot" AS "clientName"
       FROM "Sale"
      WHERE "localNumber" = $1`,
    [String(localNumber)],
  );

  const sale = header[0];
  if (!sale) return null;

  const itemRows = await queryLocal<{
    productId: string;
    commercialName: string;
    quantity: number;
    unitPrice: string;
    discountPercentage: string;
    discountAmount: string;
    discountReason: string | null;
    lotId: string | null;
    lotQuantity: number | null;
  }>(
    `SELECT si."productId", si."productCommercialNameSnapshot" AS "commercialName",
            si.quantity, si."unitPrice", si."discountPercentage",
            si."discountAmount", si."discountReason",
            sil."lotId", sil.quantity AS "lotQuantity"
       FROM "SaleItem" si
       LEFT JOIN "SaleItemLot" sil ON sil."saleItemId" = si.id
      WHERE si."saleId" = (SELECT id FROM "Sale" WHERE "localNumber" = $1)
      ORDER BY si.id, sil."lotId" NULLS FIRST`,
    [String(localNumber)],
  );

  const paymentRows = await queryLocal<{
    methodName: string;
    category: string;
    amount: string;
    isCash: boolean;
  }>(
    `SELECT pm.name AS "methodName", pm.category, sp.amount, pm."isCash"
       FROM "SalePayment" sp
       JOIN "PaymentMethod" pm ON pm.id = sp."paymentMethodId"
      WHERE sp."saleId" = (SELECT id FROM "Sale" WHERE "localNumber" = $1)`,
    [String(localNumber)],
  );

  // Items are grouped by their item row: one item can draw from several lots,
  // and the assignment set is part of what the two stores must agree on.
  const items = new Map<string, LocalSaleItem>();
  for (const row of itemRows) {
    const key = `${row.productId}|${row.commercialName}|${row.quantity}`;
    let item = items.get(key);
    if (!item) {
      item = {
        productId: row.productId,
        commercialName: row.commercialName,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unitPrice),
        discountPercentage: Number(row.discountPercentage),
        discountAmount: Number(row.discountAmount),
        discountReason: row.discountReason,
        lots: "",
      };
      items.set(key, item);
    }
    if (row.lotId) {
      const pair = `${row.lotId}×${Number(row.lotQuantity ?? 0)}`;
      item.lots = item.lots ? `${item.lots},${pair}` : pair;
    }
  }

  return {
    localNumber: Number(sale.localNumber),
    operationalState: sale.operationalState,
    subtotal: Number(sale.subtotal),
    totalDiscount: Number(sale.totalDiscount),
    totalTax: Number(sale.totalTax),
    totalAmount: Number(sale.totalAmount),
    changeAmount: Number(sale.changeAmount),
    cashShiftId: sale.cashShiftId,
    clientIdentificationNumber: sale.clientIdentificationNumber,
    clientName: sale.clientName,
    items: [...items.values()],
    // Paired with the server's rows by NAME, not by position: the two stores
    // order payment methods by their own `sortOrder`, which is not guaranteed
    // to be the same set of rows.
    payments: paymentRows
      .map((row) => ({
        methodName: row.methodName,
        category: row.category,
        amount: Number(row.amount),
        isCash: row.isCash,
      }))
      .sort((a, b) => a.methodName.localeCompare(b.methodName)),
  };
}

// ---------------------------------------------------------------------------
// Cash shift
// ---------------------------------------------------------------------------

export interface LocalCashShift {
  id: string;
  state: string;
  workstationId: string;
  userId: string;
  openingBalance: number;
  expectedClosingAmount: number;
  actualClosingAmount: number;
  closingDifference: number;
  /** The closing cash counts the shift was closed with. */
  cashCounts: Array<{
    countType: string;
    expectedAmount: number;
    declaredAmount: number;
  }>;
}

interface LocalCashShiftRow {
  id: string;
  state: string;
  workstationId: string;
  userId: string;
  openingBalance: string;
  expectedClosingAmount: string;
  actualClosingAmount: string;
  closingDifference: string;
}

function toLocalCashShift(
  row: LocalCashShiftRow,
  cashCounts: LocalCashShift["cashCounts"],
): LocalCashShift {
  return {
    id: row.id,
    state: row.state,
    workstationId: row.workstationId,
    userId: row.userId,
    openingBalance: Number(row.openingBalance),
    expectedClosingAmount: Number(row.expectedClosingAmount),
    actualClosingAmount: Number(row.actualClosingAmount),
    closingDifference: Number(row.closingDifference),
    cashCounts,
  };
}

/**
 * The POS's own open cash shift, or null when the store has none open.
 *
 * The shift is store-wide: it may have been opened at another workstation, and
 * the POS mirrors the server's row when it adopts one. Either way this is the
 * row the sale is booked into, so it is what a sale's `cashShiftId` must
 * match.
 */
export async function fetchLocalOpenShift(): Promise<LocalCashShift | null> {
  const rows = await queryLocal<LocalCashShiftRow>(
    `SELECT id, state, "workstationId", "userId", "openingBalance",
            "expectedClosingAmount", "actualClosingAmount", "closingDifference"
       FROM "CashShift"
      WHERE state = 'OPEN'
      ORDER BY "openedAt" DESC
      LIMIT 1`,
  );
  const shift = rows[0];
  if (!shift) return null;
  return toLocalCashShift(shift, await fetchLocalCashCounts(shift.id));
}

/** The POS's own row for a shift, whatever its state. */
export async function fetchLocalCashShift(
  shiftId: string,
): Promise<LocalCashShift | null> {
  const rows = await queryLocal<LocalCashShiftRow>(
    `SELECT id, state, "workstationId", "userId", "openingBalance",
            "expectedClosingAmount", "actualClosingAmount", "closingDifference"
       FROM "CashShift"
      WHERE id = $1`,
    [shiftId],
  );
  const shift = rows[0];
  if (!shift) return null;
  return toLocalCashShift(shift, await fetchLocalCashCounts(shiftId));
}

/** The closing cash counts the POS registered for a shift. */
async function fetchLocalCashCounts(
  shiftId: string,
): Promise<LocalCashShift["cashCounts"]> {
  const rows = await queryLocal<{
    countType: string;
    expectedAmount: string;
    declaredAmount: string;
  }>(
    `SELECT "countType", "expectedAmount", "declaredAmount"
       FROM "ShiftCashCount"
      WHERE "cashShiftId" = $1
      ORDER BY "countType", "paymentMethodId"`,
    [shiftId],
  );
  return rows.map((row) => ({
    countType: row.countType,
    expectedAmount: Number(row.expectedAmount),
    declaredAmount: Number(row.declaredAmount),
  }));
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------

export interface LocalSyncQueueRow {
  operationType: string;
  status: string;
  payload: string;
}

/**
 * Sync-queue entries of `operationType`, newest last.
 *
 * The queue is the POS's own record of what it still owes the server, so it is
 * the only place a locally-created entity can be seen *before* the replay
 * lands. Asserting on it separates "the POS never queued it" from "the POS
 * queued it and the server rejected it", which look identical from the UI.
 */
export async function fetchLocalSyncQueue(
  operationType?: string,
): Promise<LocalSyncQueueRow[]> {
  // The column is an enum, so the comparison is cast to TEXT on both sides.
  //
  // Writing `$1::text IS NULL OR "operationType" = $1` instead pins the
  // parameter to text and leaves the second comparison as enum = text, which
  // Postgres rejects outright ("operator does not exist: SyncOperationType =
  // text"). The helper was never called, so the query was never executed and
  // the mistake sat there unnoticed.
  return queryLocal<LocalSyncQueueRow>(
    `SELECT "operationType", status, payload
       FROM "SyncQueue"
      WHERE $1::text IS NULL OR "operationType"::text = $1
      ORDER BY "clientSequence"`,
    [operationType ?? null],
  );
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

/**
 * Suppliers the POS holds locally.
 *
 * Supplier creation is the one master-data flow that is LOCAL ONLY: the sync
 * operation type list has no supplier member, and SuppliersService.create
 * writes a local row without queueing anything. The supplier pull only upserts,
 * so a locally created supplier survives every later pull — which is what makes
 * this table, rather than the server's, the place its creation is verified.
 */
export async function fetchLocalSuppliers(): Promise<
  Array<{
    id: string;
    identificationType: string;
    identificationNumber: string;
    businessName: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    paymentTermsDays: number;
    creditLimit: number;
    isActive: boolean;
  }>
> {
  const rows = await queryLocal<{
    id: string;
    identificationType: string;
    identificationNumber: string;
    businessName: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    paymentTermsDays: number;
    creditLimit: string;
    isActive: boolean;
  }>(
    `SELECT id, "identificationType", "identificationNumber", "businessName",
            "contactName", phone, email, "paymentTermsDays", "creditLimit",
            "isActive"
       FROM "Supplier"
      ORDER BY "identificationNumber"`,
  );
  // `creditLimit` is a NUMERIC column, so PGlite hands it back as a string.
  return rows.map((row) => ({ ...row, creditLimit: Number(row.creditLimit) }));
}

// ---------------------------------------------------------------------------
// Lots and purchase pipeline
// ---------------------------------------------------------------------------

export interface LocalLot {
  id: string;
  batchNumber: string;
  productId: string;
  expirationDate: string | null;
  entryDate: string | null;
  state: string;
  currentStock: number;
  locationCode: string | null;
}

/**
 * An ISO timestamp, or `null` when the column holds no usable date.
 *
 * `queryLocal` already flattens `Date` values to ISO strings inside the browser,
 * so a `DateTime` column arrives here as a string, a number, or `null` for a lot
 * that legitimately has no expiry. `new Date(x).toISOString()` throws a
 * `RangeError` on that `null`, which turned one expiry-less lot into a crash
 * that aborted every spec reading inventory — hence the explicit emptiness check
 * instead of a bare conversion.
 */
function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Lots the POS holds locally, newest entry first.
 *
 * Dates come back as ISO strings through `executeAsyncScript`, which
 * JSON-serialises the row, so the specs compare them as dates rather than as
 * opaque ids. `expirationDate` is null for a lot with no expiry.
 */
export async function fetchLocalLots(productId?: string): Promise<LocalLot[]> {
  const rows = await queryLocal<{
    id: string;
    batchNumber: string;
    productId: string;
    expirationDate: string | null;
    entryDate: string | null;
    state: string;
    currentStock: number;
    locationCode: string | null;
  }>(
    `SELECT l.id, l."batchNumber", l."productId", l."expirationDate",
            l."entryDate", l.state, l."currentStock", l."locationCode"
       FROM "Lot" l
      WHERE $1::text IS NULL OR l."productId" = $1
      ORDER BY l."entryDate" DESC, l."batchNumber"`,
    [productId ?? null],
  );
  return rows.map((row) => ({
    ...row,
    expirationDate: isoOrNull(row.expirationDate),
    entryDate: isoOrNull(row.entryDate),
  }));
}

export interface LocalPurchaseOrder {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  supplierName: string;
  subtotal: number;
}

/** Purchase orders the POS holds locally, newest sequential number first. */
export async function fetchLocalPurchaseOrders(): Promise<
  LocalPurchaseOrder[]
> {
  const rows = await queryLocal<{
    id: string;
    sequentialNumber: string;
    state: string;
    supplierId: string;
    supplierName: string;
    subtotal: string;
  }>(
    `SELECT po.id, po."sequentialNumber", po.state, po."supplierId",
            s."businessName" AS "supplierName", po.subtotal
       FROM "PurchaseOrder" po
       LEFT JOIN "Supplier" s ON s.id = po."supplierId"
      ORDER BY po."sequentialNumber" DESC`,
  );
  return rows.map((row) => ({
    ...row,
    sequentialNumber: Number(row.sequentialNumber),
    subtotal: Number(row.subtotal),
  }));
}

export interface LocalPurchaseReception {
  id: string;
  sequentialNumber: number;
  state: string;
  purchaseOrderId: string | null;
  totalAmount: number;
  itemCount: number;
}

/**
 * Tax schemes the POS holds locally.
 *
 * The product's tax pointer only stores a `taxSchemeId`, so the rate itself
 * lives on this table. An empty local table is invisible to a local-versus-server
 * diff: the POS then computes documents with a zero rate and the server records
 * the zero it was sent, so the two stores agree on a wrong value.
 */
export async function fetchLocalTaxSchemes(): Promise<
  Array<{ id: string; code: string; rate: string; isActive: boolean }>
> {
  return queryLocal<{
    id: string;
    code: string;
    rate: string;
    isActive: boolean;
  }>(`SELECT id, code, rate, "isActive" FROM "TaxScheme" ORDER BY code`);
}

/** The reception id the POS holds for a given lot batch, or null. */
export async function fetchLocalPurchaseReceptionIdByBatch(
  batchNumber: string,
): Promise<string | null> {
  const rows = await queryLocal<{ id: string }>(
    `SELECT DISTINCT ri."purchaseReceptionId" AS id
       FROM "PurchaseReceptionItem" ri
      WHERE ri."lotNumber" = $1
      LIMIT 1`,
    [batchNumber],
  );
  return rows[0]?.id ?? null;
}

/**
 * Reception items exactly as the POS holds them, at the same width as the
 * server's projection.
 *
 * The money and tax columns are included on purpose. A previous reader exposed
 * only counts, which meant no assertion — and no reconciliation — could see that
 * the server stores $0 on every synced item while the header carries the real
 * total. Comparing only what a reader happens to select cannot find a dropped
 * column.
 */
export async function fetchLocalPurchaseReceptionItems(
  receptionId: string,
): Promise<Record<string, unknown>[]> {
  return queryLocal<Record<string, unknown>>(
    `SELECT ri.id, ri."purchaseReceptionId", ri."productId",
            ri."purchaseOrderItemId", ri."lotId", ri."lotNumber",
            ri."expirationDate", ri."receivedQuantity", ri."realUnitCost",
            ri."taxRate", ri."taxAmount", ri."discountAmount", ri.subtotal, ri.total
       FROM "PurchaseReceptionItem" ri
      WHERE ri."purchaseReceptionId" = $1
      ORDER BY ri.id`,
    [receptionId],
  );
}

/** A reception row at the same width as the server's projection. */
export async function fetchLocalPurchaseReception(
  receptionId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await queryLocal<Record<string, unknown>>(
    `SELECT pr.id, pr."sequentialNumber", pr.state, pr."supplierId",
            pr."purchaseOrderId", pr.subtotal, pr."totalTax", pr."totalAmount",
            pr."receivedAt", pr.notes
       FROM "PurchaseReception" pr
      WHERE pr.id = $1`,
    [receptionId],
  );
  return rows[0] ?? null;
}

/** Purchase receptions the POS holds locally, newest first. */
export async function fetchLocalPurchaseReceptions(): Promise<
  LocalPurchaseReception[]
> {
  const rows = await queryLocal<{
    id: string;
    sequentialNumber: string;
    state: string;
    purchaseOrderId: string | null;
    totalAmount: string;
    itemCount: string;
  }>(
    `SELECT pr.id, pr."sequentialNumber", pr.state, pr."purchaseOrderId",
            pr."totalAmount",
            (SELECT count(*)::int FROM "PurchaseReceptionItem" pri
              WHERE pri."purchaseReceptionId" = pr.id) AS "itemCount"
       FROM "PurchaseReception" pr
      ORDER BY pr."sequentialNumber" DESC`,
  );
  return rows.map((row) => ({
    ...row,
    sequentialNumber: Number(row.sequentialNumber),
    totalAmount: Number(row.totalAmount),
    itemCount: Number(row.itemCount),
  }));
}

/**
 * The active cost of a product, i.e. the row `Product.currentCostId` points at.
 *
 * This is the figure a sale's `unitCost` snapshot is built from, so it is what
 * makes a reception's real unit cost observable in the *next* sale. Reading the
 * pointer rather than the newest history row matters: the reception closes the
 * previous row (`effectiveTo`) instead of mutating it, so the newest row by
 * date is not necessarily the active one.
 */
export async function fetchLocalProductCost(
  productId: string,
): Promise<{ cost: number; changeReason: string | null } | null> {
  const rows = await queryLocal<{ cost: string; changeReason: string | null }>(
    `SELECT pch.cost, pch."changeReason"
       FROM "Product" p
       JOIN "ProductCostHistory" pch ON pch.id = p."currentCostId"
      WHERE p.id = $1`,
    [productId],
  );
  const row = rows[0];
  return row
    ? { cost: Number(row.cost), changeReason: row.changeReason }
    : null;
}

// ---------------------------------------------------------------------------
// Local configuration store
// ---------------------------------------------------------------------------

/**
 * The persisted POS configuration block (`localStorage.pharmacy_local_config`).
 *
 * Some configuration tabs have no server round trip: the sales tab's discount
 * limits are written straight to this store and the POS only ever READS them
 * from `GET /configuration/pos-settings`. For those controls the store is the
 * database of record, so asserting on it is asserting on the application's real
 * state rather than on a mirror.
 *
 * Returns the store's own state, unwrapped from the zustand `persist` envelope.
 * zustand writes `{ state: {...}, version: N }`, so reading the raw key and
 * reaching for `config.discountLimits` yields `undefined` for every block —
 * which fails as a bare `Expected: 7 / Received: undefined` with no hint that
 * the JSON shape, not the write, was the problem.
 */
export async function fetchLocalConfig(): Promise<Record<string, unknown>> {
  const raw = await browser.execute(() =>
    localStorage.getItem("pharmacy_local_config"),
  );
  if (!raw) {
    throw new Error(
      "localStorage.pharmacy_local_config is absent — the POS has not " +
        "persisted its configuration block",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `pharmacy_local_config is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const envelope = parsed.state;
  if (!envelope || typeof envelope !== "object") {
    throw new Error(
      "pharmacy_local_config has no `state` object — expected the zustand " +
        `persist envelope, got keys: ${Object.keys(parsed).join(", ")}`,
    );
  }
  return envelope as Record<string, unknown>;
}

/**
 * Store-credit state as the POS computes it, read straight out of the local
 * database.
 *
 * `debt` is recomputed here in SQL using the SAME three terms the domain uses
 * — confirmed sales paid with a CREDIT method, minus confirmed credit refunds,
 * minus non-annulled abonos — rather than trusting a stored column. That is the
 * point of the reader: `SalesPosService.computeClientCreditDebt` and
 * `CreditService.computeDebtCents` drifted apart once already (the former
 * dropped the abono term), and a reader that just echoed whatever the app wrote
 * would have agreed with whichever one was wrong.
 */
export async function fetchLocalCreditState(
  identificationNumber: string,
): Promise<{
  clientId: string;
  creditLimit: number;
  debt: number;
  creditPaymentCount: number;
}> {
  const rows = await queryLocal<{
    clientId: string;
    creditLimit: string | number | null;
    salesDebt: string | number | null;
    creditRefunds: string | number | null;
    abonos: string | number | null;
    creditPaymentCount: string | number | null;
  }>(
    `SELECT c."id"                                  AS "clientId",
            c."creditLimit"                         AS "creditLimit",
            COALESCE((
              SELECT SUM(sp."amount")
                FROM "SalePayment" sp
                JOIN "Sale" s ON s."id" = sp."saleId"
               WHERE s."clientId" = c."id"
                 AND s."operationalState" = 'CONFIRMED'
                 AND sp."paymentMethodId" IN (
                       SELECT "id" FROM "PaymentMethod" WHERE "category" = 'CREDIT')
            ), 0)                                   AS "salesDebt",
            COALESCE((
              SELECT SUM(r."refundAmount")
                FROM "ClientReturn" r
               WHERE r."clientId" = c."id"
                 AND r."state" = 'CONFIRMED'
                 AND r."refundMethodId" IN (
                       SELECT "id" FROM "PaymentMethod" WHERE "category" = 'CREDIT')
            ), 0)                                   AS "creditRefunds",
            COALESCE((
              SELECT SUM(p."amount")
                FROM "ClientCreditPayment" p
               WHERE p."clientId" = c."id" AND p."annulledAt" IS NULL
            ), 0)                                   AS "abonos",
            (SELECT COUNT(*)
               FROM "SalePayment" sp
               JOIN "Sale" s ON s."id" = sp."saleId"
              WHERE s."clientId" = c."id"
                AND s."operationalState" = 'CONFIRMED'
                AND sp."paymentMethodId" IN (
                      SELECT "id" FROM "PaymentMethod" WHERE "category" = 'CREDIT')
            )                                       AS "creditPaymentCount"
       FROM "Client" c
      WHERE c."identificationNumber" = $1`,
    [identificationNumber],
  );

  const row = rows[0];
  if (!row) {
    throw new Error(
      `no local client with identification ${identificationNumber}`,
    );
  }

  const num = (value: string | number | null): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const debt = num(row.salesDebt) - num(row.creditRefunds) - num(row.abonos);
  return {
    clientId: row.clientId,
    creditLimit: num(row.creditLimit),
    debt: Math.max(0, debt),
    creditPaymentCount: num(row.creditPaymentCount),
  };
}

/** CREDIT payment methods the POS holds locally, by name. */
export async function fetchLocalCreditMethods(): Promise<
  Array<{ id: string; name: string; isCash: boolean }>
> {
  return queryLocal<{ id: string; name: string; isCash: boolean }>(
    `SELECT "id", "name", "isCash"
       FROM "PaymentMethod"
      WHERE "category" = 'CREDIT' AND "isActive" = true
      ORDER BY "sortOrder"`,
  );
}

/**
 * The credit payment line of a locally held sale.
 *
 * Read separately from the sale header because a sale can be CONFIRMED while
 * carrying no credit line at all — the shape a dropped `SalePayment` row takes,
 * which is indistinguishable from a cash sale unless the payments are looked at
 * directly.
 */
export async function fetchLocalCreditSalePayment(
  localNumber: number,
): Promise<{
  amount: number;
  methodName: string;
  category: string;
  isCash: boolean;
} | null> {
  const rows = await queryLocal<{
    amount: string | number | null;
    methodName: string;
    category: string;
    isCash: boolean;
  }>(
    `SELECT sp."amount"  AS "amount",
            pm."name"    AS "methodName",
            pm."category" AS "category",
            pm."isCash"  AS "isCash"
       FROM "SalePayment" sp
       JOIN "Sale" s ON s."id" = sp."saleId"
       JOIN "PaymentMethod" pm ON pm."id" = sp."paymentMethodId"
      WHERE s."localNumber" = $1
        AND pm."category" = 'CREDIT'`,
    [localNumber],
  );

  const row = rows[0];
  if (!row) return null;
  const amount = Number(row.amount ?? 0);
  return {
    amount: Number.isFinite(amount) ? amount : 0,
    methodName: row.methodName,
    category: row.category,
    isCash: row.isCash,
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface LocalProduct {
  id: string;
  internalCode: string;
  commercialName: string;
  concentration: string | null;
  concentrationUnit: string | null;
  laboratory: string;
  saleType: string;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  atcCode: string | null;
  therapeuticIndication: string | null;
  storageConditions: string | null;
  internalNotes: string | null;
  categoryId: string | null;
  pharmaceuticalFormId: string | null;
  commissionType: string;
  commissionValue: number;
  currentPrice: number | null;
  currentCost: number | null;
  currentTaxSchemeId: string | null;
  barcodes: Array<{ barcode: string; barcodeType: string; isPrimary: boolean }>;
}

/**
 * A product the POS holds locally, read at the width the server projection
 * carries so a local-versus-server reconciliation compares like with like.
 *
 * `currentPrice` / `currentCost` follow the `currentPriceId` / `currentCostId`
 * pointers rather than the newest history row: an update closes the previous
 * row (`effectiveTo`) instead of mutating it, so the newest row by date is not
 * necessarily the active one.
 */
export async function fetchLocalProduct(
  commercialName: string,
): Promise<LocalProduct | null> {
  const rows = await queryLocal<{
    id: string;
    internalCode: string;
    commercialName: string;
    concentration: string | null;
    concentrationUnit: string | null;
    laboratory: string;
    saleType: string;
    minimumStock: number;
    isActive: boolean;
    invimaRegistry: string | null;
    atcCode: string | null;
    therapeuticIndication: string | null;
    storageConditions: string | null;
    internalNotes: string | null;
    categoryId: string | null;
    pharmaceuticalFormId: string | null;
    commissionType: string;
    commissionValue: string;
    currentPrice: string | null;
    currentCost: string | null;
    currentTaxSchemeId: string | null;
  }>(
    `SELECT p.id, p."internalCode", p."commercialName", p.concentration,
            p."concentrationUnit", p.laboratory, p."saleType", p."minimumStock",
            p."isActive", p."invimaRegistry", p."atcCode",
            p."therapeuticIndication", p."storageConditions", p."internalNotes",
            p."categoryId", p."pharmaceuticalFormId", p."commissionType",
            p."commissionValue",
            ph.price  AS "currentPrice",
            pch.cost  AS "currentCost",
            pth."taxSchemeId" AS "currentTaxSchemeId"
       FROM "Product" p
       LEFT JOIN "ProductPriceHistory" ph ON ph.id = p."currentPriceId"
       LEFT JOIN "ProductCostHistory" pch ON pch.id = p."currentCostId"
       LEFT JOIN "ProductTaxHistory" pth ON pth.id = p."currentTaxHistoryId"
      WHERE p."commercialName" = $1
      LIMIT 1`,
    [commercialName],
  );

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    commissionValue: Number(row.commissionValue),
    currentPrice: row.currentPrice === null ? null : Number(row.currentPrice),
    currentCost: row.currentCost === null ? null : Number(row.currentCost),
    barcodes: await queryLocal<{
      barcode: string;
      barcodeType: string;
      isPrimary: boolean;
    }>(
      'SELECT barcode, "barcodeType", "isPrimary" FROM "ProductBarcode" WHERE "productId" = $1 ORDER BY barcode',
      [row.id],
    ),
  };
}

/**
 * The active price of a product, i.e. the row `Product.currentPriceId` points at,
 * with its history bookkeeping.
 */
export async function fetchLocalProductPrice(productId: string): Promise<{
  price: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  changeReason: string | null;
} | null> {
  const rows = await queryLocal<{
    price: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    changeReason: string | null;
  }>(
    `SELECT ph.price, ph."effectiveFrom", ph."effectiveTo", ph."changeReason"
       FROM "Product" p
       JOIN "ProductPriceHistory" ph ON ph.id = p."currentPriceId"
      WHERE p.id = $1`,
    [productId],
  );
  const row = rows[0];
  return row
    ? {
        price: Number(row.price),
        effectiveFrom: isoOrNull(row.effectiveFrom),
        effectiveTo: isoOrNull(row.effectiveTo),
        changeReason: row.changeReason,
      }
    : null;
}

// ---------------------------------------------------------------------------
// Inventory adjustments
// ---------------------------------------------------------------------------

export interface LocalAdjustmentDocument {
  id: string;
  sequentialNumber: number;
  state: string;
  reason: string | null;
  notes: string | null;
  appliedAt: string | null;
  movements: Array<{
    lotId: string;
    movementType: string;
    quantity: number;
    previousStock: number;
    resultingStock: number;
    reason: string | null;
  }>;
}

/**
 * Adjustment documents the POS holds locally, newest first.
 *
 * The movements are read at the same width as the server's projection: an
 * adjustment whose stock landed locally but whose movement rows are missing
 * breaks every pull-based reconciliation downstream, and a counts-only reader
 * would show it as a success.
 */
export async function fetchLocalAdjustments(): Promise<
  LocalAdjustmentDocument[]
> {
  const rows = await queryLocal<{
    id: string;
    sequentialNumber: string;
    state: string;
    reason: string | null;
    notes: string | null;
    appliedAt: string | null;
  }>(
    `SELECT id, "sequentialNumber", state, reason, notes, "appliedAt"
       FROM "InventoryAdjustmentDocument"
      ORDER BY "sequentialNumber" DESC`,
  );

  const docs: LocalAdjustmentDocument[] = [];
  for (const row of rows) {
    const movements = await queryLocal<{
      lotId: string;
      movementType: string;
      quantity: number;
      previousStock: number;
      resultingStock: number;
      reason: string | null;
    }>(
      `SELECT "lotId", "movementType", quantity, "previousStock",
              "resultingStock", reason
         FROM "InventoryMovement"
        WHERE "adjustmentDocumentId" = $1
        ORDER BY "createdAt"`,
      [row.id],
    );
    docs.push({
      id: row.id,
      sequentialNumber: Number(row.sequentialNumber),
      state: row.state,
      reason: row.reason,
      notes: row.notes,
      appliedAt: isoOrNull(row.appliedAt),
      movements,
    });
  }
  return docs;
}

/**
 * Wipe the local database and wait for the app to boot again.
 *
 * The session token and workstation id live in localStorage and survive the
 * wipe, so the app returns to the login screen with an empty catalog until the
 * boot sync re-pulls it from the backend.
 *
 * `force` is required because resetLocalDatabase otherwise refuses to discard
 * sync operations the server never confirmed. That refusal is the right default
 * for a human at a terminal; a spec resetting state wants exactly that discard.
 */
export async function resetLocalDatabase(): Promise<void> {
  const requested = await browser.execute(() => {
    const devtools = window.__db;
    if (!devtools) return false;
    // Fire and forget: the page reloads mid-flight, so awaiting the promise
    // here would race the navigation the reset itself triggers.
    void devtools.reset({ force: true }).catch(() => undefined);
    return true;
  });

  if (!requested) {
    throw new Error(
      "window.__db is not available — the e2e build must set VITE_DEV_MODE=true",
    );
  }

  await browser.waitUntil(
    async () => {
      const booted = await browser.execute(() => ({
        hasDevtools: Boolean(window.__db),
        hasLoginForm: Boolean(
          document.querySelector('input[placeholder="usuario@ejemplo.com"]'),
        ),
        hasShell: Boolean(document.querySelector('nav[role="navigation"]')),
      }));
      return booted.hasDevtools && (booted.hasLoginForm || booted.hasShell);
    },
    {
      timeout: RESET_TIMEOUT_MS,
      timeoutMsg: "app never came back after the local database reset",
      interval: 500,
    },
  );
}
