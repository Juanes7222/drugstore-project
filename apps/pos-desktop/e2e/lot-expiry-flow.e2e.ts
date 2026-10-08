/**
 * E2E: Lot expiration — what the POS warns about, what it refuses to sell, and
 * how the config gates the whole lot screen.
 *
 * The fixture seeds two catalog entries whose lots are dated relative to the run
 * (see `NEAR_EXPIRY_DAYS` / `ALREADY_EXPIRED_DAYS` in the server baseline), so
 * the two cases under test are reproducible rather than fixtures that quietly
 * stop testing anything once their date passes.
 *
 * What the specs pin down is, in the end, mostly what the POS does NOT do — and
 * that is the useful part. Reading the code:
 *
 *   - `isNearExpiry` (renderer/services/catalog-service.ts) warns inside a
 *     30-day window and requires `diffDays >= 0`, so an ALREADY expired lot gets
 *     no badge at all.
 *   - Nothing transitions a lot's `state` when its date passes: no service, no
 *     job, no sale-time check. Lot selection filters on `state === ACTIVE`
 *     (`catalog-service.local.ts`) and stock consumption does the same
 *     (`InventoryLotsService.consumeStockForSale`), so an expired-but-ACTIVE lot
 *     is selected by FEFO and sold with no warning.
 *   - `strictness.expiryDates` exists in the shared type but is marked
 *     `@deprecated` and is not rendered by the Operación tab. The only real
 *     expiry switch is `purchases.requireExpiryOnReception`, which affects the
 *     reception form and gates the lot screen — not the sale.
 *
 * So E2E-X02 asserts the current behaviour (sellable, unbadged) rather than
 * pretending the app blocks it. When expiry enforcement is added, that spec is
 * the one that has to change, and its comment says so.
 */

import { browser, expect } from "@wdio/globals";
import {
  signInAs,
  addProductToCart,
  goToPayment,
  payWithCash,
  waitForReceiptAndNewSale,
  readPaymentTotalDue,
  waitVisible,
  waitGone,
  setSwitch,
  openConfigTab,
  openHubCard,
  openScreen,
  expectPageHeading,
  expectPesos,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  fetchServerLotByBatch,
  waitForNewServerSale,
  waitForTenantConfigValue,
  LOT_NITROFEN,
  LOT_OTRIVIN,
} from "./server-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/** Expires in 15 days: inside the sales-side 30-day warning window. */
const NEAR_EXPIRY = "Nitrofen 500mg";
/** Expired 10 days ago: past the window, and still `state: ACTIVE`. */
const ALREADY_EXPIRED = "Otrivin 100mcg";

/** 500.00 base plus 19% IVA, as seeded by the server fixture. */
const TOTAL = 595;

describe("Lot expiration (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-X01: a lot expiring within 30 days is badged in the cart and still sells", async () => {
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();

    // The fixture dated the lot 15 days out, so this is a real warning rather
    // than a hardcoded badge.
    const lot = await fetchServerLotByBatch("LOT-003");
    expect(lot?.id).toBe(LOT_NITROFEN);
    const daysOut = Math.round(
      (new Date(lot!.expirationDate).getTime() - Date.now()) / 86_400_000,
    );
    expect(daysOut).toBeGreaterThan(0);
    expect(daysOut).toBeLessThanOrEqual(30);

    await addProductToCart("nitrofen", NEAR_EXPIRY);

    const row = `//section[@data-nav-zone="cart"]//tr[.//p[contains(text(),"${NEAR_EXPIRY}")]]`;
    await waitVisible(
      `${row}//span[normalize-space(.)="VENCE PRONTO"]`,
      20,
      500,
      "near-expiry badge",
    );

    // The expiry the cashier is shown is the lot's own date.
    const lineText = await browser.execute(
      (selector: string) =>
        document.evaluate(
          selector,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue?.textContent ?? "",
      `${row}/td[1]`,
    );
    expect(lineText).toContain("LOT-003");

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, TOTAL, "payment screen total");
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    // The warning is advisory: the sale goes through and consumes the lot that
    // is about to expire, which is the behaviour FEFO is supposed to produce.
    const sale = await waitForNewServerSale(baseline);
    expect(sale.items[0].lots).toHaveLength(1);
    expect(sale.items[0].lots[0].lotId).toBe(LOT_NITROFEN);
    expect(sale.queue?.status).toBe("COMPLETED");

    const after = await fetchServerLotByBatch("LOT-003");
    expect(after?.currentStock).toBe((lot?.currentStock ?? 0) - 1);
  });

  it("E2E-X02: an already expired lot carries no badge and is still sellable", async () => {
    // Documents a gap rather than a guarantee. `isNearExpiry` requires
    // `diffDays >= 0`, so an expired lot renders like a normal one; and no sale-
    // time check consults the date at all. A pharmacy selling a lot 10 days
    // past its expiry date is a regulatory problem this suite can see but
    // cannot currently prevent.
    //
    // If expiry enforcement is added, this is the spec that changes: it should
    // start asserting that the cart refuses the product or that the badge says
    // it is expired.
    await signInAs(ADMIN);
    const baseline = await fetchLatestLocalNumber();

    const lot = await fetchServerLotByBatch("LOT-004");
    expect(lot?.id).toBe(LOT_OTRIVIN);
    expect(new Date(lot!.expirationDate).getTime()).toBeLessThan(Date.now());
    // Still ACTIVE, which is what makes it sellable: nothing flips the state.
    expect(lot?.state).toBe("ACTIVE");

    await addProductToCart("otrivin", ALREADY_EXPIRED);

    const row = `//section[@data-nav-zone="cart"]//tr[.//p[contains(text(),"${ALREADY_EXPIRED}")]]`;
    await waitVisible(
      `${row}//p[contains(text(),"LOT-004")]`,
      20,
      500,
      "expired lot's cart row",
    );

    // No near-expiry badge: `isNearExpiry` returns false for a past date, so the
    // cart shows an expired lot exactly as it shows a fresh one.
    const badgeCount = await browser.execute((selector: string) => {
      const rowEl = document.evaluate(
        selector,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue as Element | null;
      if (!rowEl) return -1;
      return rowEl.querySelectorAll("span.pos-badge").length;
    }, row);
    expect(badgeCount).toBe(0);

    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    // And it books: the expired lot's stock is consumed like any other.
    const sale = await waitForNewServerSale(baseline);
    expect(sale.items[0].lots[0].lotId).toBe(LOT_OTRIVIN);
    expect(sale.queue?.status).toBe("COMPLETED");
    const after = await fetchServerLotByBatch("LOT-004");
    expect(after?.currentStock).toBe((lot?.currentStock ?? 0) - 1);
  });

  it("E2E-X03: the lot screen is gated by the tenant's requireLotOnReception flag", async () => {
    // The flag is the only thing that decides whether lot management exists at
    // all: with it off, `inventory-lots.page.tsx` renders a single "disabled"
    // paragraph and the hub page omits the card entirely.
    await signInAs(ADMIN);

    await openScreen("Configuración");
    await waitVisible(
      '//nav[@aria-label="Empresa"]',
      30,
      1_000,
      "config tab nav",
    );
    await openConfigTab("Compras");
    await waitVisible(
      'button#requireLotOnReception[role="switch"]',
      20,
      1_000,
      "requireLotOnReception switch",
    );
    await setSwitch("requireLotOnReception", true);
    await waitForTenantConfigValue("purchases", "requireLotOnReception", true);

    // With the flag on, the hub page grows a Lotes card.
    await openScreen("Productos");
    await expectPageHeading("Productos e Inventario");
    await openHubCard("Lotes");
    await waitGone(
      '//p[contains(.,"gestión de lotes está desactivada")]',
      5,
      200,
      "lot-management-disabled notice",
    );

    // The lots table reports both fixtures as expired or expiring, by count —
    // which is a different, 90-day threshold from the cart's 30-day badge, so
    // the summary is asserted on its own terms.
    await waitVisible(
      'input[placeholder="Buscar por nombre, código o lote..."]',
      30,
      1_000,
      "lot search",
    );
    const summary = await browser.execute(() => {
      const text = Array.from(document.querySelectorAll("p"))
        .map((el) => el.textContent ?? "")
        .find((t) => t.includes("activos") && t.includes("Stock total"));
      return text ?? "";
    });
    expect(summary).toContain("vencidos");
    expect(summary).toMatch(/\d+\s+activos/);

    // Turning the flag back off removes the card again, which proves the gate is
    // the flag and not a stale route.
    await openScreen("Configuración");
    await waitVisible(
      '//nav[@aria-label="Empresa"]',
      30,
      1_000,
      "config tab nav",
    );
    await openConfigTab("Compras");
    await setSwitch("requireLotOnReception", false);
    await waitForTenantConfigValue("purchases", "requireLotOnReception", false);

    await openScreen("Productos");
    await expectPageHeading("Productos e Inventario");
    await browser.waitUntil(
      async () =>
        !(await browser.execute(() =>
          Boolean(
            Array.from(document.querySelectorAll("h3")).find(
              (el) => el.textContent?.trim() === "Lotes",
            ),
          ),
        )),
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg:
          "the Lotes card is still on the inventory hub after " +
          "requireLotOnReception was turned off",
      },
    );
  });
});
