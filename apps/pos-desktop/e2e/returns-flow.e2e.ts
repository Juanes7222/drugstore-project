/**
 * E2E: Returns flow — real Tauri app against the real NestJS backend.
 *
 * The verified flow searches the POS-local index for a CONFIRMED sale that was
 * just created, so the spec performs a real sale first (the same steps as
 * sales-flow) and then looks the sale up. Unlike the previous version it no
 * longer probes local numbers 1..6 to survive leftovers from earlier runs:
 * every spec starts from a wiped local database and a wiped server, so the sale
 * it just made is sale number 1 and nothing else can be found by accident.
 *
 * The unverified flow performs manual entry and requires a manager PIN. That
 * spec logs in as a different user, which is only a real test because the local
 * session is reset between specs — otherwise it would keep running as the
 * previous cashier and never exercise the ADMIN-gated path.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  login,
  addProductToCart,
  goToPayment,
  payWithCash,
  openReturns,
  expectReturnToast,
  waitVisible,
  waitEnabled,
  readPaymentTotalDue,
  expectPesos,
  resetForSpec,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  fetchLotStocks,
  validatePendingInvoices,
  describeSyncQueue,
  waitForNewServerSale,
  waitForServerClientReturn,
  LOT_ACETAMINOFEN,
  FOREIGN_SALE_LOCAL_NUMBER,
  touchForeignSale,
} from "./server-state";
import { fetchLocalSales, fetchLocalSaleItems } from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const CASHIER = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
} as const;
const ADMIN = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
} as const;

const ACETAMINOFEN = "Acetaminofén 500mg";
/** 500.00 base plus 19% IVA, as seeded by the server fixture. */
const ACETAMINOFEN_TOTAL = 595;

// Tab labels come from es.json ("returns.verified_tab" / "returns.unverified_tab").
const VERIFIED_TAB_SELECTOR =
  '//*[@role="tab" and contains(., "Devolución verificada")]';
const UNVERIFIED_TAB_SELECTOR =
  '//*[@role="tab" and contains(., "Devolución no verificada")]';

/**
 * Find a sale in the verified tab by its local number.
 *
 * The number is passed in rather than assumed: the local database is not reset
 * between specs, so each spec's sale gets the next number and a hardcoded "1"
 * would eventually address an earlier sale.
 */
async function findSaleJustCreated(saleNumber: number): Promise<void> {
  await waitVisible(VERIFIED_TAB_SELECTOR, 15, 1_000, "Verified tab");

  // Both tabs render their own search panel and unmount the other, so make sure
  // the verified one is mounted before touching its input. Clicking the already
  // active tab is a no-op.
  await (await $(VERIFIED_TAB_SELECTOR)).click();

  // waitForExist retries at driver level, so existence and interaction cannot
  // race the panel mount.
  const searchInput = await $("#sale-search-input");
  await searchInput.waitForExist({ timeout: 15_000 });
  await searchInput.setValue(String(saleNumber));

  await waitVisible("button*=Buscar venta", 15, 1_000, "Search sale button");
  await (await $("button*=Buscar venta")).click();

  // The found-sale panel lists the sold product; it renders after the local
  // lookup resolves.
  await waitVisible(
    `//*[contains(text(), "${ACETAMINOFEN}")]`,
    15,
    500,
    "Found-sale product row",
  );
  await waitVisible(
    "//*[contains(@class, 'pos-panel')]//tbody",
    10,
    500,
    "Found-sale panel",
  );
}

describe("Returns flow (real Tauri app against the real backend)", () => {
  beforeEach(async () => {
    resetForSpec();
  });

  it("E2E-R01: verified return credits stock and issues a credit note server-side", async () => {
    const baseline = await fetchLatestLocalNumber();
    const stockBefore = await fetchLotStocks();

    // ---- Create a real sale and let it reach the server ----
    await login(CASHIER.identifier, CASHIER.password);
    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    await payWithCash(String(totalDue));

    await waitVisible(
      '//*[contains(text(), "Pago confirmado")]',
      15,
      1_000,
      "Receipt title",
    );
    await waitVisible("button*=Nueva venta", 15, 1_000, "New sale button");
    await (await $("button*=Nueva venta")).click();

    // Confirm the baseline the return is measured against.
    const sale = await waitForNewServerSale(baseline);
    // Relative to the level captured before this flow: the suite does not reset the
    // database between specs, and the sales specs run first in the same session,
    // so the seeded 100 is long gone by the time this spec sells anything.
    expect(sale.lotStocks[LOT_ACETAMINOFEN]).toBe(
      stockBefore[LOT_ACETAMINOFEN] - 1,
    );

    // ---- Navigate to returns and locate that sale ----
    await openReturns();
    await findSaleJustCreated(sale.localNumber);

    // ---- Select the first item to return ----
    await waitVisible('input[type="checkbox"]', 15, 1_000, "Item checkbox");
    await (await $('input[type="checkbox"]')).click();

    // ---- Refund method: DB-driven picker defaults to cash (Efectivo) ----
    await waitVisible(
      "#return-refund-method",
      15,
      1_000,
      "Refund method picker",
    );
    const selectedValue = await (await $("#return-refund-method")).getValue();
    expect(selectedValue).not.toBe("");

    await waitEnabled(
      'button[aria-label="Procesar devolución"]',
      15,
      1_000,
      "Process return button",
    );
    await (await $('button[aria-label="Procesar devolución"]')).click();

    await expectReturnToast();

    // ---- Server side: stock credited back and a credit note issued ----
    // The return converges through the same replay path as the sale. The credit
    // note additionally requires its invoice to be VALIDATED, so the harness
    // stands in for the DIAN provider on each poll — otherwise the replay fails
    // permanently on a rule that is correct in production but unreachable here.
    await browser.waitUntil(
      async () => {
        await validatePendingInvoices();
        const current = await waitForNewServerSale(baseline);
        return (
          current.lotStocks[LOT_ACETAMINOFEN] === stockBefore[LOT_ACETAMINOFEN]
        );
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          "verified return never restored the lot stock on the server. " +
          `Sync queue: ${await describeSyncQueue()}`,
      },
    );
  });

  it("E2E-R02: cross-workstation return with manager PIN is recorded server-side", async () => {
    const stockBefore = await fetchLotStocks();

    // The unverified (manager override) path exists for exactly one case: a sale
    // that belongs to another workstation. The fixture seeds one on the server
    // (localNumber 9001) and the POS only learns about it through the sales
    // pull, which is why this spec waits for the pull before searching.
    await login(ADMIN.identifier, ADMIN.password);

    await openReturns();

    await waitVisible(UNVERIFIED_TAB_SELECTOR, 15, 1_000, "Unverified tab");
    await (await $(UNVERIFIED_TAB_SELECTOR)).click();

    // The sale arrives asynchronously through the sales pull, so wait for the
    // LOCAL MIRROR to hold it before searching. Searching on a timer instead
    // would re-run the lookup every tick, and each lookup clears the found sale
    // and the item selection, so the panel would never settle long enough to be
    // clicked.
    await touchForeignSale();
    await browser.waitUntil(
      async () => {
        const items = await fetchLocalSaleItems(FOREIGN_SALE_LOCAL_NUMBER);
        return items.length > 0 && items.every((item) => item.lotCount > 0);
      },
      {
        timeout: 120_000,
        interval: 2_000,
        timeoutMsg:
          `the foreign workstation's sale ${FOREIGN_SALE_LOCAL_NUMBER} ` +
          "never reached the local mirror with its lot assignments. " +
          `Mirror: ${JSON.stringify(await fetchLocalSales())}. ` +
          `Items: ${JSON.stringify(await fetchLocalSaleItems(FOREIGN_SALE_LOCAL_NUMBER))}`,
      },
    );

    // One search, once the sale is really there.
    const searchInput = await $("#unverified-sale-search");
    await searchInput.waitForExist({ timeout: 15_000 });
    await searchInput.setValue(String(FOREIGN_SALE_LOCAL_NUMBER));
    await (await $("button*=Buscar venta")).click();

    // ---- Select the item, then confirm with a manager PIN ----
    await waitVisible('input[type="checkbox"]', 15, 1_000, "Item checkbox");
    await (await $('input[type="checkbox"]')).click();

    await (await $("#manager-pin-input")).setValue("999999");

    await waitEnabled(
      "button*=Enviar devolución no verificada",
      15,
      1_000,
      "Submit return button",
    );
    await (await $("button*=Enviar devolución no verificada")).click();

    await expectReturnToast();

    // ---- Server side: the refund is recorded, not just toasted ----
    // A manager-approved refund that never syncs is stock the pharmacy gave
    // away for free, so the CLIENT_RETURN replay is asserted explicitly.
    await browser.waitUntil(
      async () => {
        await validatePendingInvoices();
        const current = await fetchLotStocks();
        return current[LOT_ACETAMINOFEN] === stockBefore[LOT_ACETAMINOFEN] + 1;
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          "unverified return never restored the lot stock on the server. " +
          `Sync queue: ${await describeSyncQueue()}`,
      },
    );

    const clientReturn = await waitForServerClientReturn();

    expect(clientReturn.state).toBe("CONFIRMED");
    // One unit of the 500.00 product plus 19% IVA, the same figure the sale
    // charged, so a refund that silently drops the tax fails here.
    expectPesos(
      clientReturn.refundAmount,
      ACETAMINOFEN_TOTAL,
      "server refund amount",
    );
    expect(clientReturn.lotQuantities).toHaveLength(1);
    expect(clientReturn.lotQuantities[0].lotId).toBe(LOT_ACETAMINOFEN);
    expect(clientReturn.lotQuantities[0].quantity).toBe(1);

    // The refund must be backed by a credit note, which is the document the
    // taxpayer receives.
    expect(clientReturn.creditNoteFullNumber).toMatch(/^POSE2EC/);
  });
});

// Keep the browser reference alive for the Tauri service teardown.
void browser;
