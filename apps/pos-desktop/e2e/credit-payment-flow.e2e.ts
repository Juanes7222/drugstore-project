/**
 * E2E: Credit payments (abonos) and their annulment — real Tauri app against
 * the real NestJS backend.
 *
 * An abono is money the pharmacy RECEIVES against a client's debt. It is the
 * one movement in this app where the till gains cash and the debt shrinks at
 * the same time, and it is replayed to the server as `CLIENT_CREDIT_PAYMENT`
 * (and `CLIENT_CREDIT_PAYMENT_ANNULMENT` when a manager reverses it).
 *
 * Both operation types are handled by the server's sync dispatcher
 * (`sync-operation-dispatcher.service.ts:handleClientCreditPayment` and
 * `handleClientCreditPaymentAnnulment`) and BOTH had zero e2e coverage: the
 * dispatcher writes a `ClientCreditPayment` row on the server, and the debt
 * every workstation shows is recomputed from that row. If the replay is
 * missing, the server's debt stays high while the POS's debt shows the
 * payment applied — the two disagree, and the disagreement is invisible from
 * either screen.
 *
 * The debt formula is reconstructed independently in SQL on BOTH databases
 * (see `fetchLocalCreditState` and `fetchServerCreditState` in
 * local-state.ts / server-state.ts), because three separate implementations of
 * it exist in this codebase and have already drifted once — the POS's
 * `SalesPosService.computeClientCreditDebt` omitted the abono term while its
 * own comment claimed to match `CreditService`. Recomputing it here is the
 * point: a spec that trusted either app to report its own number would have
 * missed that drift.
 *
 * The specs assert storage on both sides, and they assert the DEBT, which is
 * the thing the two stores can disagree about:
 *
 *     debt = confirmed sales paid with a CREDIT method
 *          − confirmed returns refunded via a CREDIT method
 *          − abonos still standing (not annulled)
 *
 * ## Fixture prerequisites
 *
 * An abono needs debt to pay down, so each spec here first makes a credit
 * sale against the fixture's shared client (creditLimit 500 000, seeded by
 * `baseline.ts`). The credit sale itself is covered by `sales-credit-flow`;
 * what is new here is everything downstream of it.
 *
 * The `CLIENT_CREDIT_PAYMENT` replay is NOT in the batch endpoint's
 * immediate-dispatch set, so it lands through the 30-second cron like most
 * other types — the specs poll for it rather than assuming it is instant.
 */

import { $, $$, browser, expect } from "@wdio/globals";
import {
  addProductToCart,
  clickWhenPresent,
  dismissOverlays,
  expectPageHeading,
  goToPayment,
  isVisible,
  openConfigTab,
  openScreen,
  resetForSpec,
  setInputValue,
  setSwitch,
  signInAs,
  waitEnabled,
  waitVisible,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLocalClients,
  fetchLocalCreditPayments,
  fetchLocalCreditSalePayment,
  fetchLocalCreditState,
  fetchLocalConfig,
  fetchLocalLatestSaleNumber,
  fetchLocalSales,
  waitForLocalAnnulledCreditPayment,
  waitForLocalCreditPayment,
} from "./local-state";
import {
  fetchLatestLocalNumber,
  fetchServerCreditPayments,
  fetchServerCreditState,
  waitForNewServerSale,
  waitForServerAnnulledCreditPayment,
  waitForServerCreditPayment,
  waitForTerminalSyncOperation,
} from "./server-state";
import { assertNoDefects, reconcileRow } from "./reconcile";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

/**
 * ADMIN, not CASHIER: `CreditService.annulCreditPayment` requires
 * `RoleType.ADMIN` (the reversal is a manager action), and `recordCreditPayment`
 * accepts CASHIER or ADMIN. The credit sale that creates the debt is made as
 * ADMIN too, because `SalesPosService.create()` requires CASHIER or ADMIN and
 * the fiscal-dian pulls the boot performs 403 for CASHIER.
 */
const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/**
 * OWNER, because enabling store credit happens on the configuration page
 * (`SalesConfig.creditEnabled` defaults to false, and every CREDIT method is
 * filtered out of every picker while it is off — the same reason
 * `sales-credit-flow.e2e.ts` uses OWNER for that switch.
 */
const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const ACETAMINOFEN = "Acetaminofén 500mg";
const CLIENT_IDENTIFICATION = "900123456-7";

/** 500.00 + 19% IVA — the whole sale goes on credit, so the debt is this. */
const SALE_TOTAL = 595;

/**
 * Turn on store credit in Settings → Ventas.
 *
 * Idempotent (`setSwitch` only clicks when the value differs), so a spec that
 * runs before the credit specs cannot leave the flag off for them.
 */
async function enableStoreCredit(): Promise<void> {
  await signInAs(OWNER);
  await openScreen("Configuración");
  await waitVisible(
    '//nav[@aria-label="Empresa"]',
    30,
    1_000,
    "config tab nav",
  );
  await openConfigTab("Ventas");
  await setSwitch("credit-enabled", true);

  const stored = await fetchLocalConfig();
  const salesConfig = stored.salesConfig as { creditEnabled?: boolean };
  expect(salesConfig?.creditEnabled).toBe(true);
}

/**
 * Make a credit sale against the fixture client, so there is debt to pay down.
 *
 * Returns the local number of the sale, which the caller uses to identify the
 * debt's origin and to prove the sale it paid down was the one it thinks.
 */
async function makeCreditSale(): Promise<number> {
  // Enabling store credit leaves the session as OWNER (the configuration page
  // is exercised with that role), and the sale itself needs CASHIER or ADMIN —
  // `SalesPosService.create()` refuses anything else. So the session goes back
  // to ADMIN before the sale, exactly as `sales-credit-flow.e2e.ts` does.
  await enableStoreCredit();
  await signInAs(ADMIN);

  // Two baselines, because the two stores number sales independently: the
  // LOCAL number identifies the sale the POS just made (the server's number
  // can be ahead of the local one while a replay is in flight), and the
  // SERVER's number is what "a new sale arrived" means there.
  const localBaseline = await fetchLocalLatestSaleNumber();
  const serverBaseline = await fetchLatestLocalNumber();

  await addProductToCart("acetaminofén", ACETAMINOFEN);

  // The client selector lives in the CART panel, so it must be used before
  // moving on to the payment screen — the payment screen has no such control.
  //
  // A client left SELECTED from an earlier sale renders as a chip, and the
  // chip carries the client's NAME rather than the word "Cliente", so the
  // prompt button simply is not in the DOM. The leftover selection is cleared
  // first so the sale this spec makes always starts from no client.
  const selectedChip = 'button[aria-label="Quitar cliente"]';
  if (await isVisible(selectedChip)) {
    await (await $(selectedChip)).click();
    await browser.pause(500);
  }

  await clickWhenPresent(
    '//button[contains(., "Cliente") and not(ancestor-or-self::*[@role="menuitem"])]',
    "client selector prompt",
  );
  await waitVisible(
    'input[aria-label="Buscar cliente por nombre o documento..."]',
    20,
    1_000,
    "client search input",
  );
  await setInputValue(
    'input[aria-label="Buscar cliente por nombre o documento..."]',
    "900123456",
    "client search",
  );
  await waitVisible(
    '//*[@role="option"][contains(., "Cliente de Prueba E2E")]',
    20,
    500,
    "client search result",
  );
  await (
    await $('//*[@role="option"][contains(., "Cliente de Prueba E2E")]')
  ).click();

  await goToPayment();
  await payEntirelyWith("Crédito", SALE_TOTAL);
  await waitEnabled(
    "button*=Confirmar pago",
    15,
    1_000,
    "Confirm payment button",
  );
  await (await $("button*=Confirmar pago")).click();

  const localNumber = await waitForLocalCreditSale(localBaseline, SALE_TOTAL);

  // The SERVER's debt only rises when the replay lands, and that happens on the
  // 30-second cron — so the sale is waited for on the server too. Without this
  // wait the debt comparison below would race the replay and read a server
  // that has not seen the sale yet.
  await waitForNewServerSale(serverBaseline);

  return localNumber;
}

/**
 * The local number of a CONFIRMED sale above `baseline` carrying a credit
 * payment for `expectedAmount`.
 *
 * Separate from the server wait on purpose: this asserts the POS wrote the row
 * itself, which is the half the server wait would happily mask.
 */
async function waitForLocalCreditSale(
  baseline: number,
  expectedAmount: number,
): Promise<number> {
  const deadline = Date.now() + 60_000;
  let lastSeen = -1;

  while (Date.now() < deadline) {
    const sales = await fetchLocalSales();
    const fresh = sales.filter((s) => Number(s.localNumber) > baseline);
    if (fresh.length > 0) {
      lastSeen = Math.max(...fresh.map((s) => Number(s.localNumber)));
    }

    for (const sale of fresh) {
      const localNumber = Number(sale.localNumber);
      if (sale.operationalState !== "CONFIRMED") continue;
      const payment = await fetchLocalCreditSalePayment(localNumber);
      if (payment && Math.abs(payment.amount - expectedAmount) < 0.005) {
        return localNumber;
      }
    }
    await browser.pause(1_000);
  }

  throw new Error(
    `no locally CONFIRMED sale above ${baseline} with a credit payment for ` +
      `${expectedAmount} within 60s (highest local number seen: ${lastSeen})`,
  );
}

/** Split the tender across rows: everything on `methodName`, nothing on cash. */
async function payEntirelyWith(
  methodName: string,
  total: number,
): Promise<void> {
  await waitVisible("button*=Agregar método", 15, 1_000, "Add method button");
  await (await $("button*=Agregar método")).click();

  const methodSelect = `//select[option[normalize-space(.)="${methodName}"]]`;
  await waitVisible(methodSelect, 15, 1_000, `${methodName} method picker`);

  const selects = await $$("select");
  expect(selects.length).toBeGreaterThanOrEqual(2);
  await selects[1].selectByAttribute("value", await optionValue(methodName));

  const amountInputs = await $$('input[aria-label="Valor"]');
  expect(amountInputs.length).toBeGreaterThanOrEqual(2);
  await amountInputs[0].setValue("0");
  await amountInputs[1].setValue(String(total));
}

/** Resolve a method's option value from its visible name. */
async function optionValue(methodName: string): Promise<string> {
  return browser.execute((name: string) => {
    const select = Array.from(document.querySelectorAll("select")).find((el) =>
      Array.from(el.options).some(
        (opt) => (opt.textContent ?? "").trim() === name,
      ),
    );
    const option = select
      ? Array.from(select.options).find(
          (opt) => (opt.textContent ?? "").trim() === name,
        )
      : null;
    return option?.value ?? "";
  }, methodName);
}

/**
 * The fixture client's row on the clients screen.
 *
 * Addressed by the identification the local mirror holds, not by a hardcoded
 * name: the local database survives between runs, and the fixture client's row
 * is what the POS renders — a name typed into the spec can drift from it.
 */
async function waitForFixtureClientInMirror(): Promise<{
  fullName: string;
  identificationNumber: string;
}> {
  const deadline = Date.now() + 60_000;
  let seen = "no client yet";

  while (Date.now() < deadline) {
    const clients = await fetchLocalClients();
    const found = clients.find(
      (client) => client.identificationNumber === CLIENT_IDENTIFICATION,
    );
    if (found) return found;
    seen = clients.length
      ? clients.map((client) => client.identificationNumber).join(", ")
      : "no client in the mirror yet";
    await browser.pause(500);
  }

  throw new Error(
    `the client ${CLIENT_IDENTIFICATION} never reached the local mirror within ` +
      `60s (mirror holds: ${seen})`,
  );
}

/**
 * Open the fixture client's detail dialog.
 *
 * The dialog is the only per-client view that carries the credit state and
 * the credit history, so it is what an abono is recorded from.
 */
async function openClientDialog(): Promise<void> {
  // The detail dialog is a Radix modal, and its overlay stays mounted after
  // the NESTED abono dialog closes ? so a spec that opens the detail dialog
  // twice finds the second `openScreen("Clientes")` click intercepted by the
  // overlay of the first one. Escape is the dialog's own dismissal
  // affordance, so this is the same path a user takes.
  await dismissOverlays();

  await openScreen("Clientes");
  await expectPageHeading("Clientes");

  // The client is waited for in the MIRROR before the screen is used.
  //
  // The clients screen filters the list it has, and the list it has is what
  // the catalog pull has brought down so far. Filtering before the pull
  // arrives leaves the table empty, and the row the spec wants is in it.
  const mirror = await waitForFixtureClientInMirror();

  // The row is addressed by the NAME the mirror holds, and by the CELL rather
  // than the row: a row can be on screen before its cells are, and clicking
  // "the row" then hits a half-rendered table.
  const cell = `//table//tr[td][.//span[normalize-space(.)="${mirror.fullName}"]]/td[1]`;
  await clickWhenPresent(cell, "client row name cell");
  await waitVisible('//div[@role="dialog"]', 20, 1_000, "client detail dialog");
}

describe("Credit payments (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-CP01: an abono is written locally, replayed server-side, and both debts fall by exactly its amount", async () => {
    // Sign in FIRST: the local database is only reachable once the app has
    // booted and exposed `window.__db`, and the boot needs a session. Reading
    // the mirror before that reports "window.__db is not available" — a
    // harness error dressed up as a product failure.
    await signInAs(ADMIN);

    // ---- The debt before the abono, recomputed independently on both sides.
    const localBefore = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverBefore = await fetchServerCreditState(CLIENT_IDENTIFICATION);
    expect(localBefore.creditLimit).toBeGreaterThan(0);

    // The sale that creates the debt has to exist for the abono to have
    // something to pay down, and it has to be a CREDIT sale — a cash sale
    // never contributes to the debt.
    const saleNumber = await makeCreditSale();

    // The debt exists because THAT sale was confirmed — the debt is not a
    // number the app made up.
    //
    // The local number is a BIGINT: PGlite hands it back as a string through
    // one path and as a number through another, so both sides are compared as
    // strings.
    const confirmed = await fetchLocalSales();
    expect(
      confirmed.some(
        (sale) =>
          String(sale.localNumber) === String(saleNumber) &&
          sale.operationalState === "CONFIRMED",
      ),
    ).toBe(true);

    const localWithDebt = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverWithDebt = await fetchServerCreditState(CLIENT_IDENTIFICATION);
    expect(localWithDebt.debt).toBeGreaterThan(localBefore.debt);
    expect(serverWithDebt.debt).toBeGreaterThan(serverBefore.debt);

    // The standing abonos, counted on both sides before the one this spec
    // records — the debt formula subtracts exactly these.
    const localStandingBefore = (await fetchLocalCreditPayments()).filter(
      (payment) => !payment.annulledAt,
    ).length;
    const serverStandingBefore = (await fetchServerCreditPayments()).filter(
      (payment) => !payment.annulledAt,
    ).length;

    // ---- Record the abono through the client detail dialog.
    await openClientDialog();
    await clickWhenPresent("button*=Abono", "Abono button");
    await waitVisible(
      'input[aria-label="Monto del abono"]',
      15,
      1_000,
      "abono amount input",
    );

    const ABONO = 200;
    await setInputValue(
      'input[aria-label="Monto del abono"]',
      String(ABONO),
      "abono amount",
    );
    await setInputValue(
      'input[aria-label="Nota (opcional)"]',
      "Pago en efectivo en caja",
      "abono notes",
    );
    await clickWhenPresent("button*=Registrar abono", "Registrar abono button");

    // ---- The POS's own row for the payment.
    //
    // The dialog closes on success, so the row is read from the database
    // rather than from the screen: the row the cashier's drawer is balanced
    // against is the one that matters.
    const localPayment = await waitForLocalCreditPayment(ABONO);

    // ---- The server's row for the same payment.
    //
    // `CLIENT_CREDIT_PAYMENT` is not in the batch endpoint's
    // immediate-dispatch set, so the replay lands through the 30-second cron.
    const replay = await waitForTerminalSyncOperation("CLIENT_CREDIT_PAYMENT");
    expect(replay.status).toBe("COMPLETED");

    const serverPayment = await waitForServerCreditPayment(
      localPayment.id,
      ABONO,
    );
    expect(serverPayment.amount).toBe(ABONO);
    expect(serverPayment.annulledAt).toBeNull();

    // ---- Full-width reconciliation of the payment itself.
    //
    // The payment is one row on each side; a drift in the amount or the
    // method is a cashier who was told a number the books do not carry.
    assertNoDefects(
      reconcileRow(
        `ClientCreditPayment ${localPayment.id}`,
        {
          amount: localPayment.amount,
          paymentMethodId: localPayment.paymentMethodId,
          notes: localPayment.notes,
          clientId: localPayment.clientId,
        },
        {
          amount: serverPayment.amount,
          paymentMethodId: serverPayment.paymentMethodId,
          notes: serverPayment.notes,
          clientId: serverPayment.clientId,
        },
        {
          amount: { kind: "money" },
          paymentMethodId: { kind: "text" },
          notes: { kind: "text" },
          clientId: { kind: "text" },
        },
      ),
      "credit payment CP01",
    );

    // ---- And the debt both sides now report.
    const localAfter = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverAfter = await fetchServerCreditState(CLIENT_IDENTIFICATION);

    expect(localAfter.debt).toBeCloseTo(localWithDebt.debt - ABONO, 0);
    expect(serverAfter.debt).toBeCloseTo(serverWithDebt.debt - ABONO, 0);
    expect(localAfter.debt).toBeCloseTo(serverAfter.debt, 0);

    // ---- And the payment is counted as standing on both sides.
    //
    // `creditPaymentCount` counts SALES paid by credit, so an abono does not
    // move it — what an abono moves is the number of STANDING abonos, and
    // that is the term the debt formula subtracts. Counting them on both
    // sides is the assertion that the payment is a real row in both stores
    // and not just a number that happens to match.
    const localStanding = (await fetchLocalCreditPayments()).filter(
      (payment) => !payment.annulledAt,
    ).length;
    const serverStanding = (await fetchServerCreditPayments()).filter(
      (payment) => !payment.annulledAt,
    ).length;
    expect(localStanding).toBe(localStandingBefore + 1);
    expect(serverStanding).toBe(serverStandingBefore + 1);
    expect(localStanding).toBe(serverStanding);

    // The detail dialog is closed on the way out: a Radix overlay left
    // mounted intercepts every click in the next spec, and the failure
    // surfaces far away from its cause.
    await dismissOverlays();
  });

  it("E2E-CP02: annulling an abono restores the debt on both sides, and the reversal is replayed", async () => {
    await signInAs(ADMIN);

    // An abono to annul. A client with no debt has nothing to pay down, so
    // the sale that creates it happens first — the same shape as CP01.
    //
    // `makeCreditSale` enables store credit itself, so this spec does NOT
    // call `enableStoreCredit` separately: a second call finds the session
    // already switched to OWNER and lands the app on a different screen than
    // the one the sale flow expects.
    await makeCreditSale();

    // The debt this spec pays down and then restores. CP01's own abono is
    // still standing at this point (it is not annulled), so the baseline is
    // read HERE rather than assumed: each spec measures the debt from the
    // state it found, so a spec that runs alone and a spec that runs after
    // another one both measure their own delta.
    const localWithDebt = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverWithDebt = await fetchServerCreditState(CLIENT_IDENTIFICATION);

    await openClientDialog();
    await clickWhenPresent("button*=Abono", "Abono button");
    await waitVisible(
      'input[aria-label="Monto del abono"]',
      15,
      1_000,
      "abono amount input",
    );
    const ABONO = 137;
    await setInputValue(
      'input[aria-label="Monto del abono"]',
      String(ABONO),
      "abono amount",
    );
    await setInputValue(
      'input[aria-label="Nota (opcional)"]',
      "Pago en efectivo en caja",
      "abono notes",
    );
    await clickWhenPresent("button*=Registrar abono", "Registrar abono button");

    const localPayment = await waitForLocalCreditPayment(ABONO);
    const serverPayment = await waitForServerCreditPayment(
      localPayment.id,
      ABONO,
    );
    expect(serverPayment.annulledAt).toBeNull();

    const localWithPayment = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverWithPayment = await fetchServerCreditState(
      CLIENT_IDENTIFICATION,
    );
    expect(localWithPayment.debt).toBeCloseTo(localWithDebt.debt - ABONO, 0);
    expect(serverWithPayment.debt).toBeCloseTo(serverWithDebt.debt - ABONO, 0);

    // ---- Annul it. ADMIN only, with a mandatory reason.
    //
    // The annulment happens in the SAME dialog session as the abono: the
    // detail dialog stays open after the nested one closes, and it lists the
    // payment it just recorded with its own "Anular" control. Reopening the
    // dialog instead would run into the still-mounted overlay of the first
    // one, which intercepts every click on the clients screen.
    //
    // The amount identifies the row: the history is ordered newest-first and
    // this spec's amount is unique among the abonos standing.
    const annulButton = `//li[contains(., "${ABONO}")]//button[@aria-label="Anular"]`;
    await waitVisible(annulButton, 20, 500, "abono annul button");
    await clickWhenPresent(annulButton, "abono annul button");
    // The reason is a TEXTAREA, not an input — the app asks for a sentence
    // about the reversal, not a short code.
    await waitVisible(
      'textarea[aria-label="Motivo de anulación"]',
      15,
      1_000,
      "annulment reason field",
    );
    await setInputValue(
      'textarea[aria-label="Motivo de anulación"]',
      "Abono duplicado por error de digitación",
      "annulment reason",
    );
    await clickWhenPresent(
      "button*=Confirmar anulación",
      "Confirmar anulación button",
    );

    // ---- The local row is annulled.
    const annulledLocal = await waitForLocalAnnulledCreditPayment(
      localPayment.id,
    );
    expect(annulledLocal.annulmentReason).toBe(
      "Abono duplicado por error de digitación",
    );

    // ---- And the server applies the same reversal.
    const replay = await waitForTerminalSyncOperation(
      "CLIENT_CREDIT_PAYMENT_ANNULMENT",
    );
    expect(replay.status).toBe("COMPLETED");

    const serverAnnulled = await waitForServerAnnulledCreditPayment(
      localPayment.id,
    );
    expect(serverAnnulled.annulledAt).not.toBeNull();
    expect(serverAnnulled.annulmentReason).toBe(
      "Abono duplicado por error de digitación",
    );

    // ---- The debt is back where it was before this spec's abono: an
    // annulled payment is not "still standing", so it must not count against
    // the debt. CP01's own abono (if it ran first) is still standing, so the
    // debt returns to the baseline this spec measured, not to zero.
    const localAfter = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    const serverAfter = await fetchServerCreditState(CLIENT_IDENTIFICATION);
    expect(localAfter.debt).toBeCloseTo(localWithDebt.debt, 0);
    expect(serverAfter.debt).toBeCloseTo(serverWithDebt.debt, 0);
    expect(localAfter.debt).toBeCloseTo(serverAfter.debt, 0);

    // The dialogs are closed on the way out: a Radix overlay left mounted
    // intercepts every click in the next spec, and the failure surfaces far
    // away from its cause.
    await dismissOverlays();
  });
});
