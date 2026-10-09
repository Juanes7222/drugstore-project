/**
 * E2E: Purchases — suppliers, purchase orders, receptions, and the cost change a
 * reception causes.
 *
 * Drives the real Tauri app against the real NestJS backend, so the whole
 * purchase chain is verified through the HTTP wire: supplier → order → reception
 * → new lot with stock and a cost → and finally a sale that consumes it.
 *
 * Three things about this flow shape the specs:
 *
 * 1. **A reception must go through a confirmed order.** The standalone
 *    reception form builds its item rows without a `taxSchemeId`, which the
 *    column requires, so it fails in PGlite. The "Recibir" action on a
 *    CONFIRMED order is the path that fills the tax scheme in, and it is the
 *    one a pharmacy actually uses (goods arrive against an order).
 *
 * 2. **Supplier creation is local-only.** `SyncOperationType` has no supplier
 *    member and `SuppliersService.create` queues nothing, so the supplier table
 *    is the place its creation is verified. The orders then use the *seeded*
 *    supplier, which the server knows.
 *
 * 3. **Confirming a reception writes the product's cost.** That is what makes
 *    the last two specs possible at all: the catalog sync never pulls cost
 *    histories, so a freshly pulled product has no cost, the cart's price floor
 *    is inert, and the sale's `unitCost` snapshot has nothing to read. The
 *    reception is the only thing that puts a cost on a product locally.
 */

import { browser, expect } from "@wdio/globals";
import {
  signInAs,
  addProductToCart,
  goToPayment,
  payWithCash,
  waitForReceiptAndNewSale,
  readPaymentTotalDue,
  readCartPriceError,
  isCartPriceEditing,
  setCartLinePrice,
  waitVisible,
  waitEnabled,
  waitGone,
  expectAlert,
  expectPageHeading,
  openHubCard,
  openScreen,
  describeScreen,
  setInputValue,
  setDateInputValue,
  selectSearchableOption,
  clickWhenPresent,
  clickButtonByExactText,
  expectPesos,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  fetchLotStocks,
  waitForNewServerSale,
  waitForTerminalSyncOperation,
  fetchServerSuppliers,
  waitForServerPurchaseOrder,
  waitForServerReceptionWithLot,
  fetchServerLotByBatch,
  fetchServerPurchaseOrders,
  describeSyncQueue,
  PRODUCT_IBUPROFENO,
  LOT_IBUPROFENO,
} from "./server-state";
import {
  fetchLocalSuppliers,
  fetchLocalLots,
  fetchLocalPurchaseOrders,
  fetchLocalPurchaseReceptions,
  fetchLocalProductCost,
} from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

const SEEDED_SUPPLIER = {
  identificationNumber: "900123456-1",
  businessName: "POS E2E Supplier",
};

/** Lot number and quantity the reception specs book in. */
const RECEIVED_BATCH = "LOT-E2E-100";
const RECEIVED_QUANTITY = 100;
/** Unit cost typed at reception — 4000, half the seeded 8000. */
const RECEIVED_UNIT_COST = 4000;
/** YYYY-MM-DD, ~14 months out, so it can never look near-expiry mid-run. */
const RECEIVED_EXPIRATION = "2027-12-31";

const IBUPROFENO = "Ibuprofeno 400mg";

/**
 * The order detail heading.
 *
 * `normalize-space(.)` and not `normalize-space(text())`: the heading renders as
 * `{orderTitle} #{sequentialNumber}`, which React emits as TWO adjacent text
 * nodes. `text()` yields only the first of them — "Orden de compra" — so the
 * `#` this predicate anchors on never appears and the heading reads as absent
 * even though the page plainly shows "ORDEN DE COMPRA #1". `.` is the element's
 * full string value, so it concatenates both nodes.
 */
const ORDER_DETAIL_HEADING =
  '//h2[starts-with(normalize-space(.),"Orden de compra #")]';

/**
 * The order page's own `<h1>`, which reads "Orden de compra" for the detail
 * view — distinct from the `<h2>` above, which carries the sequential number.
 */
const ORDER_DETAIL_PAGE_HEADING = '//h1[normalize-space(.)="Orden de compra"]';

describe("Purchases flow (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-P01: a supplier created in the POS lands in the local mirror and stays there across a pull", async () => {
    await signInAs(ADMIN);

    const serverBefore = (await fetchServerSuppliers()).map(
      (s) => s.identificationNumber,
    );
    expect(serverBefore).toContain(SEEDED_SUPPLIER.identificationNumber);

    await openScreen("Compras");
    await expectPageHeading("Compras");
    await openHubCard("Proveedores");
    await expectPageHeading("Proveedores");

    await waitEnabled("button*=Nuevo proveedor", 20, 1_000, "Nuevo proveedor");
    await clickWhenPresent("button*=Nuevo proveedor", "Nuevo proveedor");
    await waitVisible("#supplier-id-type", 20, 1_000, "supplier form");

    // Only the identification number and the business name are enforced
    // (supplier-form.tsx); the rest prove the optional fields round-trip.
    await setInputValue("#supplier-id-number", "901555777-9", "supplier NIT");
    await setInputValue(
      "#supplier-business-name",
      "Distribuidora E2E S.A.S.",
      "supplier name",
    );
    await setInputValue("#supplier-contact", "Juan Pérez", "supplier contact");
    await setInputValue("#supplier-phone", "6015551234", "supplier phone");
    await setInputValue(
      "#supplier-email",
      "compras@proveedor-e2e.local",
      "supplier email",
    );
    await setInputValue("#supplier-payment-terms", "45", "payment terms");
    await setInputValue("#supplier-credit-limit", "5000000", "credit limit");

    await clickWhenPresent('form button[type="submit"]', "Crear");

    // Success is structural here: the purchase screens have no toast, so the
    // form unmounting and the row appearing is the confirmation.
    await waitGone("#supplier-id-type", 30, 500, "supplier form after save");

    const local = await fetchLocalSuppliers();
    const created = local.find((s) => s.identificationNumber === "901555777-9");
    expect(created).toBeDefined();
    expect(created?.businessName).toBe("Distribuidora E2E S.A.S.");
    expect(created?.contactName ?? null).toBe("Juan Pérez");
    expect(Number(created?.paymentTermsDays)).toBe(45);
    expect(created?.isActive).toBe(true);

    await waitVisible(
      '//tr[td[normalize-space(.)="901555777-9"]]',
      20,
      500,
      "new supplier row",
    );

    // The server is deliberately NOT written to: suppliers are a pull-only
    // mirror in this architecture. Asserting the absence is what stops this spec
    // from quietly passing on a future supplier-push change that was never
    // exercised by the rest of the chain.
    const serverAfter = await fetchServerSuppliers();
    expect(
      serverAfter.some((s) => s.identificationNumber === "901555777-9"),
    ).toBe(false);

    // A duplicate identification is refused rather than silently creating a
    // second supplier with the same NIT.
    await clickWhenPresent("button*=Nuevo proveedor", "Nuevo proveedor");
    await waitVisible("#supplier-id-type", 20, 1_000, "second supplier form");
    await setInputValue("#supplier-id-number", "901555777-9", "duplicate NIT");
    await setInputValue(
      "#supplier-business-name",
      "Distribuidora Duplicada",
      "duplicate name",
    );
    await clickWhenPresent('form button[type="submit"]', "Crear");
    await expectAlert("901555777-9");

    const afterDuplicate = await fetchLocalSuppliers();
    expect(
      afterDuplicate.filter((s) => s.identificationNumber === "901555777-9"),
    ).toHaveLength(1);
  });

  it("E2E-P02: a purchase order confirmed in the POS is replayed server-side with its items", async () => {
    await signInAs(ADMIN);

    await openScreen("Compras");
    await expectPageHeading("Compras");
    await openHubCard("Órdenes de compra");
    await expectPageHeading("Órdenes de compra");

    const orderBefore = (await fetchLocalPurchaseOrders()).length;

    // Exact text, not `button*=Nueva orden`: the partial selector reported a
    // successful click while the form never opened, so the create could not
    // even start. The hub card is the other route to this same form and is used
    // by the spec below.
    await clickButtonByExactText("+ Nueva orden");
    // The create page's heading is the page component's `<h1>`; the form itself
    // renders no heading at all, so an `<h2>` here never matches.
    await expectPageHeading("Nueva orden de compra");
    await waitVisible(
      '//h1[normalize-space(.)="Nueva orden de compra"]',
      20,
      1_000,
      "purchase order form",
    );

    // SearchableSelect has no aria-label here — only a placeholder — and its option
    // list is portalled to document.body with a mousedown listener that closes it
    // on an outside click, so the choice is committed with Enter rather than a
    // driver click on the <li>.
    await selectSearchableOption(
      'input[placeholder="Buscar proveedor..."]',
      SEEDED_SUPPLIER.businessName,
      "supplier",
    );

    // "Agregar producto" is disabled until a supplier is chosen, so its
    // enabled state doubles as the confirmation that the selection stuck.
    await waitEnabled(
      "button*=Agregar producto",
      20,
      1_000,
      "Agregar producto",
    );
    await clickWhenPresent("button*=Agregar producto", "Agregar producto");

    await selectSearchableOption(
      'input[placeholder="Buscar producto..."]',
      IBUPROFENO,
      "product",
    );

    // Quantity and unit cost carry no id, aria-label or `for`, so they are
    // addressed by their position in the ROW'S OWN node-set rather than by a
    // per-parent `[2]` predicate: the two controls sit in separate wrappers, so
    // each is the first number input of its own parent and `[2]` matches nothing.
    // Indexing the whole set is nesting-independent.
    const itemRow = `//div[contains(@class,"flex gap-2 items-start")][.//input[@type="number"]]`;
    const rowNumbers = `${itemRow}//input[@type="number"]`;
    await setInputValue(
      `(${rowNumbers})[1]`,
      String(RECEIVED_QUANTITY),
      "order quantity",
    );
    await setInputValue(
      `(${rowNumbers})[2]`,
      String(RECEIVED_UNIT_COST),
      "order unit cost",
    );

    await waitEnabled("button*=Crear orden", 20, 1_000, "Crear orden");
    await clickWhenPresent("button*=Crear orden", "Crear orden");

    // Assert on the ORDER, not on the view transition.
    //
    // The create writes the row and the page switches to the detail view, but
    // the switch is not what this spec is about — and polling the local mirror
    // says so unambiguously. Waiting for the detail heading instead reported a
    // 4-minute timeout on a run where the order had plainly been created.
    const created = await browser.waitUntil(
      async () => {
        const orders = await fetchLocalPurchaseOrders();
        return orders.length > orderBefore ? orders[0] : false;
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          "the purchase order never appeared in the local mirror after " +
          `creating it. Screen: ${await describeScreen()}`,
      },
    );
    const localOrderId = (created as { id: string }).id;

    // ---- Locally the order exists, in DRAFT (or already CONFIRMED when the
    // tenant's `autoConfirmOnCreate` is on).
    const localOrders = await fetchLocalPurchaseOrders();
    expect(localOrders.length).toBe(orderBefore + 1);
    const localOrder = localOrders.find((o) => o.id === localOrderId);
    expect(localOrder).toBeDefined();

    if (localOrder?.state === "DRAFT") {
      // Confirming is what queues PURCHASE_ORDER_CONFIRMATION. The detail view
      // is reached explicitly from the list rather than assumed, because the
      // create does not reliably transition the page.
      await openScreen("Compras");
      await expectPageHeading("Compras");
      await openHubCard("Órdenes de compra");
      await expectPageHeading("Órdenes de compra");
      // The row itself is a full-width `<tr role="button">`, so its centre point
      // can land under the sticky table header, and a click the sticky header
      // absorbs reports success while doing nothing. The row's own nested
      // "Ver orden #N" button is a small target, and the sequential number makes
      // that label unique per row.
      await clickButtonByExactText(`Ver orden #${localOrder.sequentialNumber}`);
      await waitVisible(
        ORDER_DETAIL_HEADING,
        30,
        1_000,
        "purchase order detail",
      );

      await waitEnabled(
        "button*=Confirmar orden",
        20,
        1_000,
        "Confirmar orden",
      );
      await clickWhenPresent("button*=Confirmar orden", "Confirmar orden");
    }

    // Assert on the order's state rather than on the badge: the list and the
    // detail render different markup for it, and the mirror is the contract
    // the rest of this file checks.
    await browser.waitUntil(
      async () => {
        const orders = await fetchLocalPurchaseOrders();
        return orders.find((o) => o.id === localOrderId)?.state === "CONFIRMED";
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          `purchase order ${localOrderId} never reached CONFIRMED locally. ` +
          `Screen: ${await describeScreen()}`,
      },
    );

    // ---- Server side: the replay produced the row AND its items.
    const replay = await waitForTerminalSyncOperation(
      "PURCHASE_ORDER_CONFIRMATION",
    );
    expect(replay.status).toBe("COMPLETED");

    const serverOrder = await waitForServerPurchaseOrder(
      SEEDED_SUPPLIER.identificationNumber,
    );
    expect(serverOrder.id).toBe(localOrderId);
    expect(serverOrder.state).toBe("CONFIRMED");
    expect(serverOrder.items).toHaveLength(1);
    expect(serverOrder.items[0].productId).toBe(PRODUCT_IBUPROFENO);
    expect(serverOrder.items[0].requestedQuantity).toBe(RECEIVED_QUANTITY);
    expect(serverOrder.items[0].receivedQuantity).toBe(0);
    expect(serverOrder.items[0].pendingQuantity).toBe(RECEIVED_QUANTITY);
    expectPesos(
      serverOrder.items[0].expectedUnitCost,
      RECEIVED_UNIT_COST,
      "server order unit cost",
    );
  });

  it("E2E-P03: receiving against the order creates a server lot with the typed batch and expiry", async () => {
    await signInAs(ADMIN);

    const seededSupplierId = (await fetchServerSuppliers()).find(
      (s) => s.identificationNumber === SEEDED_SUPPLIER.identificationNumber,
    )?.id;
    expect(seededSupplierId).toBeDefined();

    const lotsBefore = await fetchLocalLots(PRODUCT_IBUPROFENO);
    expect(lotsBefore.map((l) => l.batchNumber)).toContain("LOT-002");

    await openScreen("Compras");
    await expectPageHeading("Compras");
    await openHubCard("Órdenes de compra");
    await expectPageHeading("Órdenes de compra");

    // Reopen the order this file just confirmed. It is the newest sequential
    // number, which is also how the list is ordered.
    const target = (await fetchLocalPurchaseOrders()).find(
      (o) => o.state === "CONFIRMED" && o.supplierId === seededSupplierId,
    );
    expect(target).toBeDefined();
    const orderNumber = target!.sequentialNumber;

    await clickButtonByExactText(`Ver orden #${orderNumber}`);
    await waitVisible(ORDER_DETAIL_HEADING, 20, 1_000, "purchase order detail");

    // Receiving is what the whole step is about, so the order must first be
    // CONFIRMED — a draft order carries no "Recibir" affordance.
    await waitVisible(
      '//span[contains(@class,"pos-badge") and normalize-space(.)="Confirmada"]',
      20,
      500,
      "confirmed badge",
    );
    await clickButtonByExactText("Recibir");
    await expectPageHeading("Recibir");

    // The receive screen pre-fills one row per order line with the PENDING
    // quantity, and leaves lot and expiry blank on purpose.
    const row = `//div[contains(@class,"pos-panel")][.//span[contains(text(),"${IBUPROFENO}")]]`;
    // Indexing the row's OWN node-set rather than using a per-parent `[n]`
    // predicate: the two number inputs sit in separate wrappers, so each is the
    // first number input of its own parent and `[2]` would match nothing.
    const rowNumbers = `${row}//input[@type="number"]`;
    await waitVisible(`(${rowNumbers})[1]`, 20, 1_000, "received qty");

    // None of the four inputs carries an id or aria-label, so they are addressed
    // by type: quantity and cost are the two numbers, the lot number is the only
    // text input, and the expiry is the only date input. The lot input here has
    // NO placeholder — the hardcoded "L24056" placeholder belongs to the
    // standalone reception form only.
    await setInputValue(
      `(${rowNumbers})[1]`,
      String(RECEIVED_QUANTITY),
      "received quantity",
    );
    await setInputValue(
      `${row}//input[@type="text"]`,
      RECEIVED_BATCH,
      "lot number",
    );
    await setDateInputValue(
      `${row}//input[@type="date"]`,
      RECEIVED_EXPIRATION,
      "expiration date",
    );
    await setInputValue(
      `(${rowNumbers})[2]`,
      String(RECEIVED_UNIT_COST),
      "received unit cost",
    );

    // "Confirmar recepción" appears twice (page header and footer) and both are
    // wired to the same handler, so either is fine.
    await clickButtonByExactText("Confirmar recepción", {
      allowMultiple: true,
    });

    // It lands back on the order detail, now fully received.
    await waitVisible(
      ORDER_DETAIL_PAGE_HEADING,
      60,
      1_000,
      "back on the order detail",
    );
    await waitVisible(
      '//span[contains(@class,"pos-badge") and normalize-space(.)="Recibida totalmente"]',
      60,
      1_000,
      "fully received badge",
    );

    // ---- Locally: a new lot with the typed batch, expiry and stock.
    const localLots = await fetchLocalLots(PRODUCT_IBUPROFENO);
    const localLot = localLots.find((l) => l.batchNumber === RECEIVED_BATCH);
    expect(localLot).toBeDefined();
    expect(localLot?.currentStock).toBe(RECEIVED_QUANTITY);
    expect(localLot?.state).toBe("ACTIVE");

    // A received lot must carry the typed expiry. Reported with every row for
    // this product, because a null here is either a lot created without one or a
    // second row for the same batch written by the pull, and the two need
    // opposite fixes.
    if (localLot?.expirationDate === null) {
      throw new Error(
        `lot "${RECEIVED_BATCH}" has no expirationDate; local lots for the ` +
          `product: ${JSON.stringify(localLots, null, 2)}`,
      );
    }
    expect(localLot?.expirationDate?.slice(0, 10)).toBe(RECEIVED_EXPIRATION);

    const localReceptions = await fetchLocalPurchaseReceptions();
    expect(localReceptions.length).toBeGreaterThan(0);
    expect(localReceptions[0].state).toBe("CONFIRMED");
    expect(localReceptions[0].itemCount).toBe(1);

    // ---- Server side: the replay produced the reception, the lot and the
    // stock. A reception row without its lot would be goods the pharmacy
    // cannot sell.
    const replay = await waitForTerminalSyncOperation(
      "PURCHASE_RECEPTION_CONFIRMATION",
    );
    expect(replay.status).toBe("COMPLETED");

    const reception = await waitForServerReceptionWithLot(RECEIVED_BATCH);
    expect(reception.state).toBe("CONFIRMED");
    expect(reception.purchaseOrderId).toBe(target!.id);
    expect(reception.items).toHaveLength(1);
    expect(reception.items[0].batchNumber).toBe(RECEIVED_BATCH);
    expect(reception.items[0].receivedQuantity).toBe(RECEIVED_QUANTITY);
    expectPesos(
      reception.items[0].realUnitCost,
      RECEIVED_UNIT_COST,
      "server reception unit cost",
    );
    // The expiry the cashier typed is the expiry the lot carries, to the day:
    // a lot that expires on the wrong date is a regulatory problem, not a
    // cosmetic one. The received value is reported because a one-day drift here
    // means the server is storing the calendar date in a timezone rather than as
    // the typed day.
    const serverExpiry = reception.items[0].expirationDate;
    if (serverExpiry?.slice(0, 10) !== RECEIVED_EXPIRATION) {
      throw new Error(
        `server reception expiry for batch ${RECEIVED_BATCH} is ` +
          `"${serverExpiry}", expected "${RECEIVED_EXPIRATION}"`,
      );
    }

    const serverLot = await fetchServerLotByBatch(RECEIVED_BATCH);
    expect(serverLot).not.toBeNull();
    expect(serverLot?.currentStock).toBe(RECEIVED_QUANTITY);
    expect(serverLot?.state).toBe("ACTIVE");
    expect(serverLot?.expirationDate.slice(0, 10)).toBe(RECEIVED_EXPIRATION);
    expect(serverLot?.productId).toBe(PRODUCT_IBUPROFENO);

    // And the order's server row moved with it.
    const orders = await fetchServerPurchaseOrders(
      SEEDED_SUPPLIER.identificationNumber,
    );
    const received = orders.find((o) => o.id === target!.id);
    expect(received?.state).toBe("FULLY_RECEIVED");
    expect(received?.items[0].receivedQuantity).toBe(RECEIVED_QUANTITY);
    expect(received?.items[0].pendingQuantity).toBe(0);
  });

  it("E2E-P04: the confirmed reception becomes the product's active cost", async () => {
    // The reception's weighted average is written as a ProductCostHistory row and
    // `Product.currentCostId` is repointed at it. The POS computes it locally,
    // and this is the only reason a sale of a freshly pulled product can carry a
    // cost snapshot at all: the catalog sync never pulls cost histories.
    await signInAs(ADMIN);

    const cost = await fetchLocalProductCost(PRODUCT_IBUPROFENO);
    expect(cost).not.toBeNull();
    expectPesos(cost?.cost ?? 0, RECEIVED_UNIT_COST, "active product cost");
    expect(cost?.changeReason).toBe(
      "CPP updated after purchase reception confirmation",
    );
  });

  it("E2E-P05: the received cost floors the price override, and a refused price never reaches the server", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("ibuprofeno", IBUPROFENO);
    await setCartLinePrice(IBUPROFENO, "100");

    // The floor error is rendered inside the price cell and the editor stays
    // open, because `commitPrice` returns early on a validation failure instead
    // of closing. That is what makes the refusal observable as a state.
    const error = await readCartPriceError(IBUPROFENO);
    expect(error).toContain("por debajo del costo mínimo");
    expect(await isCartPriceEditing(IBUPROFENO)).toBe(true);

    // The floor quoted is the reception's cost, not a hardcoded figure.
    //
    // The message renders as "… ($ 100) está por debajo del costo mínimo
    // ($ 4.000)", so the amount is a parenthesised group with a space after the
    // currency symbol. A tighter `/\(([\d.,]+)\)/` matches neither group and
    // silently yields 0, which reads exactly like a broken cost floor — the
    // whitespace is therefore allowed explicitly.
    const groups = error.match(/\(\s*\$?\s*([\d.,]+)\s*\)/g) ?? [];
    const floor = Number((groups.at(-1) ?? "").replace(/[^\d]/g, ""));
    if (Math.abs(floor - RECEIVED_UNIT_COST) > 0.005) {
      throw new Error(
        `floor quoted by the cart is ${floor}, expected ${RECEIVED_UNIT_COST}. ` +
          `Raw error: ${JSON.stringify(error)}`,
      );
    }

    // The catalog price is untouched, and nothing was booked.
    if ((await fetchLatestLocalNumber()) > baseline) {
      throw new Error(
        `a sale newer than #${baseline} reached the server although the price ` +
          `was refused. Sync queue: ${await describeSyncQueue()}`,
      );
    }
    expect((await fetchLotStocks())[LOT_IBUPROFENO]).toBe(
      stockBefore[LOT_IBUPROFENO],
    );
  });

  it("E2E-P06: selling the received lot stamps the new cost and drains the received lot", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();
    const seededLotBefore = (await fetchLotStocks())[LOT_IBUPROFENO];

    const lotBefore = await fetchServerLotByBatch(RECEIVED_BATCH);
    expect(lotBefore?.currentStock).toBe(RECEIVED_QUANTITY);

    // P05 deliberately leaves the cart's price editor open on the refusal, so the
    // app is still on Compras here. Navigate explicitly rather than relying on
    // the previous spec's leftovers.
    await openScreen("Ventas");

    await addProductToCart("ibuprofeno", IBUPROFENO);
    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    // FEFO: the received lot expires before LOT-002's 2030 date, so it is the one
    // the sale must consume. A sale hitting the seeded lot instead would mean
    // stock rotation silently is not happening.
    expect(sale.items[0].lots).toHaveLength(1);
    expect(sale.items[0].lots[0].lotId).toBe(lotBefore?.id);

    const lotAfter = await fetchServerLotByBatch(RECEIVED_BATCH);
    expect(lotAfter?.currentStock).toBe(RECEIVED_QUANTITY - 1);

    // And the seeded lot is untouched, which is what proves the deduction came
    // from the received one rather than from stock that was already there.
    expect((await fetchLotStocks())[LOT_IBUPROFENO]).toBe(seededLotBefore);

    // The cost the reception wrote is what the sale is valued at.
    expectPesos(
      sale.items[0].unitPrice,
      400,
      "server unit price of the received product",
    );
    expect(sale.queue?.status).toBe("COMPLETED");
  });
});
