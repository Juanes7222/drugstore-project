/**
 * E2E: The server refuses an operation the POS accepted — real Tauri app
 * against the real NestJS backend.
 *
 * Why this file exists
 * --------------------
 * Every negative in the suite so far is LOCAL: the POS refuses the duplicate
 * barcode, the overdraw, the sale without a client. Nothing exercised the
 * other half of the contract — the POS accepts an operation, and the SERVER
 * says no.
 *
 * That half is where the money goes missing. The cashier sees the product
 * created, the till shows it in the catalogue, and the operation sits in the
 * outbox. If the refusal is not recorded there, the register believes the
 * movement happened while the books never received it, and nothing in the UI
 * says so — the cashier has no way to learn that what they sold is not in the
 * accounts.
 *
 * So the spec asserts the refusal the outbox has to carry:
 *
 *   - the operation ends in PERMANENT_FAILURE (not a silent retry),
 *   - it is classified as a validation failure,
 *   - it carries the SERVER's reason, not a generic "failed",
 *   - and the server did NOT create the entity.
 *
 * The trigger
 * -----------
 * The product form accepts any number of barcodes; the server's schema caps
 * them at twenty (`CreateProductSchema.barcodes.max(20)`). A product with
 * twenty-one barcodes is therefore written to the POS's own catalogue and
 * queued for the server, which refuses it — deterministically, and with no
 * fiscal machinery involved.
 *
 * A note on what this pins
 * ------------------------
 * The local row survives the refusal: the product stays in the POS's mirror
 * while the server has no such product. That is the divergence the missing
 * limit in the form produces, and this spec does NOT assert it as correct —
 * it asserts the part that must not break: the refusal is visible in the
 * outbox, with the server's reason. If the form ever enforces the same
 * twenty-barcode limit, this spec has to change to assert a LOCAL refusal
 * instead: the case it exercises would no longer be reachable.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  clickButtonByExactText,
  clickWhenPresent,
  expectPageHeading,
  openHubCard,
  openScreen,
  resetForSpec,
  setInputValue,
  signInAs,
  waitVisible,
  type SuiteAccount,
} from "./helpers";
import { fetchLocalSyncQueue } from "./local-state";
import { queryServerRaw } from "./server-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/** Name of the product this spec creates. Every assertion keys on it. */
const PRODUCT_NAME = "Producto Rechazado E2E 500mg";

const PRICE = "5500";
const COST = "3000";

/** TAX_SCHEME_ID of the tenant fixture (IVA 19%), matched against the server. */
const TAX_SCHEME_ID = "7d1f4c60-2b98-4e35-9a0d-6c8b3e5f1d27";

/**
 * The server's schema caps the barcodes at twenty; twenty-one is refused.
 */
const BARCODE_COUNT = 21;

/**
 * A distinct barcode per row.
 *
 * Distinct because the POS refuses a duplicate barcode ITSELF — with the same
 * rule as the server — and that refusal is local, which is the case this file
 * is not about.
 */
function barcode(index: number): string {
  return `770999${String(index).padStart(6, "0")}`;
}

/** The barcode input of the row at `index` (0-based). */
function barcodeInput(index: number): string {
  return `(//input[@placeholder="Código de barras"])[${index + 1}]`;
}

describe("Server rejection (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-N01: a product the server refuses leaves PERMANENT_FAILURE in the outbox, with the server's reason, and no server-side product", async () => {
    await signInAs(ADMIN);

    await openScreen("Productos");
    // The sidebar item leads to the productos-main hub, whose "Productos" card
    // is what actually mounts the products page.
    await openHubCard("Productos");
    await expectPageHeading("Productos");
    await clickButtonByExactText("Nuevo producto");
    await waitVisible("#pf-commercial-name", 20, 1_000, "product form");

    await setInputValue("#pf-commercial-name", PRODUCT_NAME, "product name");
    await setInputValue("#pf-laboratory", "Tecnoquímicas E2E", "laboratory");
    await setInputValue("#pf-price", PRICE, "price");
    await setInputValue("#pf-cost", COST, "initial cost");
    await setInputValue("#pf-invima", "INVIMA-E2E-RECH", "INVIMA registry");

    // The tax scheme is chosen EXPLICITLY and only once the SERVER's row is
    // in the list: the local catalog also carries a `seed-` scheme, and the
    // domain refuses to push that one.
    await waitVisible("#pf-tax-scheme", 60, 1_000, "tax scheme select");
    await browser.waitUntil(
      async () =>
        browser.execute((id: string) => {
          const select = document.querySelector(
            "#pf-tax-scheme",
          ) as HTMLSelectElement | null;
          return (
            !!select &&
            Array.from(select.options).some((option) => option.value === id)
          );
        }, TAX_SCHEME_ID),
      {
        timeout: 60_000,
        interval: 500,
        timeoutMsg:
          "the server's tax scheme never appeared in the product form's options",
      },
    );
    await (await $("#pf-tax-scheme")).selectByAttribute("value", TAX_SCHEME_ID);

    // The first barcode row is prefilled and primary.
    await setInputValue(barcodeInput(0), barcode(0), "primary barcode");

    // Twenty more rows: one past what the server accepts.
    for (let index = 1; index < BARCODE_COUNT; index += 1) {
      await clickWhenPresent("button*=Agregar código", "add barcode button");
      await setInputValue(
        barcodeInput(index),
        barcode(index),
        `barcode ${index}`,
      );
    }

    await clickButtonByExactText("Crear producto");

    // ---- The outbox: the refusal, recorded.
    //
    // The row is found by the product it carries, not by position: the
    // operation type alone would also match the earlier product specs' rows.
    const entry = await browser.waitUntil(
      async () => {
        const rows = await fetchLocalSyncQueue("PRODUCT_CREATION");
        const found = rows.find((row) => row.payload.includes(PRODUCT_NAME));
        return found && found.status === "PERMANENT_FAILURE" ? found : false;
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg:
          `no PRODUCT_CREATION entry for ${PRODUCT_NAME} reached ` +
          "PERMANENT_FAILURE. The server's refusal must be recorded there.",
      },
    );

    // The failure is classified, so the sync-health screen can tell a
    // malformed operation from a transient one.
    if (entry.failureCategory !== "VALIDATION") {
      throw new Error(
        `the refusal was recorded as ${entry.failureCategory} instead of ` +
          `VALIDATION. The server's reason was: ${entry.lastErrorMessage}`,
      );
    }

    // The reason is the SERVER's, so whoever reads the outbox learns what the
    // server actually objected to instead of a generic "failed".
    expect(entry.lastErrorMessage).toBeTruthy();
    expect(entry.lastErrorMessage?.toLowerCase()).toContain("barcode");

    // ---- The server: no product was created.
    //
    // The refusal has to mean the entity does not exist on the server. A
    // half-written product would be worse than the refusal.
    const serverRows = await queryServerRaw<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
         FROM "Product"
        WHERE "commercialName" = $1`,
      [PRODUCT_NAME],
    );
    expect(Number(serverRows[0]?.count ?? 0)).toBe(0);
  });
});
