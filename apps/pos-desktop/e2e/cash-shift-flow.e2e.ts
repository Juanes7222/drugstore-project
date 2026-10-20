/**
 * E2E: Cash shift — the store-wide shift the POS opens, and its closing
 * arqueo.
 *
 * Why this file exists
 * --------------------
 * The shift is the spine of the register. Every sale is booked into one
 * (`Sale.cashShiftId` is NOT NULL), the shift's expected closing amount is
 * what the arqueo compares the counted cash against, and the model is
 * store-wide: ONE open shift for every workstation.
 *
 * Until now the suite OPENED a shift without ever asserting one. The sales
 * screen is gated by an active shift, so `ensureSalesScreen` opens one
 * through the real UI as a side effect of reaching the sales screen — which
 * means every sale spec in the suite was silently exercising the shift
 * without checking it. A shift that never reached the server, or a sale
 * booked into a different shift than the register believes, would have passed
 * every other spec in the suite.
 *
 * What is asserted here, on BOTH sides:
 *
 *   POS opens the shift → the `SHIFT_OPEN` replay lands → the server holds
 *   THE SAME shift id, OPEN, with the same opening balance → the sale is
 *   booked into THAT shift in both databases → closing the shift from the UI
 *   closes it on the server with the counted cash.
 *
 * The shift is store-wide, so this spec runs LAST in the suite (see
 * `wdio.conf.ts`): closing the shift would leave every later spec without
 * one.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  addProductToCart,
  goToPayment,
  isVisible,
  openScreen,
  payWithCash,
  readPaymentTotalDue,
  resetForSpec,
  signInAs,
  waitEnabled,
  waitVisible,
  type SuiteAccount,
} from "./helpers";
import {
  describeSyncQueue,
  fetchLatestLocalNumber,
  waitForNewServerSale,
  waitForServerCashShift,
  waitForTerminalSyncOperation,
} from "./server-state";
import {
  fetchLocalCashShift,
  fetchLocalOpenShift,
  fetchLocalSaleDetail,
  type LocalCashShift,
} from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

const ACETAMINOFEN = "Acetaminofén 500mg";

/**
 * What is on screen right now, in a form a human can read.
 *
 * The close wizard is four components deep and every one of them is
 * animated, so "the button never appeared" is not a diagnosis: the wizard
 * may be showing "no sales in this shift", a card that is still animating
 * out, or a different step entirely.
 */
async function describeWizard(): Promise<string> {
  return browser.execute(() => {
    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(visible)
      .map((b) => b.textContent?.trim())
      .filter((t): t is string => Boolean(t));
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter(visible)
      .map((i) => `${i.id || "(no id)"}="${(i as HTMLInputElement).value}"`);
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .filter(visible)
      .map((h) => h.textContent?.trim())
      .filter((t): t is string => Boolean(t));
    const paragraphs = Array.from(document.querySelectorAll("p"))
      .filter(visible)
      .map((p) => p.textContent?.trim())
      .filter((t): t is string => Boolean(t))
      .slice(0, 6);
    return (
      `headings=${JSON.stringify(headings)} ` +
      `buttons=${JSON.stringify(buttons)} ` +
      `inputs=${JSON.stringify(inputs)} ` +
      `text=${JSON.stringify(paragraphs)}`
    );
  });
}

/**
 * Drive the close wizard from the active-shift view to the closed shift.
 *
 * Three steps: summary → count (one card per payment method, then a summary
 * card) → confirm. Each card's declared amount is pre-filled with the
 * expected one, so the count the cashier declares IS the expected one and no
 * step-up is required.
 */
async function closeShiftThroughWizard(): Promise<void> {
  await waitVisible("button*=Cerrar turno", 20, 1_000, "Close shift button");
  await (await $("button*=Cerrar turno")).click();

  // Step 1 — the sales summary of the shift.
  await waitVisible("button*=Siguiente", 20, 1_000, "Summary next button");
  await (await $("button*=Siguiente")).click();
  await waitVisible(
    '//h3[normalize-space(.)="Conteo de cierre"]',
    20,
    1_000,
    "Count step title",
  );

  // Step 2 — one card per payment method, then the count summary card. The
  // last card and the summary card both advance with "Revisar"; the earlier
  // cards advance with "Siguiente".
  for (let step = 0; step < 12; step += 1) {
    if (await isVisible("button*=Confirmar cierre")) break;

    if (await isVisible('input[id^="count-"]')) {
      const advance = (await isVisible("button*=Revisar"))
        ? "button*=Revisar"
        : "button*=Siguiente";
      await waitEnabled(advance, 10, 500, "Count card advance button");
      await (await $(advance)).click();
    } else {
      try {
        await waitVisible(
          "button*=Revisar",
          10,
          500,
          "Count summary review button",
        );
      } catch (error) {
        throw new Error(
          "the count step never showed its summary card. " +
            `Screen: ${await describeWizard()}. ` +
            `Original: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await (await $("button*=Revisar")).click();
    }

    // The cards animate in and out; a click that lands mid-transition hits a
    // button that is on its way out.
    await browser.pause(700);
  }

  await waitVisible(
    "button*=Confirmar cierre",
    20,
    1_000,
    "Confirm close button",
  );
  await (await $("button*=Confirmar cierre")).click();
  // The page now shows "Cerrando turno..." while the close runs, and the
  // success message when it is done. The SPEC does not wait for either: the
  // local row is the evidence, and the screen is only reported when the
  // close does not land.
}

/**
 * Wait for the local shift to be CLOSED, or report what the screen says.
 *
 * The close writes the counts, closes the shift and enqueues the
 * SHIFT_CLOSURE — three writes, of which only the last one is visible on
 * screen. The row is the evidence; the screen is the diagnosis when the
 * row never moves.
 */
async function waitForLocalClosedShift(
  shiftId: string,
  timeoutMs = 120_000,
): Promise<LocalCashShift> {
  const deadline = Date.now() + timeoutMs;
  let last: LocalCashShift | null = null;

  while (Date.now() < deadline) {
    last = await fetchLocalCashShift(shiftId);
    if (last?.state === "CLOSED") return last;
    await browser.pause(1_000);
  }

  throw new Error(
    `the local shift ${shiftId} never closed (last state: ${last?.state}). ` +
      `Screen: ${await describeWizard()}`,
  );
}

describe("Cash shift (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-SH01: the shift the POS opened reaches the server and the sale is booked into it", async () => {
    await signInAs(ADMIN);

    const baseline = await fetchLatestLocalNumber();

    // Reaching the sales screen opens the shift when the store has none — the
    // sales screen is gated by an active shift — so the sale below is booked
    // into a shift this spec opened through the real UI.
    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();
    const totalDue = await readPaymentTotalDue();
    await payWithCash(String(totalDue));

    const sale = await waitForNewServerSale(baseline);

    // ---- The POS's own shift.
    const localShift = await fetchLocalOpenShift();
    if (!localShift) {
      throw new Error(
        "the POS has no open cash shift, so the sale was booked into a shift " +
          "that does not exist in the local database. Sync queue: " +
          (await describeSyncQueue()),
      );
    }

    // ---- The server's copy of the SAME shift. The `SHIFT_OPEN` replay
    // creates the server row under the POS's own shift id, so the two
    // stores' shifts are one row seen twice — that shared id is what makes
    // the sale's `cashShiftId` mean the same thing on both sides.
    const serverShift = await waitForServerCashShift(localShift.id, "OPEN");
    expect(serverShift.state).toBe("OPEN");
    expect(serverShift.openingBalance).toBe(localShift.openingBalance);

    const opened = await waitForTerminalSyncOperation("SHIFT_OPEN");
    expect(opened.status).toBe("COMPLETED");

    // ---- And the sale is booked into THAT shift in both databases: the link
    // that makes the arqueo add up.
    const localSale = await fetchLocalSaleDetail(sale.localNumber);
    expect(localSale?.cashShiftId).toBe(localShift.id);
    expect(sale.cashShiftId).toBe(localShift.id);
  });

  it("E2E-SH02: closing the shift from the UI closes it on the server with the counted cash", async () => {
    const localShift = await fetchLocalOpenShift();
    if (!localShift) {
      throw new Error(
        "the POS has no open cash shift to close. Sync queue: " +
          (await describeSyncQueue()),
      );
    }
    const shiftId = localShift.id;

    await openScreen("Turno de Caja");
    await closeShiftThroughWizard();

    // ---- Local: the shift is closed and carries the counted amounts.
    const closedLocal = await waitForLocalClosedShift(shiftId);
    expect(closedLocal.cashCounts.length).toBeGreaterThan(0);

    // ---- Server: the `SHIFT_CLOSURE` replay closed the SAME shift with the
    // SAME counted amounts. A closure the server never received is a drawer
    // the pharmacy can no longer reconcile against the fiscal books.
    const closure = await waitForTerminalSyncOperation("SHIFT_CLOSURE");
    if (closure.status !== "COMPLETED") {
      throw new Error(
        `the SHIFT_CLOSURE replay did not complete (status ${closure.status}). ` +
          `The server said: ${closure.lastErrorMessage ?? "no reason given"}. ` +
          `Sync queue: ${await describeSyncQueue()}`,
      );
    }

    const serverShift = await waitForServerCashShift(shiftId, "CLOSED");
    expect(serverShift.forcedClose).toBe(false);
    expect(serverShift.expectedClosingAmount).toBe(
      closedLocal.expectedClosingAmount,
    );
    expect(serverShift.actualClosingAmount).toBe(
      closedLocal.actualClosingAmount,
    );
    expect(serverShift.closingDifference).toBe(closedLocal.closingDifference);

    // The counted cash, method by method. Both sides are ordered by payment
    // method, so the rows pair up.
    expect(serverShift.cashCounts.length).toBe(closedLocal.cashCounts.length);
    serverShift.cashCounts.forEach((count, index) => {
      const local = closedLocal.cashCounts[index];
      expect(count.countType).toBe(local.countType);
      expect(count.expectedAmount).toBe(local.expectedAmount);
      expect(count.declaredAmount).toBe(local.declaredAmount);
    });
  });
});

// Keep the browser reference alive for the Tauri service teardown.
void browser;
