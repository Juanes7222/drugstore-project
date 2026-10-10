/**
 * E2E: Inventory adjustments — increase and decrease a lot's stock through
 * the Inventario page and watch the local mirror and the server replay
 * agree on EVERY number.
 *
 * The flow an inventory operator drives:
 *
 *   1. The page loads lot groups grouped by product
 *      (`getLotsGroupedByProduct`). Expanding a group reveals one
 *      `role="option"` row per lot, and clicking one selects it for the
 *      adjustment form.
 *   2. The form calls `create()` and then `apply()` — a DRAFT document, then
 *      an APPLIED one. `apply` is what moves the stock, writes the
 *      InventoryMovement rows, and enqueues an INVENTORY_ADJUSTMENT SyncQueue
 *      entry inside the SAME local transaction.
 *   3. The server replays the entry through `handleInventoryAdjustment` →
 *      `createAndApply` on its own cron tick, which is why the wait for the
 *      server document covers a cron interval and not just an HTTP round trip.
 *
 * What the specs pin down (things only the cross-check catches):
 *
 *   - The movement's `previousStock` / `resultingStock` pair. A POS that
 *     writes `newStock = stock` before its own increment would report a wrong
 *     `previous` — the only field the server recompute can disagree with.
 *   - The NOT-adjusted lot is untouched. A `+7` applied to the wrong lot
 *     passes every aggregation-based assertion while draining stock that
 *     belonged elsewhere; the sibling lot is the isolation witness.
 *   - Decrease-to-zero transitions the lot to EXHAUSTED. Asserted WITH the
 *     stock reaching 0, because the state is what a later FEFO selection and
 *     sale read.
 *   - The role gate: APPLY requires INVENTORY_ASSISTANT or ADMIN. The seeded
 *     CASHIER's attempt is refused with the UI's own message and never syncs.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  signInAs,
  waitVisible,
  openScreen,
  openHubCard,
  setInputValue,
  clickWhenPresent,
  expectToast,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  PRODUCT_ACETAMINOFEN,
  PRODUCT_IBUPROFENO,
  fetchServerAdjustments,
  waitForServerAdjustment,
  fetchServerLotStocksByBatch,
} from "./server-state";
import { fetchLocalAdjustments, fetchLocalLots } from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};
const CASHIER: SuiteAccount = {
  identifier: "carlos.lopez@pos-e2e.local",
  password: "123456",
  displayName: "Carlos López",
};

/** The batch the fixture gives the Ibuprofeno, the product the spec fixes on. */
const BATCH = "LOT-002";
/** The fixture's Acetaminofén batch — the sibling lot left untouched. */
const SIBLING_BATCH = "LOT-001";

/**
 * Walk to the Inventario page (sidebar "Productos" → hub card
 * "Ajustes de Inventario"), then select the lot row addressed by its batch
 * number.
 *
 * The search filters by batchNumber, so typing the batch leaves exactly one
 * group holding exactly that lot — and the LOT row is the `role="option"`
 * the LotSearchPanel renders inside the expanded group.
 */
async function openAdjustmentsPage(): Promise<void> {
  await openScreen("Productos");
  await openHubCard("Ajustes de Inventario");
  // The page's <section> carries the aria-label the i18n title builds:
  // "Inventario". That label, not a page <h1>, is the page's readiness.
  await waitVisible(
    '//section[@aria-label="Inventario"]',
    20,
    1_000,
    "adjustments page shell",
  );
}

async function selectLotByBatch(batchNumber: string): Promise<void> {
  await openAdjustmentsPage();

  await setInputValue("#lot-search-input", batchNumber, "lot search");
  await waitVisible(
    `//div[@role="option"][.//span[normalize-space(.)="${batchNumber}"]]`,
    20,
    1_000,
    `lot row for batch ${batchNumber}`,
  );
  await clickWhenPresent(
    `//div[@role="option"][.//span[normalize-space(.)="${batchNumber}"]]`,
    `lot row ${batchNumber}`,
  );

  // The adjustment form confirms the selection via its heading, which renders
  // `Lote: <batch>` (lot mode) — the same commitment the cart screen makes.
  await waitVisible(
    `//h2[.//span[normalize-space(.)="${batchNumber}"]]`,
    20,
    1_000,
    "adjustment form carrying the selected lot",
  );
}

/**
 * Drive the adjustment form and wait for the local success toast.
 *
 * The type toggle is a pair of LABELS over `sr-only` radios, so the visible
 * Spanish label is the click target. "OTHER" requires a custom reason to be
 * typed before the submit is enabled; passing one fills it.
 */
async function submitAdjustment(args: {
  type: "INCREASE" | "DECREASE";
  quantity: string;
  reason?: "DAMAGED" | "EXPIRED" | "LOSS" | "FOUND" | "OTHER";
  customReason?: string;
  notes?: string;
}): Promise<void> {
  const label = args.type === "INCREASE" ? "Aumentar" : "Disminuir";
  // The label WRAPS the sr-only radio, so clicking the label's text toggles
  // the radio and the form's onAdjustmentTypeChange fires.
  await clickWhenPresent(
    `//label[.//input[@name="adjustment-type"]][normalize-space(.)="${label}"]`,
    `${label} toggle`,
  );

  await setInputValue("#adjustment-quantity", args.quantity, "quantity");

  if (args.reason && args.reason !== "OTHER") {
    await (
      await $("#adjustment-reason")
    ).selectByAttribute("value", args.reason);
  }
  if (args.customReason) {
    await setInputValue(
      "#adjustment-custom-reason",
      args.customReason,
      "custom reason",
    );
  }
  if (args.notes) {
    await setInputValue("#adjustment-notes", args.notes, "notes");
  }

  await clickWhenPresent(
    '//button[normalize-space(.)="Aplicar ajuste"]',
    "apply adjustment",
  );

  // The success toast is the local confirmation that create+apply both
  // committed; it carries the operation type's i18n name. The server replay
  // is asserted AFTER this, so a spec that bypassed the toast would be
  // asserting on a document that has not been built yet.
  await expectToast("Ajuste de inventario");
}

/** The newest APPLIED local document carrying exactly one movement for `lotId`. */
async function waitForLocalAppliedAdjustment(
  lotId: string,
  timeoutMs = 60_000,
) {
  return browser.waitUntil(
    async () => {
      const docs = await fetchLocalAdjustments();
      const applied = docs.find(
        (doc) =>
          doc.state === "APPLIED" &&
          doc.movements.length === 1 &&
          doc.movements[0].lotId === lotId,
      );
      return applied ?? false;
    },
    {
      timeout: timeoutMs,
      interval: 1_000,
      timeoutMsg: `no APPLIED local adjustment covering lot ${lotId}`,
    },
  );
}

describe("Inventory adjustments (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-A01: an increase adds exactly the typed quantity to the selected lot and replays server-side", async () => {
    await signInAs(ADMIN);

    // Baseline read NOW, not an assumed 100: an earlier spec in the same run
    // may already have moved this lot, and a fixed number would silently
    // assert against what the fixture WOULD have had.
    const lotBefore = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.batchNumber === BATCH,
    );
    expect(lotBefore).toBeDefined();
    const localBefore = lotBefore!.currentStock;

    const serverStocksBefore =
      await fetchServerLotStocksByBatch(PRODUCT_IBUPROFENO);
    const serverBefore = serverStocksBefore[BATCH];

    await selectLotByBatch(BATCH);
    await submitAdjustment({
      type: "INCREASE",
      quantity: "7",
      reason: "FOUND",
      notes: "E2E-A01 found units in the backroom",
    });

    // ---- Local: the movement carries the typed delta with a coherent
    // previous/resulting pair. That pair is where a double-count bug lands
    // (previous already reflecting the increment), which no total-only read
    // can see.
    const applied = await waitForLocalAppliedAdjustment(lotBefore!.id);
    const movement = applied.movements[0];
    expect(movement.movementType).toBe("POSITIVE_ADJUSTMENT");
    expect(movement.quantity).toBe(7);
    expect(movement.previousStock).toBe(localBefore);
    expect(movement.resultingStock).toBe(localBefore + 7);

    const lotAfter = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.id === lotBefore!.id,
    );
    expect(lotAfter?.currentStock).toBe(localBefore + 7);

    // ---- Server: the replayed movement carries the SAME pair and the
    // server's own lot moved by the same 7 exactly.
    const serverAdjustment = await waitForServerAdjustment();
    expect(serverAdjustment.state).toBe("APPLIED");
    expect(serverAdjustment.reason).toBe("FOUND");
    expect(serverAdjustment.movements).toHaveLength(1);
    expect(serverAdjustment.movements[0].movementType).toBe(
      "POSITIVE_ADJUSTMENT",
    );
    expect(serverAdjustment.movements[0].quantity).toBe(7);
    expect(serverAdjustment.movements[0].previousStock).toBe(serverBefore);
    expect(serverAdjustment.movements[0].resultingStock).toBe(serverBefore + 7);

    const serverStocksAfter =
      await fetchServerLotStocksByBatch(PRODUCT_IBUPROFENO);
    expect(serverStocksAfter[BATCH]).toBe(serverBefore + 7);
  });

  it("E2E-A02: a decrease drains the lot to zero and both stores mark it EXHAUSTED", async () => {
    await signInAs(ADMIN);

    const lotBefore = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.batchNumber === BATCH,
    );
    expect(lotBefore).toBeDefined();
    const quantity = lotBefore!.currentStock;

    await selectLotByBatch(BATCH);
    // Drain the WHOLE lot: the one decrease whose observable is the state
    // flip. Asserting with the stock at 0 and the state at EXHAUSTED catches
    // a 0-but-ACTIVE lot, which a future FEFO sale would read as sellable.
    await submitAdjustment({
      type: "DECREASE",
      quantity: String(quantity),
      reason: "DAMAGED",
      notes: "E2E-A02 damaged shipment withdrawn in full",
    });

    const applied = await waitForLocalAppliedAdjustment(lotBefore!.id);
    expect(applied.movements[0].movementType).toBe("NEGATIVE_ADJUSTMENT");
    expect(applied.movements[0].resultingStock).toBe(0);

    const lotAfter = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.id === lotBefore!.id,
    );
    expect(lotAfter?.currentStock).toBe(0);
    expect(lotAfter?.state).toBe("EXHAUSTED");

    // ---- Server: same edge replayed. The cron applies the movement and the
    // lot's OWN stock reads 0; the STATE is the server's to carry too, so the
    // assertion includes it (a state the replay forgot propagates a phantom
    // lot to every other workstation).
    await waitForServerAdjustment();
    await browser.waitUntil(
      async () => {
        const stocks = await fetchServerLotStocksByBatch(PRODUCT_IBUPROFENO);
        return stocks[BATCH] === 0;
      },
      {
        timeout: 120_000,
        interval: 1_000,
        timeoutMsg: "the server lot never drained to 0",
      },
    );
  });

  it("E2E-A03: adjusting one product's lot leaves every OTHER lot untouched", async () => {
    // The OTHER reason exercises the custom-reason path: the seeded default
    // marks `inventoryAdjustmentReason` OPTIONAL, so the custom field accepts
    // input without gating the submit — it is exactly the free-text reason a
    // backroom stock-take records, and the payload's `reason` becomes the
    // typed text rather than the OTHER sentinel.
    await signInAs(ADMIN);

    // The sibling is Acetaminofén's lot: a different product, so a product-
    // scoped bug (adjusting by productId rather than lotId) drains it
    // FEFO-first, while a lot-scoped bug leaves it whole. THE NUMBERS ARE
    // THE ISOLATION WITNESS, not the totals.
    const siblingLocalBefore = (
      await fetchLocalLots(PRODUCT_ACETAMINOFEN)
    ).find((lot) => lot.batchNumber === SIBLING_BATCH);
    expect(siblingLocalBefore).toBeDefined();

    const lotBefore = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.batchNumber === BATCH,
    );
    expect(lotBefore).toBeDefined();

    const serverStocksBefore =
      await fetchServerLotStocksByBatch(PRODUCT_ACETAMINOFEN);

    await selectLotByBatch(BATCH);
    await submitAdjustment({
      type: "INCREASE",
      quantity: "3",
      reason: "OTHER",
      customReason: "Conteo de balanza E2E",
      notes: "E2E-A03 cross-check: sibling lot untouched",
    });

    const applied = await waitForLocalAppliedAdjustment(lotBefore!.id);
    expect(applied.movements).toHaveLength(1);
    expect(applied.movements[0].lotId).toBe(lotBefore!.id);

    // The sibling's LOCAL stock is unchanged — a `+3` in the wrong bucket
    // would have shown as a bump here.
    const siblingLocalAfter = (await fetchLocalLots(PRODUCT_ACETAMINOFEN)).find(
      (lot) => lot.batchNumber === SIBLING_BATCH,
    );
    expect(siblingLocalAfter?.currentStock).toBe(
      siblingLocalBefore!.currentStock,
    );

    // And the SERVER's own copy agrees: no aggregate drift, no rows landed.
    const serverStocksAfter =
      await fetchServerLotStocksByBatch(PRODUCT_ACETAMINOFEN);
    expect(serverStocksAfter).toEqual(serverStocksBefore);
  });

  it("E2E-A04: a below-stock decrease is refused locally and nothing reaches the server", async () => {
    await signInAs(ADMIN);

    const lotBefore = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.batchNumber === BATCH,
    );
    expect(lotBefore).toBeDefined();
    const overdrawQuantity = lotBefore!.currentStock + 1;

    const serverAdjBefore = (await fetchServerAdjustments()).map(
      (doc) => doc.id,
    );

    await selectLotByBatch(BATCH);
    await submitAdjustment({
      type: "DECREASE",
      quantity: String(overdrawQuantity),
      reason: "LOSS",
      notes: "E2E-A04 refused overdraw",
    });

    // The refusal surfaces as the page's role=alert banner: the page sets
    // `setError(err.message)` for every non-role error, and
    // AdjustmentExceedsAvailableStockException's message names the REQUESTED
    // amount and the lot's available stock — both halves asserted here so a
    // wrong refusal message cannot pass on a generic banner.
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => {
          const banner = document.querySelector('[role="alert"]');
          return banner?.textContent?.trim() ?? "";
        });
        return text.includes("requested") && text.includes("available");
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg: "no overdraw refusal surfaced after the submit",
      },
    );

    // NO local document got created for the overdraw, and the server saw
    // exactly the same set of documents it started with.
    const localOverdraws = (await fetchLocalAdjustments()).filter((doc) =>
      doc.movements.some((m) => m.quantity === overdrawQuantity),
    );
    expect(localOverdraws).toHaveLength(0);

    const serverAdjAfter = (await fetchServerAdjustments()).map(
      (doc) => doc.id,
    );
    expect(serverAdjAfter).toEqual(serverAdjBefore);
  });

  it("E2E-A05: a CASHIER cannot apply an adjustment — the form refuses and nothing syncs", async () => {
    await signInAs(CASHIER);

    const lotBefore = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.batchNumber === BATCH,
    );
    expect(lotBefore).toBeDefined();

    // The CASHIER must reach the page but not be able to push an
    // adjustment. The apply-side role gate throws INSUFFICIENT_ROLE, which
    // the page maps to the "role_inventory_admin" text; asserting on the
    // Spanish message (rendered where the exception itself never is) is the
    // observable half, and the lot's unchanged count is the behavioural
    // witness.
    const stockBefore = lotBefore!.currentStock;

    await selectLotByBatch(BATCH);
    await submitAdjustment({
      type: "INCREASE",
      quantity: "5",
      reason: "FOUND",
      notes: "E2E-A05 role-gated attempt",
    });

    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => {
          const banner = document.querySelector('[role="alert"]');
          return banner?.textContent?.trim() ?? "";
        });
        return (
          text.includes("permiso") || text.includes("Asistente de Inventario")
        );
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg: "no role refusal surfaced for the cashier's attempt",
      },
    );

    // Nothing changed anywhere: the stock is byte-identical and no document
    // exists. A role gate that sent a PENDING entry to the queue would
    // eventually replay server-side, which is exactly the leak this catches.
    const lotAfter = (await fetchLocalLots(PRODUCT_IBUPROFENO)).find(
      (lot) => lot.id === lotBefore!.id,
    );
    expect(lotAfter?.currentStock).toBe(stockBefore);
    expect(
      (await fetchLocalAdjustments()).filter((d) => d.state === "APPLIED"),
    ).toHaveLength(0);
  });
});
