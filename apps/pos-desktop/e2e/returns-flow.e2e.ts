/**
 * E2E: Returns flow (WebdriverIO + Tauri) — verified and unverified
 * client-return scenarios with DB-driven refund payment methods.
 *
 * The verified flow searches the local PGlite DB for a CONFIRMED sale, so
 * this spec first completes a sale (same steps as sales-flow) and then
 * searches for it by its local sequential number. The unverified flow
 * performs manual entry and requires a manager PIN (ADMIN role), which the
 * mock backend grants for the "admin" username.
 */

import { browser, expect } from "@wdio/globals";
import {
  login,
  addProductToCart,
  goToPayment,
  payWithCash,
  openReturns,
  expectReturnToast,
  waitVisible,
  waitEnabled,
} from "./helpers";

// `describe` / `it` are Mocha globals injected by the WDIO runner.
/* global describe, it */

// Tab labels come from es.json ("returns.verified_tab" / "returns.unverified_tab").
const VERIFIED_TAB_SELECTOR = '//*[@role="tab" and contains(., "Devolución verificada")]';
const UNVERIFIED_TAB_SELECTOR = '//*[@role="tab" and contains(., "Devolución no verificada")]';

/**
 * After a completed sale, search for it in the verified tab. The local
 * sequential number starts at 1 on a fresh DB, so probe 1..6 to stay
 * resilient when the app data persists between runs.
 *
 * The verified tab is re-activated before every probe: a "not found" search
 * switches the page to the unverified tab (returns.page.tsx handleSearch),
 * which unmounts the verified panel and its search input. Clicking the
 * already-active tab is a no-op, so the same click also covers the R01 mount
 * race, where the JS visibility check and the driver's findElement observed
 * different moments of the panel mounting.
 */
async function findLatestSale(): Promise<void> {
  await waitVisible(VERIFIED_TAB_SELECTOR, 15, 1_000, "Verified tab");

  for (let n = 1; n <= 6; n += 1) {
    await (await $(VERIFIED_TAB_SELECTOR)).click();

    // Resolve the input fresh per probe and wait at driver level: the input
    // lives in the verified panel, which mounts/unmounts on tab switches.
    // waitForExist retries via the driver (not the JS-based visibility
    // check), so the existence check and the interaction cannot race.
    const searchInput = await $("#sale-search-input");
    await searchInput.waitForExist({ timeout: 15_000 });
    await searchInput.setValue(String(n));
    await (await $('button*=Buscar venta')).click();

    // The found-sale panel lists the sold product. Poll briefly for it
    // before treating the probe as a miss (the panel renders after the
    // PGlite lookup resolves).
    const salePanelSelector = "//*[contains(@class, 'pos-panel')]//tbody";
    const isFound = await waitVisible(
      '//*[contains(text(), "Acetaminofén 500mg")]',
      5,
      500,
      "Found-sale product row",
    )
      .then(() => true)
      .catch(() => false);
    if (isFound) {
      await waitVisible(salePanelSelector, 8, 500, "Found-sale panel");
      return;
    }

    // Otherwise wait for the "not found" error before probing the next number.
    await waitVisible('//*[contains(text(), "Venta no encontrada")]', 15, 1_000, "Sale not found")
      .catch(() => undefined);
  }

  throw new Error("No local sale found to return after probing numbers 1..6");
}

describe("Returns flow (Tauri e2e)", () => {
  it("E2E-R01: Verified return — sell, search sale, select item, refund", async () => {
    // ---- Create a CONFIRMED local sale first ----
    await login("carlos.lopez", "123456");
    await addProductToCart("acetaminofén", "Acetaminofén 500mg");
    await goToPayment();
    await payWithCash("500");

    // Wait for receipt and go back to a new sale (sales screen).
    await waitVisible('//*[contains(text(), "Pago confirmado")]', 15, 1_000, "Receipt title");
    await waitVisible('button*=Nueva venta', 15, 1_000, "New sale button");
    await (await $('button*=Nueva venta')).click();

    // ---- Navigate to returns ----
    await openReturns();
    await waitVisible(VERIFIED_TAB_SELECTOR, 15, 1_000, "Verified tab");

    // ---- Search the sale by local number ----
    await findLatestSale();

    // ---- Select the first item to return ----
    await waitVisible('input[type="checkbox"]', 15, 1_000, "Item checkbox");
    const checkbox = await $('input[type="checkbox"]');
    await checkbox.click();

    // ---- Refund method: DB-driven picker defaults to cash (Efectivo) ----
    await waitVisible("#return-refund-method", 15, 1_000, "Refund method picker");
    const refundPicker = await $("#return-refund-method");
    const selectedValue = await refundPicker.getValue();
    expect(selectedValue).not.toBe("");

    // ---- Process the verified return ----
    await waitEnabled('button[aria-label="Procesar devolución"]', 15, 1_000, "Process return button");
    await (await $('button[aria-label="Procesar devolución"]')).click();

    await expectReturnToast();
  });

  it("E2E-R02: Unverified return — manual entry with manager PIN", async () => {
    // Admin role is required for unverified returns (mock grants ADMIN).
    await login("admin", "123456");

    await openReturns();

    // Switch to the unverified tab.
    await waitVisible(UNVERIFIED_TAB_SELECTOR, 15, 1_000, "Unverified tab");
    const unverifiedTab = await $(UNVERIFIED_TAB_SELECTOR);
    await unverifiedTab.click();

    // ---- Manual item entry ----
    await (await $("#unverified-product")).setValue("Acetaminofén 500mg");
    await (await $("#unverified-lot")).setValue("LOT-001");
    await (await $("#unverified-qty")).setValue("1");
    await (await $('button*=Agregar')).click();

    // The added item appears in the "Items a devolver" list.
    await waitVisible('//*[contains(text(), "Lote")]', 15, 1_000, "Added return item");

    // ---- Manager PIN ----
    await (await $("#manager-pin-input")).setValue("999999");

    // ---- Submit ----
    await waitEnabled('button*=Enviar devolución no verificada', 15, 1_000, "Submit return button");
    await (await $('button*=Enviar devolución no verificada')).click();

    await expectReturnToast();
  });
});

// Keep the browser reference alive for the Tauri service teardown.
void browser;
