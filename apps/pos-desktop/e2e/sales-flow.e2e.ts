/**
 * E2E: Sales flow — real Tauri app against the real NestJS backend.
 *
 * Every test drives `pos-desktop.exe` through WebView2 and the real sync
 * pipeline, so the only bridge to the server is HTTP. The specs assert two
 * independent things:
 *
 *   - what the cashier sees (totals, change, approval status), and
 *   - what the server actually stored (the replayed Sale, its items, the lot
 *     stock it consumed, the payment split, the DIAN document, the sync queue
 *     terminal state).
 *
 * The second half is what the previous mock-based suite could not do: the mock
 * answered `POST /sync/batch` with an empty accept list, so a sale could be
 * drawn on screen and never reach a database and the specs still passed.
 *
 * Money is never hardcoded where it can be read instead: the specs pay exactly
 * what the payment screen claims and then assert the server total equals that
 * figure, so a mismatch between the two is itself a failure.
 */

import { $, $$, browser, expect } from "@wdio/globals";
import {
  login,
  addProductToCart,
  goToPayment,
  payWithCash,
  setCashReceived,
  waitForReceiptAndNewSale,
  waitVisible,
  waitEnabled,
  waitStaysDisabled,
  clickWhenPresent,
  setInputValue,
  readPaymentTotalDue,
  expectPesos,
  resetForSpec,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  waitForNewServerSale,
  LOT_ACETAMINOFEN,
  LOT_IBUPROFENO,
  fetchLotStocks,
} from "./server-state";
import { fetchLocalClients, fetchLocalSyncMetadata } from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

// The POS login form is email-based, so the identifier typed in the UI is the
// user's email. The mock accepted any string; the real server resolves the
// identifier against username or email and rejects an empty one.
// ADMIN rather than CASHIER: the boot pulls fiscal-dian/issuer-config and the
// purchases syncs, which the CASHIER role is not permitted to read, and those
// 403s stall the boot before the sales screen. Role-level authorization is
// covered by the server e2e suite (lots-rbac, tenant-isolation), not here.
const CASHIER = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
} as const;

const ACETAMINOFEN = "Acetaminofén 500mg";
const IBUPROFENO = "Ibuprofeno 400mg";

/** IVA 19% on a 500.00 base, as seeded by the server fixture. */
const ACETAMINOFEN_TOTAL = 595;
const IBUPROFENO_TOTAL = 476;

describe("Sales flow (real Tauri app against the real backend)", () => {
  beforeEach(async () => {
    resetForSpec();
  });

  it("E2E-S01: cash sale is replayed server-side with stock and fiscal document", async () => {
    await login(CASHIER.identifier, CASHIER.password);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();

    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, ACETAMINOFEN_TOTAL, "payment screen total");

    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    // ---- Server side: the sale must exist, not just have been drawn -------
    const sale = await waitForNewServerSale(baseline);

    expect(sale.operationalState).toBe("CONFIRMED");
    expectPesos(sale.totalAmount, totalDue, "server sale total");
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].commercialName).toBe(ACETAMINOFEN);
    expect(sale.items[0].quantity).toBe(1);
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0].methodName).toBe("Efectivo");
    expectPesos(
      sale.payments[0].amount,
      totalDue,
      "server cash payment amount",
    );

    // Stock actually consumed on the server lot.
    expect(sale.lotStocks[LOT_ACETAMINOFEN]).toBe(
      stockBefore[LOT_ACETAMINOFEN] - 1,
    );

    // The replay succeeded rather than silently degrading.
    expect(sale.queue?.status).toBe("COMPLETED");
    expect(sale.queue?.lastErrorMessage ?? "").toBe("");

    // DIAN: a consecutive was consumed from the seeded resolution.
    expect(sale.fiscal).not.toBeNull();
    expect(sale.fiscal?.documentType).toBe("INVOICE");
    expect(sale.fiscal?.fullNumber).toMatch(/^POSE2E/);
  });

  it("E2E-S02: multi-item sale totals, item rows and both lots are correct server-side", async () => {
    await login(CASHIER.identifier, CASHIER.password);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await addProductToCart("ibuprofeno", IBUPROFENO);

    const cartPanelSelector =
      '//section[.//tr[.//p[contains(text(), "Acetaminofén 500mg")]]]';
    await waitVisible(cartPanelSelector, 15, 1_000, "Cart panel");
    const cartText = await (await $(cartPanelSelector)).getText();
    if (!cartText.includes(ACETAMINOFEN) || !cartText.includes(IBUPROFENO)) {
      throw new Error(
        `Cart should contain both products. Cart text: ${cartText.slice(0, 400)}`,
      );
    }

    await goToPayment();

    const totalDue = await readPaymentTotalDue();
    expectPesos(
      totalDue,
      ACETAMINOFEN_TOTAL + IBUPROFENO_TOTAL,
      "payment screen total",
    );

    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    expectPesos(sale.totalAmount, totalDue, "server sale total");
    expect(sale.items).toHaveLength(2);
    expect(sale.lotStocks[LOT_ACETAMINOFEN]).toBe(
      stockBefore[LOT_ACETAMINOFEN] - 1,
    );
    expect(sale.lotStocks[LOT_IBUPROFENO]).toBe(
      stockBefore[LOT_IBUPROFENO] - 1,
    );
  });

  it("E2E-S03: cash overpay records the same change the cashier was shown", async () => {
    await login(CASHIER.identifier, CASHIER.password);
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();

    const totalDue = await readPaymentTotalDue();
    const tendered = totalDue + 100;
    const expectedChange = 100;

    // The change panel updates live as the cashier types, before confirming.
    await setCashReceived(String(tendered));

    const changeSelector =
      '//*[contains(text(), "Cambio")]/following-sibling::*';
    await waitVisible(changeSelector, 15, 1_000, "Change value");
    const changeValue = await (await $(changeSelector)).getText();
    expectPesos(
      Number(changeValue.replace(/[^\d]/g, "")),
      expectedChange,
      "displayed change",
    );

    await waitEnabled(
      "button*=Confirmar pago",
      15,
      1_000,
      "Confirm payment button",
    );
    await (await $("button*=Confirmar pago")).click();

    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    expectPesos(sale.totalAmount, totalDue, "server sale total");
    // The register's "received" figure is replayed, so the server derives the
    // same change the cashier was shown instead of persisting 0.
    expectPesos(sale.changeAmount, expectedChange, "server change amount");
    // What the server does guarantee: the net payment it accepted covers the
    // sale exactly.
    const cashPaid = sale.payments
      .filter((p) => p.isCash)
      .reduce((sum, p) => sum + p.amount, 0);
    expectPesos(cashPaid, sale.totalAmount, "server net cash covers the total");
  });

  it("E2E-S04: split payment stores one cash and one card row server-side", async () => {
    // Make the in-app payment gateway deterministic. This gateway is a
    // POS-side mock (src/renderer/services/payment-gateway-service.mock.ts) and
    // never talks to the backend, so forcing approval here does not bypass any
    // server behaviour — the split itself is still verified against Postgres.
    await browser.execute(() => {
      (globalThis as Record<string, unknown>).__POS_E2E_APPROVE_ALL_PAYMENTS__ =
        true;
    });

    await login(CASHIER.identifier, CASHIER.password);
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();

    const totalDue = await readPaymentTotalDue();

    // Add a second payment row; the picker offers the first non-cash method
    // from the DB (Tarjeta Débito by sortOrder).
    await waitVisible("button*=Agregar método", 15, 1_000, "Add method button");
    await (await $("button*=Agregar método")).click();

    await waitVisible(
      '//select[option[contains(text(), "Tarjeta Débito")]]',
      15,
      1_000,
      "Debit method picker",
    );

    // Row 1 = Efectivo, row 2 = Tarjeta Débito. Zero the cash row and put the
    // whole total on the card so the split is exact.
    const amountInputs = await $$('input[aria-label="Valor"]');
    expect(amountInputs.length).toBeGreaterThanOrEqual(2);
    await amountInputs[0].setValue("0");
    await amountInputs[1].setValue(String(totalDue));

    await waitVisible("button*=Verificar pago", 15, 1_000, "Authorize button");
    await (await $("button*=Verificar pago")).click();
    await waitVisible(
      '//*[contains(text(), "Aprobado")]',
      15,
      1_000,
      "Approved status",
    );

    await waitEnabled(
      "button*=Confirmar pago",
      15,
      1_000,
      "Confirm payment button",
    );
    await (await $("button*=Confirmar pago")).click();

    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    expect(sale.payments).toHaveLength(2);
    const cash = sale.payments.find((p) => p.isCash);
    const card = sale.payments.find((p) => p.category === "DEBIT_CARD");
    expect(cash?.methodName).toBe("Efectivo");
    expect(card?.methodName).toBe("Tarjeta Débito");
    expectPesos(
      Number(card?.amount ?? 0),
      totalDue,
      "server card payment amount",
    );
    // Both rows together must reconcile to the sale total.
    const paid = sale.payments.reduce((sum, p) => sum + p.amount, 0);
    expectPesos(paid, totalDue, "server payment split sum");
  });

  it("E2E-S05: the POS pulls the server's clients into its local database", async () => {
    // Asserted on the POS-local database rather than only through the cart's
    // search UI, because that is where the defect lives: the server serves the
    // client correctly, the POS stores nothing, and the search then returns an
    // empty list for reasons unrelated to the UI.
    //
    // Root cause: ClientPullService is the only sync step that applies rows with
    // a raw bulk `INSERT ... ON CONFLICT` (`$executeRawUnsafe`,
    // client-pull.service.ts:407). Every other pull uses the typed ORM API. That
    // raw path needs `SharedArrayBuffer`, which only exists in a cross-origin
    // isolated context; the Tauri WebView serves the app from http://tauri.localhost
    // without COOP/COEP, so it throws "SharedArrayBuffer is not defined" and the
    // step fails after the network phase — leaving `clientsLastSyncedAt` null and
    // the local Client table holding only the seeded CONSUMIDOR FINAL.
    //
    // The old mock hid this completely: its /clients/sync returned an empty list,
    // and applyClients returns early on zero rows, so the raw path never ran.
    await login(CASHIER.identifier, CASHIER.password);

    const clients = await fetchLocalClients();
    const pulled = clients.find(
      (c) => c.identificationNumber === "900123456-7",
    );

    if (!pulled) {
      const meta = await fetchLocalSyncMetadata();
      const cursors = Object.values(meta).find((v) =>
        v?.includes("clientsLastSyncedAt"),
      );
      throw new Error(
        "the POS never pulled the server's clients into its local database, so the " +
          "cart's client search can never match anything. Local clients: " +
          `${JSON.stringify(clients)}. Sync cursors: ${cursors ?? "none"}`,
      );
    }
    expect(pulled.fullName).toBe("Cliente de Prueba E2E");

    // And the pulled client is actually usable end to end.
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("acetaminofén", ACETAMINOFEN);

    // The client selector lives in the CART panel, so it must be used before
    // moving on to the payment screen — the payment screen has no such control.
    //
    // The collapsed prompt's label is "Cliente (opcional)" or "Cliente requerido
    // para esta venta", and it only exists once the cart has items.
    //
    // `ancestor-or-self` is required: the sidebar entry IS the role="menuitem"
    // element, so a plain `ancestor::` does not exclude it and the click
    // navigates to the clients page instead of opening the selector.
    await clickWhenPresent(
      '//button[contains(., "Cliente") and not(ancestor-or-self::*[@role="menuitem"])]',
      "client selector prompt",
    );

    const clientSearchSelector =
      'input[aria-label="Buscar cliente por nombre o documento..."]';
    await waitVisible(clientSearchSelector, 20, 1_000, "Client search input");
    // Search by the bare document number: ClientsService.search only treats the
    // query as a document lookup when it is all digits (`/^\d+$/`), so the
    // formatted "900123456-7" would be matched against the client NAME and
    // return nothing.
    await setInputValue(clientSearchSelector, "900123456", "client search");

    // Each result is a role="option" button whose full name sits inside a <span>,
    // so this matches on the element's full text content (`.`), not `text()` —
    // `contains(text(), ...)` only ever sees a node's own direct text and finds
    // nothing here.
    const resultSelector =
      '//*[@role="option"][contains(., "Cliente de Prueba E2E")]';
    await waitVisible(resultSelector, 20, 500, "Client search result");
    await (await $(resultSelector)).click();

    // Only now move to payment. Choosing a client must not alter the amount.
    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(
      totalDue,
      ACETAMINOFEN_TOTAL,
      "server-facing total with a client",
    );

    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    // The identifier snapshot is what the fiscal document is issued against,
    // so a lost client is a compliance bug, not just a UI detail.
    expectPesos(sale.totalAmount, totalDue, "server sale total");
    expect(sale.fiscal?.documentType).toBe("INVOICE");
  });

  it("E2E-S06: underpaying in cash must not be confirmable", async () => {
    // Regression guard for a real money bug this suite found.
    //
    // `selectCanConfirmPayment` compares `selectPaymentTotalPaidCents` — the sum
    // of the payment METHODS' amounts — against the total. "Recibido"
    // (cashReceivedCents) is a separate field that only feeds the change panel;
    // `handleCashReceivedChange` never writes back to the method amount. So
    // lowering "Recibido" below the method amount leaves the difference at 0 and
    // the confirm button stays enabled: the cashier can take 495 for a 595 sale
    // and the sale is still booked as 595 paid.
    //
    // The correct expectation is encoded here — the button must stay disabled —
    // so this test fails until the guard also requires the cash actually
    // received to cover the cash method amount.
    await login(CASHIER.identifier, CASHIER.password);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();

    const totalDue = await readPaymentTotalDue();
    await setCashReceived(String(totalDue - 100));

    await waitStaysDisabled(
      "button*=Confirmar pago",
      10,
      500,
      "Confirm payment button — the confirm guard compares the payment METHOD " +
        "amount against the total and never looks at the cash received, so an " +
        "underpayment stays confirmable",
    );

    // No sale may exist server-side: the backend still has none.
    expect(await fetchLatestLocalNumber()).toBe(baseline);
    expect((await fetchLotStocks())[LOT_ACETAMINOFEN]).toBe(
      stockBefore[LOT_ACETAMINOFEN],
    );
  });
});

// Keep the browser reference alive for the Tauri service teardown.
void browser;
