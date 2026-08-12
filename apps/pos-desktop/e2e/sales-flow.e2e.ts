/**
 * E2E: Sales flow (WebdriverIO + Tauri) — login, product search, cart,
 * payment with DB-driven payment methods, receipt.
 *
 * These tests drive the real Tauri binary (`pos-desktop.exe`) via
 * tauri-driver / WebView2. The backend is a deterministic HTTP mock
 * (`e2e/mock-server.mjs`) that seeds the local PGlite DB with payment
 * methods (Efectivo, Tarjeta Débito, Transferencia, Nequi), products and
 * lots through the app's own sync pipeline — so the payment picker is fed
 * by the local DB, exactly as in production.
 */

import { browser, expect } from "@wdio/globals";
import {
  login,
  addProductToCart,
  goToPayment,
  payWithCash,
  setCashReceived,
  waitForReceiptAndNewSale,
  waitVisible,
  waitEnabled,
  isVisible,
} from "./helpers";

// `describe` / `it` are Mocha globals injected by the WDIO runner.
/* global describe, it */

describe("Sales flow (Tauri e2e)", () => {
  it("E2E-S01: Login → search → add to cart → pay with cash → receipt", async () => {
    await login("carlos.lopez", "123456");

    await addProductToCart("acetaminofén", "Acetaminofén 500mg");
    await goToPayment();

    // The first payment row resolves to the DB cash method (Efectivo).
    // Pay the exact total: Acetaminofén costs $500 (50000 cents).
    await payWithCash("500");

    await waitForReceiptAndNewSale();
  });

  it("E2E-S02: Sale with multiple items", async () => {
    await login("carlos.lopez", "123456");

    await addProductToCart("acetaminofén", "Acetaminofén 500mg");
    await addProductToCart("ibuprofeno", "Ibuprofeno 400mg");

    // Cart shows both items (the cart panel is a table with product rows).
    const cartPanelSelector = '//section[.//tr[.//p[contains(text(), "Acetaminofén 500mg")]]]';
    await waitVisible(cartPanelSelector, 15, 1_000, "Cart panel");
    const cartPanel = await $(cartPanelSelector);

    const text = await cartPanel.getText();
    if (!text.includes("Acetaminofén 500mg") || !text.includes("Ibuprofeno 400mg")) {
      throw new Error(
        `Cart should contain both products. Cart text: ${text.slice(0, 400)}`,
      );
    }

    await goToPayment();
    // Total = 500 + 350 = 850 pesos.
    const totalDue = await $('[data-testid="payment-total-due"]');
    const totalText = await totalDue.getText();
    if (!totalText.includes("850")) {
      throw new Error(`Expected total $850, got: ${totalText}`);
    }

    await payWithCash("850");
    await waitForReceiptAndNewSale();
  });

  it("E2E-S03: Sale with change returned (cash overpay)", async () => {
    await login("carlos.lopez", "123456");

    await addProductToCart("acetaminofén", "Acetaminofén 500mg");
    await goToPayment();

    // Overpay: total is $500, pay $600 → change $100. The change panel
    // updates live as the cashier types, BEFORE confirming the payment.
    await setCashReceived("600");

    // Assert the change value, then confirm.
    const changeSelector = '//*[contains(text(), "Cambio")]/following-sibling::*';
    await waitVisible(changeSelector, 15, 1_000, "Change value");
    const changeText = await $(changeSelector);
    const changeValue = await changeText.getText();
    if (!changeValue.includes("100")) {
      throw new Error(`Expected change $100, got: ${changeValue}`);
    }

    await waitEnabled('button*=Confirmar pago', 15, 1_000, "Confirm payment button");
    await (await $('button*=Confirmar pago')).click();

    await waitForReceiptAndNewSale();
  });

  it("E2E-S04: Sale with electronic payment (Tarjeta Débito from DB)", async () => {
    // Make the in-app payment gateway deterministic (always approve) so the
    // authorization status is not subject to the mock's random roll.
    await browser.execute(() => {
      (globalThis as Record<string, unknown>).__POS_E2E_APPROVE_ALL_PAYMENTS__ = true;
    });

    await login("carlos.lopez", "123456");

    await addProductToCart("acetaminofén", "Acetaminofén 500mg");
    await goToPayment();

    // Add a second payment row — the picker offers the first non-cash
    // method from the DB (Tarjeta Débito by sortOrder).
    await waitVisible('button*=Agregar método', 15, 1_000, "Add method button");
    const addMethod = await $('button*=Agregar método');
    await addMethod.click();

    // The new row's method picker should show "Tarjeta Débito".
    const debitSelector = '//select[option[contains(text(), "Tarjeta Débito")]]';
    await waitVisible(debitSelector, 15, 1_000, "Debit method picker");
    const debitRow = await $(debitSelector);

    // Two amount inputs exist (one per row). Row 1 = cash (Efectivo),
    // row 2 = Tarjeta Débito. Zero the cash amount and put the full total
    // (50000 cents = $500) on the card so the split is exact.
    const amountInputs = await $$('input[aria-label="Valor"]');
    expect(await amountInputs.length).toBeGreaterThanOrEqual(2);
    await amountInputs[0].setValue("0");
    await amountInputs[1].setValue("500");

    // Authorize via the mock gateway (approves by default).
    await waitVisible('button*=Verificar pago', 15, 1_000, "Authorize button");
    const authorizeButton = await $('button*=Verificar pago');
    await authorizeButton.click();

    // Wait for APPROVED status.
    await waitVisible('//*[contains(text(), "Aprobado")]', 15, 1_000, "Approved status");

    // Confirm the sale.
    await waitEnabled('button*=Confirmar pago', 15, 1_000, "Confirm payment button");
    await (await $('button*=Confirmar pago')).click();

    await waitForReceiptAndNewSale();
  });

  it("E2E-S05: Sale with client assignment", async () => {
    await login("carlos.lopez", "123456");

    await addProductToCart("acetaminofén", "Acetaminofén 500mg");

    // The client selector is present on the sales screen (cart panel).
    const clientSearchSelector = 'input[type="search"][placeholder*="cliente" i]';
    if (await isVisible(clientSearchSelector)) {
      const clientSearch = await $(clientSearchSelector);
      await clientSearch.setValue("1234567890");
      // The mock returns no clients — the selector should show a
      // "no results" state rather than crashing.
      await waitVisible(
        '//*[contains(text(), "Sin resultados") or contains(text(), "no encontrado")]',
        15,
        1_000,
        "Client no-results state",
      );
    }

    await goToPayment();
    await payWithCash("500");
    await waitForReceiptAndNewSale();
  });
});

// Keep the browser reference alive for the Tauri service teardown.
void browser;
