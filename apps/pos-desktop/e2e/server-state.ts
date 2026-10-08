/**
 * Read-only assertions against the real backend database.
 *
 * A receipt rendering in the UI is not evidence that a sale exists. These
 * helpers let a spec assert what actually landed server-side: the replayed
 * Sale row, its items and lot consumption, the payment split, the resulting
 * DIAN document, the SyncQueue terminal state and the remaining lot stock.
 * That is the only way a UI flow can prove it reached the backend.
 *
 * Connects with the owner role (BYPASSRLS) on purpose: this is the outside
 * observer. The server itself runs under the app role, so an RLS regression
 * shows up as "the app wrote nothing" instead of being masked by the assertion
 * query being subject to the same policies.
 */
import pg from "pg";
import { WORKSTATION_ID } from "./workstation-id";

/**
 * Prefixes of every fiscal document the fixture's DIAN resolutions can issue.
 * Scopes the stand-in provider to this suite's own documents.
 */
const HARNESS_PREFIXES = ["POSE2E%", "POSE2EC%"];

const OWNER_DATABASE_URL =
  process.env.POS_E2E_OWNER_DATABASE_URL ??
  "postgresql://pharmacy_test:pharmacy_test@localhost:5433/pharmacy_test_db";

export { WORKSTATION_ID };

export const LOT_ACETAMINOFEN = "c4a1f592-8e37-4d6b-9e25-1a3f7c0d8b45";
export const LOT_IBUPROFENO = "d8b2e071-4f63-4a19-8c37-6e0d5a9f2c14";

/** Catalog entry whose only lot expires inside the sales-side warning window. */
export const LOT_NITROFEN = "3f5a7c49-6b08-4d2e-a1c5-8e9f0a1b2c37";
/** Catalog entry whose only lot expired before the run started. */
export const LOT_OTRIVIN = "a8b9c0d1-4e2f-4a3b-9c4d-0e1f2a3b4c58";

/** Product ids the specs search the catalog by name. */
export const PRODUCT_ACETAMINOFEN = "b2e6d814-5c93-4f27-a1d8-3e7c9b0f5a62";
export const PRODUCT_IBUPROFENO = "5a1c8f37-9d24-4e68-b3c1-7f0a2d6e4b98";
export const PRODUCT_NITROFEN = "9e3d5a26-1b47-4f80-8a52-6c7d8e9f0a13";
export const PRODUCT_OTRIVIN = "7c4b6e38-2d59-4a91-b0e3-5f6a7b8c9d24";

/** Stock the fixture seeds for every lot. A sale of n leaves INITIAL_STOCK - n. */
export const INITIAL_STOCK = 100;

/**
 * Unit cost the fixture's purchase reception gives every lot.
 *
 * Quoted here because it is the floor the POS enforces on a price override:
 * a new unit price below this is refused by the cart, which is what makes the
 * price-floor spec meaningful.
 */
export const LOT_UNIT_COST = 8000;

/**
 * Local number of the sale the fixture seeds on a second workstation.
 *
 * The POS only learns about it through the sales pull, which is what makes the
 * cross-workstation (manager override) return path reachable.
 */
export const FOREIGN_SALE_LOCAL_NUMBER = 9001;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: OWNER_DATABASE_URL, max: 4 });
  return pool;
}

/** Release the pool. Called from the WDIO runner teardown. */
export async function closeServerStatePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ServerSaleItem {
  productId: string;
  commercialName: string;
  quantity: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  discountReason: string | null;
  lots: Array<{ lotId: string; quantity: number }>;
}

export interface ServerSalePayment {
  methodName: string;
  category: string;
  amount: number;
  isCash: boolean;
}

export interface ServerSaleState {
  id: string;
  localNumber: number;
  operationalState: string;
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  totalAmount: number;
  changeAmount: number;
  client: {
    identificationNumber: string | null;
    fullName: string | null;
  } | null;
  items: ServerSaleItem[];
  payments: ServerSalePayment[];
  fiscal: {
    documentType: string;
    fullNumber: string;
    cufe: string;
    fiscalState: string;
  } | null;
  queue: {
    operationType: string;
    status: string;
    lastErrorMessage: string | null;
  } | null;
  lotStocks: Record<string, number>;
}

/**
 * Full server-side picture of the sale the POS reports as local number
 * `localNumber`. Returns null when the replay has not produced a Sale row yet,
 * which is the normal state while the sync queue is still pending.
 */
export async function fetchServerSale(
  localNumber: number,
): Promise<ServerSaleState | null> {
  const rows = await query<{
    id: string;
    localNumber: string;
    operationalState: string;
    subtotal: string;
    totalDiscount: string;
    totalTax: string;
    totalAmount: string;
    changeAmount: string;
    clientIdentificationNumber: string | null;
    clientName: string | null;
  }>(
    `SELECT id, "localNumber", "operationalState", subtotal, "totalDiscount",
            "totalTax", "totalAmount", "changeAmount",
            "clientIdentificationNumberSnapshot" AS "clientIdentificationNumber",
            "clientNameSnapshot" AS "clientName"
       FROM "Sale"
      WHERE "sourceWorkstationId" = $1 AND "localNumber" = $2`,
    [WORKSTATION_ID, localNumber],
  );

  const sale = rows[0];
  if (!sale) return null;

  const items = await query<{
    productId: string;
    commercialName: string;
    quantity: string;
    unitPrice: string;
    discountPercentage: string;
    discountAmount: string;
    discountReason: string | null;
    lotId: string;
    lotQuantity: string;
  }>(
    `SELECT si."productId", p."commercialName", si.quantity, si."unitPrice",
            si."discountPercentage", si."discountAmount", si."discountReason",
            sil."lotId", sil.quantity AS "lotQuantity"
       FROM "SaleItem" si
       JOIN "Product" p ON p.id = si."productId"
       LEFT JOIN "SaleItemLot" sil ON sil."saleItemId" = si.id
      WHERE si."saleId" = $1
      ORDER BY sil."lotId" NULLS FIRST`,
    [sale.id],
  );

  const payments = await query<{
    methodName: string;
    category: string;
    amount: string;
    isCash: boolean;
  }>(
    `SELECT pm.name AS "methodName", pm.category, sp.amount, pm."isCash"
       FROM "SalePayment" sp
       JOIN "PaymentMethod" pm ON pm.id = sp."paymentMethodId"
      WHERE sp."saleId" = $1
      ORDER BY pm."sortOrder"`,
    [sale.id],
  );

  const fiscalRows = await query<{
    documentType: string;
    fullNumber: string;
    cufeCude: string;
    fiscalState: string;
  }>(
    `SELECT "documentType", "fullNumber", "cufeCude", "fiscalState"
       FROM "FiscalDocument"
      WHERE "saleId" = $1`,
    [sale.id],
  );
  const fiscal = fiscalRows[0];

  const queueRows = await query<{
    operationType: string;
    status: string;
    lastErrorMessage: string | null;
  }>(
    `SELECT "operationType", status, "lastErrorMessage"
       FROM "SyncQueue"
      WHERE "sourceWorkstationId" = $1
        AND "operationType" = 'SALE_CONFIRMATION'
        AND status IN ('COMPLETED', 'PERMANENT_FAILURE', 'FAILED')
      ORDER BY "processedAt" DESC NULLS LAST
      LIMIT 1`,
    [WORKSTATION_ID],
  );
  const queue = queueRows[0];

  const lotRows = await query<{ id: string; currentStock: number }>(
    `SELECT id, "currentStock" FROM "Lot" WHERE id = ANY($1::text[])`,
    [[LOT_ACETAMINOFEN, LOT_IBUPROFENO, LOT_NITROFEN, LOT_OTRIVIN]],
  );
  const lotStocks: Record<string, number> = {};
  for (const row of lotRows) lotStocks[row.id] = row.currentStock;

  return {
    id: sale.id,
    localNumber: Number(sale.localNumber),
    operationalState: sale.operationalState,
    subtotal: Number(sale.subtotal),
    totalDiscount: Number(sale.totalDiscount),
    totalTax: Number(sale.totalTax),
    totalAmount: Number(sale.totalAmount),
    changeAmount: Number(sale.changeAmount),
    client: sale.clientIdentificationNumber
      ? {
          identificationNumber: sale.clientIdentificationNumber,
          fullName: sale.clientName,
        }
      : null,
    items: items.map((row) => ({
      productId: row.productId,
      commercialName: row.commercialName,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unitPrice),
      discountPercentage: Number(row.discountPercentage),
      discountAmount: Number(row.discountAmount),
      discountReason: row.discountReason,
      lots: row.lotId
        ? [{ lotId: row.lotId, quantity: Number(row.lotQuantity) }]
        : [],
    })),
    payments: payments.map((row) => ({
      methodName: row.methodName,
      category: row.category,
      amount: Number(row.amount),
      isCash: row.isCash,
    })),
    fiscal: fiscal
      ? {
          documentType: fiscal.documentType,
          fullNumber: fiscal.fullNumber,
          cufe: fiscal.cufeCude,
          fiscalState: fiscal.fiscalState,
        }
      : null,
    queue: queue
      ? {
          operationType: queue.operationType,
          status: queue.status,
          lastErrorMessage: queue.lastErrorMessage,
        }
      : null,
    lotStocks,
  };
}

/**
 * Wait for the POS sale `localNumber` to be replayed server-side.
 *
 * The push is immediate (a queue entry fires the push trigger on commit) but
 * the server applies queued operations on its own cron tick, so the Sale row
 * appears a few seconds later. `timeoutMs` therefore covers the cron interval,
 * not just the HTTP round trip.
 */
export async function waitForServerSale(
  localNumber: number,
  timeoutMs = 90_000,
): Promise<ServerSaleState> {
  const deadline = Date.now() + timeoutMs;
  let last: ServerSaleState | null = null;

  while (Date.now() < deadline) {
    last = await fetchServerSale(localNumber);
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `sale ${localNumber} never reached the server within ${timeoutMs}ms` +
      (last ? ` (last state: ${JSON.stringify(last)})` : ""),
  );
}

/**
 * Terminal state of every sync operation this workstation pushed.
 *
 * Included in timeout messages because "no sale reached the server" is almost
 * always a failed replay rather than a missing push, and the queue row carries
 * the server's own error text.
 */
export async function describeSyncQueue(): Promise<string> {
  const rows = await query<{
    operationType: string;
    status: string;
    lastErrorMessage: string | null;
  }>(
    `SELECT "operationType", status, "lastErrorMessage"
       FROM "SyncQueue"
      WHERE "sourceWorkstationId" = $1
      ORDER BY "receivedAt" DESC NULLS LAST
      LIMIT 8`,
    [WORKSTATION_ID],
  );

  if (rows.length === 0) {
    return "no sync operations were received at all (the POS never pushed)";
  }
  return rows
    .map(
      (r) =>
        `${r.operationType}=${r.status}${r.lastErrorMessage ? ` (${r.lastErrorMessage})` : ""}`,
    )
    .join(", ");
}

/**
 * Act as the DIAN provider for invoices the POS generated.
 *
 * A credit note requires its invoice to be VALIDATED, and the server enforces
 * that (NoValidatedInvoiceForCreditNoteException). Nothing in the e2e stack can
 * actually transmit to DIAN, so invoices are left in PENDING_GENERATION forever
 * and every return would fail permanently with a rule that is correct in
 * production.
 *
 * Marking them VALIDATED is what a real transmission provider would do, scoped
 * to the e2e database. It is deliberately limited to invoices this suite's own
 * sales produced: the rows are selected by their prefix, and only while a return
 * is being processed.
 */
export async function validatePendingInvoices(): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE "FiscalDocument"
        SET "fiscalState" = 'VALIDATED',
            "ptResponseCode" = 'e2e',
            "ptResponseMessage" = 'validated by the e2e harness'
      WHERE "fiscalState" IN ('PENDING_GENERATION', 'PENDING_SIGNATURE', 'PENDING_TRANSMISSION')
        AND "fullNumber" LIKE ANY ($1::text[])
      RETURNING id`,
    [HARNESS_PREFIXES],
  );
  return rows.length;
}

/**
 * Make the foreign sale visible to the POS's next sales pull.
 *
 * The pull is incremental: it asks for sales changed since the cursor in
 * localStorage, and that cursor is set to "now" after every successful pull.
 * The local-database reset each spec performs wipes PGlite but not
 * localStorage, so a sale dated before the first pull of the run can never be
 * re-fetched and the spec would wait for a row that can no longer arrive.
 *
 * Bumping `lastModifiedAt` is what actually makes another workstation's change
 * propagate to this device, so it is the same signal the product relies on —
 * scoped to the seeded sale and to this call.
 */
export async function touchForeignSale(): Promise<void> {
  await query(
    `UPDATE "Sale"
        SET "lastModifiedAt" = now()
      WHERE "localNumber" = $1`,
    [String(FOREIGN_SALE_LOCAL_NUMBER)],
  );
}

/** Current stock of both seeded lots, for before/after comparisons. */
export async function fetchLotStocks(): Promise<Record<string, number>> {
  const rows = await query<{ id: string; currentStock: number }>(
    `SELECT id, "currentStock" FROM "Lot" WHERE id = ANY($1::text[])`,
    [[LOT_ACETAMINOFEN, LOT_IBUPROFENO]],
  );
  const stocks: Record<string, number> = {};
  for (const row of rows) stocks[row.id] = row.currentStock;
  return stocks;
}

/**
 * Highest local sale number the server has replayed for this workstation.
 *
 * Read before a flow and passed to `waitForNewServerSale`, which is how a spec
 * identifies its own sale: the suite does not reset the database between specs
 * (that would destroy the session the app is holding), so "the newest sale" is
 * only meaningful relative to a baseline.
 */
export async function fetchLatestLocalNumber(): Promise<number> {
  const rows = await query<{ max: string | null }>(
    `SELECT MAX("localNumber") AS max
       FROM "Sale"
      WHERE "sourceWorkstationId" = $1`,
    [WORKSTATION_ID],
  );
  return Number(rows[0]?.max ?? 0);
}

/**
 * Wait for a sale with a local number greater than `previousLocalNumber`.
 *
 * Waiting rather than reading first is essential: the receipt renders as soon
 * as the sale is CONFIRMED locally, while the push and the server's own replay
 * land seconds later. Reading the number first races the sync and would report
 * "the sale never reached the server" for a sale that is about to arrive.
 */
export async function waitForNewServerSale(
  previousLocalNumber: number,
  timeoutMs = 120_000,
): Promise<ServerSaleState> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const latest = await fetchLatestLocalNumber();
    if (latest > previousLocalNumber) {
      const sale = await fetchServerSale(latest);
      if (sale) return sale;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `no sale newer than #${previousLocalNumber} reached the server within ${timeoutMs}ms. ` +
      `Sync queue: ${await describeSyncQueue()}`,
  );
}

// ---------------------------------------------------------------------------
// Client returns
// ---------------------------------------------------------------------------

export interface ServerClientReturn {
  id: string;
  sequentialNumber: number;
  state: string;
  refundAmount: number;
  creditNoteFullNumber: string | null;
  lotQuantities: Array<{ lotId: string; quantity: number }>;
}

/**
 * Client returns this workstation pushed, newest first.
 *
 * A return is a CLIENT_RETURN sync operation, not a sale, so it is asserted on
 * its own table. A refund that only exists in the POS is a refund the pharmacy
 * gave away without the server knowing.
 */
export async function fetchServerClientReturns(): Promise<
  ServerClientReturn[]
> {
  const rows = await query<{
    id: string;
    sequentialNumber: number;
    state: string;
    refundAmount: string;
    creditNoteFullNumber: string | null;
  }>(
    `SELECT cr.id, cr."sequentialNumber", cr.state, cr."refundAmount",
            fd."fullNumber" AS "creditNoteFullNumber"
       FROM "ClientReturn" cr
       LEFT JOIN "FiscalDocument" fd ON fd.id = cr."creditNoteId"
      WHERE cr."workstationId" = $1
      ORDER BY cr."createdAt" DESC`,
    [WORKSTATION_ID],
  );

  const returns: ServerClientReturn[] = [];
  for (const row of rows) {
    const lots = await query<{ lotId: string; quantity: number }>(
      `SELECT cil."lotId", cil.quantity
         FROM "ClientReturnItemLot" cil
         JOIN "ClientReturnItem" cri ON cri.id = cil."clientReturnItemId"
        WHERE cri."clientReturnId" = $1`,
      [row.id],
    );
    returns.push({
      id: row.id,
      sequentialNumber: row.sequentialNumber,
      state: row.state,
      refundAmount: Number(row.refundAmount),
      creditNoteFullNumber: row.creditNoteFullNumber,
      lotQuantities: lots.map((lot) => ({
        lotId: lot.lotId,
        quantity: Number(lot.quantity),
      })),
    });
  }
  return returns;
}

/** Wait until at least one client return has been replayed server-side. */
export async function waitForServerClientReturn(
  timeoutMs = 90_000,
): Promise<ServerClientReturn> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = await fetchServerClientReturns();
    if (found.length > 0) return found[0];
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`no client return reached the server within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Sync queue
// ---------------------------------------------------------------------------

export interface ServerSyncQueueRow {
  operationType: string;
  status: string;
  retryCount: number;
  lastErrorMessage: string | null;
  processedAt: string | null;
}

/**
 * Every operation of `operationType` this workstation pushed, newest first.
 *
 * Used by the flows that are not sales (client creation, purchase
 * confirmations): the replayed entity is the proof, but the queue row is what
 * distinguishes "replayed and accepted" from "replayed and rejected", and the
 * server's own `lastErrorMessage` is the only place the reason appears.
 */
export async function fetchServerSyncOperations(
  operationType: string,
  limit = 10,
): Promise<ServerSyncQueueRow[]> {
  return query<{
    operationType: string;
    status: string;
    retryCount: number;
    lastErrorMessage: string | null;
    processedAt: string | null;
  }>(
    `SELECT "operationType", status, "retryCount", "lastErrorMessage", "processedAt"
       FROM "SyncQueue"
      WHERE "sourceWorkstationId" = $1 AND "operationType" = $2
      ORDER BY "receivedAt" DESC NULLS LAST
      LIMIT $3`,
    [WORKSTATION_ID, operationType, limit],
  );
}

/**
 * Wait until an operation of `operationType` reaches a terminal status.
 *
 * PENDING is the normal state right after the POS pushes, so waiting for a
 * terminal state rather than for the row's existence is what makes this
 * meaningful: a row that only ever sits in PENDING means the push never
 * arrived, which is a different failure from a rejected replay.
 */
export async function waitForTerminalSyncOperation(
  operationType: string,
  timeoutMs = 120_000,
): Promise<ServerSyncQueueRow> {
  const deadline = Date.now() + timeoutMs;
  let seen = "none";

  while (Date.now() < deadline) {
    const rows = await fetchServerSyncOperations(operationType, 1);
    if (rows.length > 0) {
      const row = rows[0];
      if (row.status !== "PENDING" && row.status !== "PROCESSING") {
        return row;
      }
      seen = `${row.operationType}=${row.status}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `no ${operationType} operation reached a terminal status within ${timeoutMs}ms ` +
      `(last seen: ${seen}). Queue: ${await describeSyncQueue()}`,
  );
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export interface ServerLot {
  id: string;
  batchNumber: string;
  expirationDate: string;
  entryDate: string;
  state: string;
  currentStock: number;
  locationCode: string | null;
  productId: string;
  commercialName: string;
}

/**
 * Every lot the server knows, keyed by batch number.
 *
 * Batch number is the join key a reception actually uses: the POS sends the
 * lot's `batchNumber` in the sync payload and the server resolves the lot by
 * it, so a reception's effect is verified by looking the batch up rather than
 * by guessing the uuid the server generated.
 */
export async function fetchServerLots(): Promise<ServerLot[]> {
  const rows = await query<{
    id: string;
    batchNumber: string;
    expirationDate: Date;
    entryDate: Date;
    state: string;
    currentStock: number;
    locationCode: string | null;
    productId: string;
    commercialName: string;
  }>(
    `SELECT l.id, l."batchNumber", l."expirationDate", l."entryDate", l.state,
            l."currentStock", l."locationCode", l."productId", p."commercialName"
       FROM "Lot" l
       JOIN "Product" p ON p.id = l."productId"
      ORDER BY l."entryDate", l."batchNumber"`,
  );
  return rows.map((row) => ({
    id: row.id,
    batchNumber: row.batchNumber,
    expirationDate: row.expirationDate.toISOString(),
    entryDate: row.entryDate.toISOString(),
    state: row.state,
    currentStock: row.currentStock,
    locationCode: row.locationCode,
    productId: row.productId,
    commercialName: row.commercialName,
  }));
}

/** Lot carrying `batchNumber`, or null when the replay never created it. */
export async function fetchServerLotByBatch(
  batchNumber: string,
): Promise<ServerLot | null> {
  const lots = await fetchServerLots();
  return lots.find((lot) => lot.batchNumber === batchNumber) ?? null;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export interface ServerPurchaseOrder {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  supplierName: string;
  subtotal: number;
  totalAmount: number;
  items: Array<{
    productId: string;
    commercialName: string;
    requestedQuantity: number;
    receivedQuantity: number;
    pendingQuantity: number;
    expectedUnitCost: number;
  }>;
}

/**
 * Purchase orders the POS confirmed, newest first.
 *
 * A purchase order has no workstation column — it is tenant-scoped — so this is
 * read by the supplier and the sequential number rather than filtered by
 * source, like a sale is.
 */
export async function fetchServerPurchaseOrders(
  supplierIdentificationNumber?: string,
): Promise<ServerPurchaseOrder[]> {
  const rows = await query<{
    id: string;
    sequentialNumber: number;
    state: string;
    supplierId: string;
    supplierName: string;
    supplierIdentification: string;
    subtotal: string;
    totalAmount: string;
  }>(
    `SELECT po.id, po."sequentialNumber", po.state, po."supplierId",
            s."businessName" AS "supplierName",
            s."identificationNumber" AS "supplierIdentification",
            po.subtotal, po."totalAmount"
       FROM "PurchaseOrder" po
       JOIN "Supplier" s ON s.id = po."supplierId"
      WHERE $1::text IS NULL OR s."identificationNumber" = $1
      ORDER BY po."createdAt" DESC`,
    [supplierIdentificationNumber ?? null],
  );

  const orders: ServerPurchaseOrder[] = [];
  for (const row of rows) {
    const items = await query<{
      productId: string;
      commercialName: string;
      requestedQuantity: string;
      receivedQuantity: string;
      pendingQuantity: string;
      expectedUnitCost: string;
    }>(
      `SELECT poi."productId", p."commercialName", poi."requestedQuantity",
              poi."receivedQuantity", poi."pendingQuantity", poi."expectedUnitCost"
         FROM "PurchaseOrderItem" poi
         JOIN "Product" p ON p.id = poi."productId"
        WHERE poi."purchaseOrderId" = $1
        ORDER BY p."commercialName"`,
      [row.id],
    );
    orders.push({
      id: row.id,
      sequentialNumber: row.sequentialNumber,
      state: row.state,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      subtotal: Number(row.subtotal),
      totalAmount: Number(row.totalAmount),
      items: items.map((item) => ({
        productId: item.productId,
        commercialName: item.commercialName,
        requestedQuantity: Number(item.requestedQuantity),
        receivedQuantity: Number(item.receivedQuantity),
        pendingQuantity: Number(item.pendingQuantity),
        expectedUnitCost: Number(item.expectedUnitCost),
      })),
    });
  }
  return orders;
}

/** Wait until a purchase order for `supplierIdentificationNumber` is CONFIRMED. */
export async function waitForServerPurchaseOrder(
  supplierIdentificationNumber: string,
  timeoutMs = 120_000,
): Promise<ServerPurchaseOrder> {
  const deadline = Date.now() + timeoutMs;
  let seen = "none";

  while (Date.now() < deadline) {
    const orders = await fetchServerPurchaseOrders(
      supplierIdentificationNumber,
    );
    const confirmed = orders.find((order) => order.state === "CONFIRMED");
    if (confirmed) return confirmed;
    if (orders.length > 0)
      seen = `order #${orders[0].sequentialNumber}=${orders[0].state}`;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `no CONFIRMED purchase order for supplier ${supplierIdentificationNumber} ` +
      `within ${timeoutMs}ms (last seen: ${seen}). Queue: ${await describeSyncQueue()}`,
  );
}

export interface ServerPurchaseReception {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  purchaseOrderId: string | null;
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  items: Array<{
    productId: string;
    commercialName: string;
    lotId: string | null;
    batchNumber: string | null;
    receivedQuantity: number;
    realUnitCost: number;
    taxRate: number;
    expirationDate: string | null;
  }>;
}

/** Purchase receptions the POS confirmed, newest first. */
export async function fetchServerPurchaseReceptions(): Promise<
  ServerPurchaseReception[]
> {
  const rows = await query<{
    id: string;
    sequentialNumber: number;
    state: string;
    supplierId: string;
    purchaseOrderId: string | null;
    subtotal: string;
    totalTax: string;
    totalAmount: string;
  }>(
    `SELECT id, "sequentialNumber", state, "supplierId", "purchaseOrderId",
            subtotal, "totalTax", "totalAmount"
       FROM "PurchaseReception"
      ORDER BY "sequentialNumber" DESC`,
  );

  const receptions: ServerPurchaseReception[] = [];
  for (const row of rows) {
    const items = await query<{
      productId: string;
      commercialName: string;
      lotId: string | null;
      batchNumber: string | null;
      receivedQuantity: string;
      realUnitCost: string;
      taxRate: string;
      expirationDate: Date | null;
    }>(
      `SELECT pri."productId", p."commercialName", pri."lotId",
              l."batchNumber", pri."receivedQuantity", pri."realUnitCost",
              pri."taxRate", pri."expirationDate"
         FROM "PurchaseReceptionItem" pri
         JOIN "Product" p ON p.id = pri."productId"
         LEFT JOIN "Lot" l ON l.id = pri."lotId"
        WHERE pri."purchaseReceptionId" = $1
        ORDER BY p."commercialName"`,
      [row.id],
    );
    receptions.push({
      id: row.id,
      sequentialNumber: row.sequentialNumber,
      state: row.state,
      supplierId: row.supplierId,
      purchaseOrderId: row.purchaseOrderId,
      subtotal: Number(row.subtotal),
      totalTax: Number(row.totalTax),
      totalAmount: Number(row.totalAmount),
      items: items.map((item) => ({
        productId: item.productId,
        commercialName: item.commercialName,
        lotId: item.lotId,
        batchNumber: item.batchNumber,
        receivedQuantity: Number(item.receivedQuantity),
        realUnitCost: Number(item.realUnitCost),
        taxRate: Number(item.taxRate),
        expirationDate: item.expirationDate
          ? item.expirationDate.toISOString()
          : null,
      })),
    });
  }
  return receptions;
}

/**
 * Wait for a reception whose lot carries `batchNumber`.
 *
 * Keyed on the lot because that is the observable the purchase flow really
 * produces: stock that arrived under a new batch. A reception row that exists
 * without its lot would be a receipt the pharmacy cannot sell.
 */
export async function waitForServerReceptionWithLot(
  batchNumber: string,
  timeoutMs = 120_000,
): Promise<ServerPurchaseReception> {
  const deadline = Date.now() + timeoutMs;
  let seen = "no reception with that lot";

  while (Date.now() < deadline) {
    const receptions = await fetchServerPurchaseReceptions();
    const match = receptions.find((reception) =>
      reception.items.some((item) => item.batchNumber === batchNumber),
    );
    if (match) return match;
    seen = `receptions: ${JSON.stringify(
      receptions.map((r) => r.sequentialNumber),
    )}`;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `no reception carrying lot ${batchNumber} reached the server within ` +
      `${timeoutMs}ms (last seen: ${seen}). Queue: ${await describeSyncQueue()}`,
  );
}

export interface ServerSupplier {
  id: string;
  identificationType: string;
  identificationNumber: string;
  businessName: string;
  paymentTermsDays: number;
  creditLimit: number;
  isActive: boolean;
}

/** Every supplier the server knows, by identification number. */
export async function fetchServerSuppliers(): Promise<ServerSupplier[]> {
  const rows = await query<{
    id: string;
    identificationType: string;
    identificationNumber: string;
    businessName: string;
    paymentTermsDays: number;
    creditLimit: string;
    isActive: boolean;
  }>(
    `SELECT id, "identificationType", "identificationNumber", "businessName",
            "paymentTermsDays", "creditLimit", "isActive"
       FROM "Supplier"
      ORDER BY "identificationNumber"`,
  );
  return rows.map((row) => ({
    id: row.id,
    identificationType: row.identificationType,
    identificationNumber: row.identificationNumber,
    businessName: row.businessName,
    paymentTermsDays: row.paymentTermsDays,
    creditLimit: Number(row.creditLimit),
    isActive: row.isActive,
  }));
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export interface ServerClient {
  id: string;
  identificationType: string;
  identificationNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  municipality: string | null;
  department: string | null;
  isActive: boolean;
}

/** Clients the server knows, by identification number. */
export async function fetchServerClients(): Promise<ServerClient[]> {
  const rows = await query<{
    id: string;
    identificationType: string;
    identificationNumber: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    municipality: string | null;
    department: string | null;
    isActive: boolean;
  }>(
    `SELECT id, "identificationType", "identificationNumber", "fullName", email,
            phone, municipality, department, "isActive"
       FROM "Client"
      ORDER BY "identificationNumber"`,
  );
  return rows.map((row) => ({
    id: row.id,
    identificationType: row.identificationType,
    identificationNumber: row.identificationNumber,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    municipality: row.municipality,
    department: row.department,
    isActive: row.isActive,
  }));
}

/**
 * Wait until the server holds a client with `identificationNumber`.
 *
 * The POS creates the client locally and pushes CLIENT_CREATION, so the row
 * appears a few seconds after the form reports success. The identification
 * number is the key because it is the one field the client form requires and
 * the one the server treats as the client's identity.
 */
export async function waitForServerClient(
  identificationNumber: string,
  timeoutMs = 120_000,
): Promise<ServerClient> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = (await fetchServerClients()).find(
      (client) => client.identificationNumber === identificationNumber,
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `client ${identificationNumber} never reached the server within ${timeoutMs}ms. ` +
      `Queue: ${await describeSyncQueue()}`,
  );
}

/** Wait until the server-side copy of a client reports `isActive`. */
export async function waitForServerClientActiveState(
  identificationNumber: string,
  isActive: boolean,
  timeoutMs = 120_000,
): Promise<ServerClient> {
  const deadline = Date.now() + timeoutMs;
  let last: ServerClient | undefined;

  while (Date.now() < deadline) {
    last = (await fetchServerClients()).find(
      (client) => client.identificationNumber === identificationNumber,
    );
    if (last && last.isActive === isActive) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `client ${identificationNumber} never reached isActive=${isActive} within ` +
      `${timeoutMs}ms (last: ${JSON.stringify(last)}). ` +
      `Queue: ${await describeSyncQueue()}`,
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface ServerUser {
  id: string;
  username: string;
  email: string | null;
  fullName: string;
  role: string;
  status: string;
  isActive: boolean;
  authMethod: string | null;
  pinHash: string | null;
  deletedAt: string | null;
}

/** Every user the server knows, by username. */
export async function fetchServerUsers(): Promise<ServerUser[]> {
  const rows = await query<{
    id: string;
    username: string;
    email: string | null;
    fullName: string;
    role: string;
    status: string;
    isActive: boolean;
    authMethod: string | null;
    pinHash: string | null;
    deletedAt: Date | null;
  }>(
    `SELECT id, username, email, "fullName", role, status, "isActive",
            "authMethod", "pinHash", "deletedAt"
       FROM "User"
      ORDER BY username`,
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    status: row.status,
    isActive: row.isActive,
    authMethod: row.authMethod,
    pinHash: row.pinHash,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }));
}

/**
 * Wait until the server holds a user with `username`.
 *
 * The POS user-management screen calls the users API directly (these actions
 * are not queued for sync), so the row exists as soon as the call returns —
 * this wait covers the network round trip rather than a replay cron.
 */
export async function waitForServerUser(
  username: string,
  timeoutMs = 30_000,
): Promise<ServerUser> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const found = (await fetchServerUsers()).find(
      (user) => user.username === username,
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `user "${username}" never reached the server within ${timeoutMs}ms. ` +
      `Users: ${JSON.stringify((await fetchServerUsers()).map((u) => u.username))}`,
  );
}

/** Wait until the server-side copy of a user reports `status`. */
export async function waitForServerUserStatus(
  username: string,
  status: string,
  timeoutMs = 30_000,
): Promise<ServerUser> {
  const deadline = Date.now() + timeoutMs;
  let last: ServerUser | undefined;

  while (Date.now() < deadline) {
    last = (await fetchServerUsers()).find(
      (user) => user.username === username,
    );
    if (last && last.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `user "${username}" never reached status ${status} within ${timeoutMs}ms ` +
      `(last: ${JSON.stringify(last)})`,
  );
}

// ---------------------------------------------------------------------------
// Tenant configuration
// ---------------------------------------------------------------------------

export interface ServerTenantConfig {
  id: string;
  activePresetCode: string | null;
  configVersion: number;
  strictness: Record<string, unknown>;
  purchases: Record<string, unknown>;
  workflow: Record<string, unknown>;
  lastModifiedById: string | null;
}

function readConfigSection(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * The tenant configuration row, or null before the POS has ever saved one.
 *
 * `TenantConfigService.getBySubscription` serves a computed BALANCED default
 * when no row exists and `update` creates the row on the first PUT, so a null
 * here is a legitimate state and not a fixture gap.
 */
export async function fetchServerTenantConfig(): Promise<ServerTenantConfig | null> {
  const rows = await query<{
    id: string;
    activePresetCode: string | null;
    configVersion: number;
    strictness: unknown;
    purchases: unknown;
    workflow: unknown;
    lastModifiedById: string | null;
  }>(
    `SELECT id, "activePresetCode", "configVersion", strictness, purchases,
            workflow, "lastModifiedById"
       FROM "TenantConfig"
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    activePresetCode: row.activePresetCode,
    configVersion: row.configVersion,
    strictness: readConfigSection(row.strictness),
    purchases: readConfigSection(row.purchases),
    workflow: readConfigSection(row.workflow),
    lastModifiedById: row.lastModifiedById,
  };
}

/**
 * Wait until `section.key` of the tenant config equals `expected`.
 *
 * The POS config tabs save on every control change and send the version they
 * read, so two changes fired back to back race: the second sends a stale
 * `expectedConfigVersion` and the server rejects it with a conflict, which
 * replaces the whole config page with an error screen. A spec must therefore
 * wait for the persisted value after each change rather than flipping the next
 * control immediately — this helper is that wait.
 */
export async function waitForTenantConfigValue(
  section: "purchases" | "strictness" | "workflow",
  key: string,
  expected: unknown,
  timeoutMs = 60_000,
): Promise<ServerTenantConfig> {
  const deadline = Date.now() + timeoutMs;
  let last = "no config row";

  while (Date.now() < deadline) {
    const config = await fetchServerTenantConfig();
    if (config) {
      const actual = config[section][key];
      last = `${section}.${key}=${JSON.stringify(actual)} (v${config.configVersion})`;
      if (actual === expected) return config;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `tenant config ${section}.${key} never reached ${JSON.stringify(expected)} ` +
      `within ${timeoutMs}ms (last: ${last})`,
  );
}

/** Changelog rows the config page's saves produced, newest first. */
export async function fetchServerConfigChangelog(limit = 10): Promise<
  Array<{
    configVersion: number;
    changeType: string;
    fieldPath: string | null;
    actorUserId: string | null;
  }>
> {
  return query<{
    configVersion: number;
    changeType: string;
    fieldPath: string | null;
    actorUserId: string | null;
  }>(
    `SELECT cc."configVersion", cc."changeType", cc."fieldPath", cc."actorUserId"
       FROM "ConfigChangelog" cc
       JOIN "TenantConfig" tc ON tc.id = cc."tenantConfigId"
      ORDER BY cc."createdAt" DESC
      LIMIT $1`,
    [limit],
  );
}
