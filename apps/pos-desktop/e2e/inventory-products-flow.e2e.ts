/**
 * E2E: Inventory products — create and update a product through the
 * Products page and verify the local mirror AND the server replay.
 *
 * The Products page writes locally-first: ProductService.createProduct writes
 * the Product row, its barcodes, the initial ProductPriceHistory /
 * ProductTaxHistory / ProductCostHistory and a PRODUCT_CREATION SyncQueue entry
 * in one local transaction; ProductService.updateProduct diffs the form against
 * the selected product and only queues PRODUCT_UPDATE for the fields that
 * actually changed.
 *
 * The server replays PRODUCT_CREATION synchronously on push (the entry leaves
 * PENDING only until the push trigger fires), which is why the creation wait is
 * seconds, not a cron tick. PRODUCT_UPDATE dispatches the same way. Every
 * spec's assertion point is therefore the SERVER row — the local row was
 * already proven by the fact the save succeeded.
 *
 * Two rules this file follows:
 *
 * 1. A product the POS creates carries an OFFLINE-{uuid} internalCode, so the
 *    POS-side row and the server row have DIFFERENT ids. The server stores the
 *    POS-local UUID in `Product.sourceProductId` and every later sale lookup
 *    goes through it, so that column is what joins the two rows.
 * 2. An update sends only the changed fields, so a whole-object comparison
 *    catches a field the update dropped from the payload (which is what a
 *    hand-picked assertion list cannot).
 *
 * Roles: PRODUCT creation AND update both go through
 * `auth.requireRole(INVENTORY_ASSISTANT, ADMIN)` locally — i.e. the OWNER is
 * NOT enough. The seeded fixture account able to do both is ADMIN.
 */

import { browser, expect } from "@wdio/globals";
import {
  signInAs,
  waitVisible,
  waitGone,
  openScreen,
  expectPageHeading,
  openHubCard,
  setInputValue,
  clickWhenPresent,
  clickButtonByExactText,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLocalProduct,
  fetchLocalProductPrice,
  queryLocal,
} from "./local-state";
import {
  waitForServerProduct,
  waitForServerProductFields,
  waitForTerminalSyncOperation,
  queryServerRaw,
} from "./server-state";
import { assertNoDefects, reconcileRow } from "./reconcile";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/** Name of the product the creation spec makes. All assertions key on this. */
const NEW_PRODUCT_NAME = "CoramPrincipal E2E 500mg";
const NEW_BARCODE = "7705555000017";
const NEW_PRICE = "5500";
const NEW_COST = "3000";

/** TAX_SCHEME_ID of the tenant fixture (IVA 19%), matched against the server. */
const TAX_SCHEME_ID = "7d1f4c60-2b98-4e35-9a0d-6c8b3e5f1d27";

/**
 * Open the Products page through the hub.
 *
 * The sidebar item "Productos" leads to the productos-main hub, whose
 * "Productos" card is what actually mounts ProductsPage — the same two-step
 * walk the purchases specs take through "Compras" → "Proveedores".
 */
async function openProductsPage(): Promise<void> {
  await openScreen("Productos");
  await openHubCard("Productos");
  await expectPageHeading("Productos");
}

/**
 * Locate a product row's Edit button inside the products table.
 *
 * The row is matched by the product NAME in the td, not by any code: the
 * OFFLINE-internalCode is truncated to 16 chars in the table, so a bad
 * branded-rule misses the same way a text match would.
 */
function editButtonInRow(productName: string): string {
  return `//tr[.//p[normalize-space(.)="${productName}"]]/td[last()]//button[@aria-label="Editar producto"]`;
}

describe("Inventory products (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-I01: a product created in the POS lands in the local mirror and is replayed server-side with every field", async () => {
    await signInAs(ADMIN);
    await openProductsPage();

    await clickButtonByExactText("Nuevo producto");
    await waitVisible("#pf-commercial-name", 20, 1_000, "product form");
    await waitVisible("#pf-price", 20, 1_000, "product form price");

    await setInputValue(
      "#pf-commercial-name",
      NEW_PRODUCT_NAME,
      "product name",
    );
    await setInputValue("#pf-concentration", "500", "concentration");
    await setInputValue("#pf-laboratory", "Tecnoquímicas E2E", "laboratory");
    await setInputValue("#pf-price", NEW_PRICE, "price");
    await setInputValue("#pf-cost", NEW_COST, "initial cost");
    await setInputValue("#pf-min-stock", "12", "minimum stock");
    await setInputValue("#pf-invima", "INVIMA-E2E-001", "INVIMA registry");

    // The barcode row is prefilled with one empty slot set as primary.
    await setInputValue(
      '#product-form input[type="text"][placeholder="Código de barras"]',
      NEW_BARCODE,
      "primary barcode",
    );

    // The close-mode save is the footer button whose text is the create-mode
    // title ("Crear producto") — NOT a type=submit button, so addressing by
    // text is the only route that reaches it deterministically.
    await clickButtonByExactText("Crear producto");

    // The form unmounts and the row appears: the structure that proves the
    // create succeeded. Same reasoning the supplier spec's `waitGone` for the
    // supplier form on P01 follows.
    await waitGone("#pf-commercial-name", 60, 500, "product form after save");

    const local = await browser.waitUntil(
      async () => fetchLocalProduct(NEW_PRODUCT_NAME),
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg: `no local Product row named ${NEW_PRODUCT_NAME} after the create`,
      },
    );

    // The offline sentinel is what makes the POS-minted internalCode visible
    // here, and the server is the one that replaces it with a real P-code.
    expect(local?.internalCode).toMatch(/^OFFLINE-/);
    expect(local?.laboratory).toBe("Tecnoquímicas E2E");
    expect(local?.concentration).toBe("500");
    expect(local?.isActive).toBe(true);
    expect(local?.barcodes).toEqual([
      { barcode: NEW_BARCODE, barcodeType: "EAN13", isPrimary: true },
    ]);

    // The active price follows the currentPriceId pointer, not the newest row
    // by date. That is what makes the POS price the cart enforces today.
    expect(local?.currentPrice).toBe(Number(NEW_PRICE));
    expect(local?.currentCost).toBe(Number(NEW_COST));

    expect(local?.currentTaxSchemeId).toBe(TAX_SCHEME_ID);

    // ---- Server side: the replay produced the row, barcodes and history.
    const server = await waitForServerProduct(NEW_PRODUCT_NAME, local.id);

    expect(server.internalCode).not.toMatch(/^OFFLINE-/);
    expect(server.laboratory).toBe("Tecnoquímicas E2E");
    expect(server.concentration).toBe("500");
    expect(server.sourceProductId).toBe(local.id);
    expect(server.currentPrice).toBe(Number(NEW_PRICE));
    expect(server.currentCost).toBe(Number(NEW_COST));
    expect(server.currentTaxSchemeId).toBe(TAX_SCHEME_ID);
    // The replay succeeded as a COMPLETED sync operation, not a stuck PENDING
    // one the spec would have waited out.
    const queue = await waitForTerminalSyncOperation("PRODUCT_CREATION");
    expect(queue.status).toBe("COMPLETED");

    // ---- Full-width local-versus-server reconciliation of the product row.
    // Hand-picking the fields above is how a dropped commission column or a
    // storage diff lives forever uncaught: the reconcile compares EVERYTHING
    // both projections carry and reports every difference at once.
    const findings = reconcileRow(
      `Product ${NEW_PRODUCT_NAME}`,
      { ...local, barcodes: undefined } as unknown as Record<string, unknown>,
      {
        ...server,
        barcodes: undefined,
        // The POS never mints a server id and never holds the server's
        // OWN internalCode — the OFFLINE- sentinel and the server's
        // sequential P-code are two different names for the same row.
        internalCode: undefined,
        id: undefined,
        // The server keeps the POS-local UUID under sourceProductId; the
        // POS does not hold the server's counterpart anywhere.
        sourceProductId: undefined,
        // A server-only display join the POS validates by construction:
        // a wrong tax scheme id here breaks the pull, not the replay.
        currentTaxSchemeId: undefined,
      } as unknown as Record<string, unknown>,
      {
        // The reader turns both sides' decimals into numbers; money fields
        // compare to the cent, text fields compare as trimmed strings.
        currentPrice: { kind: "money" },
        currentCost: { kind: "money" },
        commissionValue: { kind: "money" },
      },
    );

    assertNoDefects(findings, "product creation I01");
  });

  it("E2E-I02: editing a product's non-price fields replays server-side without touching the price", async () => {
    await signInAs(ADMIN);

    // Create the product through the UI first — the spec that comes after
    // the creation spec in the same run reuses the SAME product, but a run
    // can start at any spec, so this one must build its own subject.
    await openProductsPage();
    await clickButtonByExactText("Nuevo producto");
    await waitVisible("#pf-commercial-name", 20, 1_000, "product form");
    await setInputValue("#pf-commercial-name", "CoramEscala E2E 100mg", "name");
    await setInputValue("#pf-laboratory", "Laboratorio Base", "laboratory");
    await setInputValue("#pf-price", "4000", "price");
    await setInputValue(
      '#product-form input[type="text"][placeholder="Código de barras"]',
      "7705555000024",
      "barcode",
    );
    await clickButtonByExactText("Crear producto");
    await waitGone("#pf-commercial-name", 60, 500, "product form");

    const created = await browser.waitUntil(
      async () => fetchLocalProduct("CoramEscala E2E 100mg"),
      { timeout: 120_000, interval: 1_000, timeoutMsg: "no local product row" },
    );

    // ---- Edit: change the laboratory and the minimum stock only. The
    // Products page diffs the edited form against the selected product and
    // queues PRODUCT_UPDATE carrying ONLY the changed fields — which is
    // exactly what makes a field the update excluded observable.
    await clickWhenPresent(
      editButtonInRow("CoramEscala E2E 100mg"),
      "Edit product",
    );
    await waitVisible("#pf-laboratory", 20, 1_000, "product edit form");
    await setInputValue("#pf-laboratory", "Genfar E2E", "laboratory edit");
    await setInputValue("#pf-min-stock", "25", "minimum stock edit");
    await clickButtonByExactText("Guardar cambios");
    await waitGone("#pf-laboratory", 60, 500, "product edit form");

    // ---- Local: the mirror reads both fields AND the pointers.
    const localAfter = await fetchLocalProduct("CoramEscala E2E 100mg");
    expect(localAfter?.laboratory).toBe("Genfar E2E");
    expect(localAfter?.minimumStock).toBe(25);
    // The price the edit never touched must still be the created value: a
    // whole-row update would have shown up as a reset here.
    expect(localAfter?.currentPrice).toBe(created.currentPrice);
    expect(localAfter?.currentCost).toBe(created.currentCost);
    expect(localAfter?.internalCode).toBe(created.internalCode);

    // ---- Server: the sync entry dispatched and the server row carries the
    // same edit. PRODUCT_UPDATE does not change `reportedBy` anything about
    // the price, so the price floor and the sale-side cost snapshot stay
    // anchored on the created price.
    const replay = await waitForTerminalSyncOperation("PRODUCT_UPDATE");
    expect(replay.status).toBe("COMPLETED");

    const server = await waitForServerProductFields(["CoramEscala E2E 100mg"], {
      laboratory: "Genfar E2E",
      minimumStock: 25,
    });
    expect(server.currentPrice).toBe(created.currentPrice);
    expect(server.currentCost).toBe(created.currentCost);
    expect(server.commissionType).toBe(created.commissionType);
  });

  it("E2E-I03: changing the sale price writes a new history row and repaths currentPriceId on both stores", async () => {
    // The price edit is the one PRODUCT_UPDATE change that does NOT write a
    // scalar: the local updateProduct produces a NEW ProductPriceHistory row,
    // closes the previous one (effectiveTo = now), and repaths
    // Product.currentPriceId. The server must follow the SAME three-step
    // shape, because every later cart-price read on either side goes through
    // the pointer.
    await signInAs(ADMIN);

    await openProductsPage();
    await clickButtonByExactText("Nuevo producto");
    await waitVisible("#pf-commercial-name", 20, 1_000, "product form");
    await setInputValue("#pf-commercial-name", "Dolex Gor E2E", "name");
    await setInputValue("#pf-laboratory", "GSK E2E", "laboratory");
    await setInputValue("#pf-price", "6000", "price");
    await setInputValue(
      '#product-form input[type="text"][placeholder="Código de barras"]',
      "7705555000031",
      "barcode",
    );
    await clickButtonByExactText("Crear producto");
    await waitGone("#pf-commercial-name", 60, 500, "product form");

    const created = await browser.waitUntil(
      async () => fetchLocalProduct("Dolex Gor E2E"),
      { timeout: 120_000, interval: 1_000, timeoutMsg: "no local product row" },
    );

    await clickWhenPresent(editButtonInRow("Dolex Gor E2E"), "Edit product");
    await waitVisible("#pf-price", 20, 1_000, "product edit price");
    await setInputValue("#pf-price", "9500", "new price");
    await clickButtonByExactText("Guardar cambios");
    await waitGone("#pf-price", 60, 500, "product edit form");

    // ---- Local: the pointer moved. This is the difference between a price
    // UPDATE and a price APPEND (the second history row), and it is what
    // every later sale's cart price reads.
    const priceHist = await browser.waitUntil(
      async () => {
        const current = await fetchLocalProductPrice(created.id);
        return current?.price === 9500 ? current : false;
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          "the local currentPriceId never came to point at the 9500 row",
      },
    );
    expect(priceHist.price).toBe(9500);
    expect(priceHist.effectiveTo).toBeNull();

    // The previous row is CLOSED, not deleted or moved — that is what makes
    // the price history meaningful (a receipt built later can still cite the
    // price that was active at its time).
    const closedRows = await queryLocal<{
      id: string;
      price: string;
      effectiveTo: string | null;
    }>(
      `SELECT id, price, "effectiveTo" FROM "ProductPriceHistory"
        WHERE "productId" = $1 AND "effectiveTo" IS NOT NULL`,
      [created.id],
    );
    expect(closedRows).toHaveLength(1);
    expect(Number(closedRows[0].price)).toBe(6000);

    // ---- Server: the replay followed the SAME two-row shape. The server's
    // own reader (handleProductUpdate → ProductsService.updateProduct) must
    // close its currentPriceId row, add the new one, and repoint the product.
    await waitForTerminalSyncOperation("PRODUCT_UPDATE");

    const server = await waitForServerProductFields(["Dolex Gor E2E"], {
      currentPrice: 9500,
    });
    expect(server.currentPrice).toBe(9500);

    // Server price history: the closed row and the new one, same cardinality
    // and same prices as the local mirror.
    const serverHistory = await queryServerHistory(server.id);
    expect(serverHistory).toHaveLength(2);
    expect(serverHistory.map((h) => h.price).sort((a, b) => a - b)).toEqual([
      6000, 9500,
    ]);
    expect(serverHistory.filter((h) => h.effectiveTo !== null)).toHaveLength(1);
  });

  it("E2E-I04: creating a product with an already-used barcode is refused, and the refusal never syncs", async () => {
    await signInAs(ADMIN);

    // The seeded products carry known EAN13 barcodes starting at 7701234567890,
    // so the spec DOES NOT need a seeded-barcode import: it asks for exactly
    // the first one. A duplicate fails the create BEFORE anything is written
    // (ProductService.createProduct pre-validates with
    // DuplicateBarcodeException), and the form keeps its own state
    // asynchronously, so the row-count assertion is the provable fact.
    const stockBefore = await queryLocal<{ count: number }>(
      `SELECT count(*)::int AS count FROM "Product"`,
    );

    await openProductsPage();
    await clickButtonByExactText("Nuevo producto");
    await waitVisible("#pf-commercial-name", 20, 1_000, "product form");

    await setInputValue("#pf-commercial-name", "Duplicado E2E", "name");
    await setInputValue("#pf-laboratory", "AntiDup E2E", "laboratory");
    await setInputValue("#pf-price", "1500", "price");

    // The barcode of the SEEDED product — the create must refuse it.
    await setInputValue(
      '#product-form input[type="text"][placeholder="Código de barras"]',
      "7701234567891",
      "duplicate barcode",
    );
    await clickButtonByExactText("Crear producto");

    // The page surfaces the failure in a role=alert banner; the form stays
    // open because save unmounted NO-where. The message text carries the
    // product's name and the duplicate barcode (DuplicateBarcodeException
    // format), so matching on the BARCODE is the assertion that survives an
    // i18n change of the message's phrasing.
    await expectInlineAlert("7701234567891");

    // Nothing was written: the mirrors count the same as they did.
    const stockAfter = await queryLocal<{ count: number }>(
      `SELECT count(*)::int AS count FROM "Product"`,
    );
    expect(stockAfter[0].count).toBe(stockBefore[0].count);

    // A rejected create must not leave a PRODUCT_CREATION entry behind: the
    // queue retries such an entry forever and would eventually push the very
    // product whose create was refused — precisely the bug this spec is for.
    expect(await localProductCreationQueueCount("Duplicado E2E")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Spec-local helpers
// ---------------------------------------------------------------------------

/** The server's ProductPriceHistory rows for a server product id, ascending. */
async function queryServerHistory(
  serverProductId: string,
): Promise<Array<{ price: number; effectiveTo: string | null }>> {
  const rows = await queryServerRaw<{
    price: string;
    effectiveTo: Date | string | null;
  }>(
    `SELECT price, "effectiveTo" FROM "ProductPriceHistory"
      WHERE "productId" = $1 ORDER BY "effectiveFrom"`,
    [serverProductId],
  );
  // PGlite/ps hands the numeric back as a string and the timestamp as a Date
  // or its string form depending on the driver, so both are normalised here
  // — the spec asserts cardinality and prices, not the reader's type choice.
  return rows.map((row) => ({
    price: Number(row.price),
    effectiveTo: row.effectiveTo === null ? null : String(row.effectiveTo),
  }));
}

/** PRODUCT_CREATION queue entries whose payload mentions `productName`. */
async function localProductCreationQueueCount(
  productName: string,
): Promise<number> {
  const rows = await queryLocal<{
    payload: string;
  }>(
    `SELECT payload FROM "SyncQueue"
      WHERE "operationType" = 'PRODUCT_CREATION'`,
  );
  return rows.filter((row: { payload: string }) =>
    row.payload.includes(productName),
  ).length;
}

/** Assert an inline role=alert banner says `expected`. */
async function expectInlineAlert(expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = await lastAlertText();
    if (text.includes(expected)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no inline alert carrying "${expected}" appeared within 15s`);
}

/** Text of the last visible role=alert banner, or "" when there is none. */
async function lastAlertText(): Promise<string> {
  const { readText } = await import("./helpers");
  return readText('[role="alert"]');
}
