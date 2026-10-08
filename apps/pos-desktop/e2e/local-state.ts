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
 * Deliberately no query helper: reading the local database would need async
 * script execution, and this suite deliberately avoids `executeAsyncScript`
 * (see the note at the top of e2e/helpers.ts). Everything worth asserting after
 * a flow is asserted against the real backend instead, which is the stronger
 * check anyway.
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
      devtools
        .query(statement, values)
        .then((result) => done(result))
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
