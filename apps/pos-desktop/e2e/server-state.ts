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

/** Stock the fixture seeds for every lot. A sale of n leaves INITIAL_STOCK - n. */
export const INITIAL_STOCK = 100;

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
  totalTax: number;
  totalAmount: number;
  changeAmount: number;
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
    totalTax: string;
    totalAmount: string;
    changeAmount: string;
  }>(
    `SELECT id, "localNumber", "operationalState", subtotal, "totalTax",
            "totalAmount", "changeAmount"
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
    lotId: string;
    lotQuantity: string;
  }>(
    `SELECT si."productId", p."commercialName", si.quantity,
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
    [[LOT_ACETAMINOFEN, LOT_IBUPROFENO]],
  );
  const lotStocks: Record<string, number> = {};
  for (const row of lotRows) lotStocks[row.id] = row.currentStock;

  return {
    id: sale.id,
    localNumber: Number(sale.localNumber),
    operationalState: sale.operationalState,
    subtotal: Number(sale.subtotal),
    totalTax: Number(sale.totalTax),
    totalAmount: Number(sale.totalAmount),
    changeAmount: Number(sale.changeAmount),
    items: items.map((row) => ({
      productId: row.productId,
      commercialName: row.commercialName,
      quantity: Number(row.quantity),
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
