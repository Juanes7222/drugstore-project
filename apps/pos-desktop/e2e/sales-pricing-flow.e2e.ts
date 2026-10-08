/**
 * E2E: Sales pricing — discounts, price overrides and quantities.
 *
 * Companion to `sales-flow.e2e.ts`, which covers the plain checkout. This file
 * covers the three ways a cashier can change what a sale costs, and asserts
 * each one TWICE: on the cart totals the cashier reads before charging, and on
 * the `SaleItem` row the server replayed afterwards.
 *
 * The server half is the point. A discount applied on screen and never
 * persisted is a pharmacy giving the money away, and a price override that
 * never reaches `SaleItem.unitPrice` means the fiscal document, the margin
 * report and the stock valuation all disagree with the till. None of that is
 * visible from the receipt.
 *
 * Arithmetic is chosen so every expected amount lands on a whole peso. The
 * money formatters use `maximumFractionDigits: 0`, so a total ending in cents
 * is rounded on screen and can no longer be compared against the server's exact
 * decimal — a mismatch that would be a fixture artefact, not a defect. With the
 * 19% IVA the fixture seeds, the discounted base must be a multiple of 100
 * pesos:
 *
 *   Ibuprofeno 400.00 − 25% = 300.00, +19% IVA = 357.00
 *   Acetaminofén 500.00 overridden to 9000.00, +19% IVA = 10710.00
 */

import { $, browser, expect } from "@wdio/globals";
import {
  signInAs,
  addProductToCart,
  goToPayment,
  payWithCash,
  waitForReceiptAndNewSale,
  readPaymentTotalDue,
  readCartTotal,
  readCartTotalRow,
  readCartLineDiscount,
  readCartPriceError,
  isCartPriceEditing,
  applyCartLineDiscount,
  setCartLinePrice,
  incrementCartLineQuantity,
  waitEnabled,
  expectPesos,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  fetchLotStocks,
  waitForNewServerSale,
  describeSyncQueue,
  LOT_ACETAMINOFEN,
  LOT_IBUPROFENO,
} from "./server-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/**
 * OWNER, because an ADMIN cannot complete a price override.
 *
 * `resolvePriceOverrideRoleKey` has no ADMIN branch and returns null, and
 * `validateItemPricing` turns that into PriceOverrideNotAllowedForRoleException
 * — while `CartLineItem.canOverridePrice` still hands ADMIN the editable price
 * control. So the cart accepts the edit and checkout refuses it. OWNER is the
 * role the validator actually exempts.
 */
const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const ACETAMINOFEN = "Acetaminofén 500mg";
const IBUPROFENO = "Ibuprofeno 400mg";

/** Catalog prices as seeded by the server fixture, before IVA. */
const ACETAMINOFEN_BASE = 500;
const IBUPROFENO_BASE = 400;

/** 19% IVA on the seeded catalog prices. */
const IBUPROFENO_TOTAL = 476;

describe("Sales pricing (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-S07: a 25% line discount lowers the charged total and is persisted per item", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("ibuprofeno", IBUPROFENO);
    expectPesos(
      await readCartTotalRow("Subtotal"),
      IBUPROFENO_BASE,
      "cart subtotal before the discount",
    );

    await applyCartLineDiscount(IBUPROFENO, 25);
    expect(await readCartLineDiscount(IBUPROFENO)).toBe("25%");

    // The cart's own arithmetic: 400 − 25% = 300, and IVA is charged on the
    // DISCOUNTED base (sales-slice.computeCartItemMoney multiplies
    // lineTotalCents, not the gross subtotal, by the rate). An engine that
    // charged IVA on the pre-discount price would show 476 here, not 357.
    expectPesos(await readCartTotalRow("Subtotal"), 300, "discounted subtotal");
    expectPesos(
      await readCartTotalRow("IVA (19%)"),
      57,
      "IVA on the discounted base",
    );
    expectPesos(await readCartTotal(), 357, "discounted cart total");

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, 357, "payment screen total");

    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    // ---- Server side: the discount is a stored figure, not a screen artifact.
    const sale = await waitForNewServerSale(baseline);

    expect(sale.items).toHaveLength(1);
    const item = sale.items[0];
    expect(item.commercialName).toBe(IBUPROFENO);
    expectPesos(
      item.unitPrice,
      IBUPROFENO_BASE,
      "server unit price is the undiscounted one",
    );
    expectPesos(item.discountPercentage, 25, "server discount percentage");
    expectPesos(item.discountAmount, 100, "server discount amount");
    // The server rejects a discount with no reason
    // (DiscountReasonRequiredException), so a non-empty reason here proves the
    // POS sent a complete line rather than just a number.
    expect(item.discountReason ?? "").not.toBe("");

    // Sale-level rollup: the header subtotal stays GROSS and the discount rides
    // separately (SalesService.calculateSaleTotals sums each item's `subtotal`
    // into the header and its `discountAmount` into totalDiscount), so a header
    // that silently absorbed the discount would break the DIAN document.
    expectPesos(sale.subtotal, IBUPROFENO_BASE, "server gross subtotal");
    expectPesos(sale.totalDiscount, 100, "server total discount");
    expectPesos(sale.totalTax, 57, "server total tax");
    expectPesos(sale.totalAmount, 357, "server sale total");
    expectPesos(totalDue, sale.totalAmount, "screen and server agree");
    expect(sale.queue?.status).toBe("COMPLETED");
  });

  it("E2E-S08: a discount on one line leaves the other line's price untouched", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("ibuprofeno", IBUPROFENO);
    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await applyCartLineDiscount(IBUPROFENO, 25);

    // Only the discounted line moves: 300 + 500 = 800.
    expectPesos(await readCartTotalRow("Subtotal"), 800, "mixed cart subtotal");
    expectPesos(await readCartTotalRow("IVA (19%)"), 152, "mixed cart IVA");
    expectPesos(await readCartTotal(), 952, "mixed cart total");

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, 952, "payment screen total");
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);
    expect(sale.items).toHaveLength(2);

    const discounted = sale.items.find((i) => i.commercialName === IBUPROFENO);
    const full = sale.items.find((i) => i.commercialName === ACETAMINOFEN);

    expect(discounted).toBeDefined();
    expect(full).toBeDefined();

    // The regression this guards: a per-item discount leaking onto the sibling
    // line. Both lines share a tax scheme, so a bug that applied the discount to
    // the whole basket instead of the line is invisible in any single total.
    expectPesos(
      discounted?.discountAmount ?? 0,
      100,
      "server discount on the discounted line",
    );
    expectPesos(
      full?.discountAmount ?? -1,
      0,
      "server discount on the undiscounted line",
    );
    expectPesos(
      full?.unitPrice ?? 0,
      ACETAMINOFEN_BASE,
      "undiscounted line keeps its price",
    );
    expectPesos(
      sale.totalDiscount,
      100,
      "server total discount covers one line only",
    );
    expectPesos(sale.totalAmount, 952, "server sale total");
  });

  it("E2E-S09: an accepted price override is snapshotted on the sale item", async () => {
    await signInAs(OWNER);
    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await setCartLinePrice(ACETAMINOFEN, "9000");

    expect(await isCartPriceEditing(ACETAMINOFEN)).toBe(false);
    expect(await readCartPriceError(ACETAMINOFEN)).toBe("");

    expectPesos(
      await readCartTotalRow("Subtotal"),
      9000,
      "subtotal after the override",
    );
    expectPesos(await readCartTotal(), 10710, "total after the override");

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, 10710, "payment screen total");
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    // The override is the figure the customer was charged and the figure the
    // fiscal document is issued against. The server deliberately prefers the
    // POS snapshot over its own catalog price (SalesService.buildSaleItem), so
    // a dropped override surfaces exactly here.
    expect(sale.items).toHaveLength(1);
    expectPesos(
      sale.items[0].unitPrice,
      9000,
      "server unit price is the override, not the 500 catalog price",
    );
    expectPesos(sale.subtotal, 9000, "server gross subtotal");
    expectPesos(sale.totalTax, 1710, "server tax on the override");
    expectPesos(sale.totalAmount, 10710, "server sale total");

    // An override is not a discount: it must leave the discount columns empty,
    // or the receipt would report money off that was never taken off.
    expectPesos(
      sale.totalDiscount,
      0,
      "server total discount after an override",
    );
    expectPesos(sale.items[0].discountAmount, 0, "server item discount");
    expect(sale.items[0].discountPercentage).toBe(0);
  });

  it("E2E-S10: a quantity of three consumes three units of the lot", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("ibuprofeno", IBUPROFENO);
    await incrementCartLineQuantity(IBUPROFENO, 2);

    expectPesos(
      await readCartTotalRow("Subtotal"),
      IBUPROFENO_BASE * 3,
      "subtotal for three units",
    );
    expectPesos(
      await readCartTotal(),
      IBUPROFENO_TOTAL * 3,
      "total for three units",
    );

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, IBUPROFENO_TOTAL * 3, "payment screen total");
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    const sale = await waitForNewServerSale(baseline);

    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(3);
    // Three units must leave the lot with three units, not one: the movement is
    // written per `quantity`, so a mismatch here is inventory sold without being
    // deducted.
    expect(sale.lotStocks[LOT_IBUPROFENO]).toBe(
      stockBefore[LOT_IBUPROFENO] - 3,
    );
    expectPesos(sale.totalAmount, IBUPROFENO_TOTAL * 3, "server sale total");
  });

  it("E2E-S11: an ADMIN's price override is refused at checkout, so nothing is booked", async () => {
    // The UI/domain disagreement this pins down: `CartLineItem.canOverridePrice`
    // admits ADMIN, so the cart lets it edit the price, while
    // `validateItemPricing` rejects the same override because
    // `resolvePriceOverrideRoleKey(ADMIN)` is null.
    //
    // Asserting the refusal (rather than the override succeeding) is deliberate:
    // it is what the code does today, and it is the boundary a future fix that
    // unifies the two has to move. When ADMIN is meant to be able to override,
    // this spec fails and says so.
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await setCartLinePrice(ACETAMINOFEN, "9000");
    expect(await isCartPriceEditing(ACETAMINOFEN)).toBe(false);

    // Charge directly rather than through `goToPayment`: a refused checkout
    // never mounts the payment screen, so waiting for it would time out on the
    // very symptom the spec is about.
    await waitEnabled("button*=COBRAR", 20, 1_000, "COBRAR button");
    await (await $("button*=COBRAR")).click();

    await browser.waitUntil(
      async () =>
        (await readCartAlert()).includes(
          "No tienes permiso para modificar el precio",
        ),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg:
          "checkout accepted an ADMIN price override; validateItemPricing is " +
          "supposed to refuse it because resolvePriceOverrideRoleKey has no " +
          "ADMIN branch",
      },
    );

    // Still on the cart, with the cart intact — a refusal must not half-charge.
    expect(await readCartLineDiscount(ACETAMINOFEN)).toBe("—");

    // Nothing may exist server-side: no sale, no stock movement, no document.
    if ((await fetchLatestLocalNumber()) > baseline) {
      throw new Error(
        `a sale newer than #${baseline} reached the server although checkout ` +
          `refused the override. Sync queue: ${await describeSyncQueue()}`,
      );
    }
    expect((await fetchLotStocks())[LOT_ACETAMINOFEN]).toBe(
      stockBefore[LOT_ACETAMINOFEN],
    );
  });
});

/**
 * Text of the cart's own error banner.
 *
 * The checkout-level rule errors render there (`cart-panel.tsx`), which is
 * where a refused override surfaces — the app stays on the cart rather than
 * mounting the payment screen.
 */
async function readCartAlert(): Promise<string> {
  return browser.execute(() => {
    const alert = document.querySelector(
      'section[data-nav-zone="cart"] [role="alert"]',
    );
    return alert?.textContent ?? "";
  });
}
