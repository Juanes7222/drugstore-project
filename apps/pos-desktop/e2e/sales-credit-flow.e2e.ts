/**
 * E2E: Store credit — real Tauri app against the real NestJS backend.
 *
 * Credit is the one sale shape where the money does not move at the till, so
 * "it looked right on screen" proves nothing. The debt a client carries is
 * reconstructed from rows on both sides:
 *
 *     debt = confirmed sales paid with a CREDIT method
 *          − confirmed returns refunded via a CREDIT method
 *          − abonos still standing (not annulled)
 *
 * Three separate implementations of that formula exist in this codebase — the
 * POS sale-time gate, the POS client screen, and the server. They have already
 * drifted once: `SalesPosService.computeClientCreditDebt` omitted the abono
 * term while its own doc comment claimed to match `CreditService`, so a client
 * who had paid their balance in full was refused their next credit sale with a
 * stale figure. That is precisely the class of bug a UI assertion cannot see
 * and this file exists to catch.
 *
 * So the specs assert storage, not appearance, and they recompute the debt
 * independently in SQL on BOTH databases rather than trusting either app to
 * report its own number. A sale is only "correct" here when the two independent
 * computations agree.
 *
 * ## Fixture prerequisites
 *
 * Two things had to exist before any of this was reachable:
 *
 *   1. A payment method with `category = 'CREDIT'`. Both sides filter on that
 *      category, so with none present every credit total is zero and a credit
 *      payment would be booked as an ordinary one with no limit ever checked.
 *      `baseline.ts` seeds `PM_CREDIT_ID`.
 *   2. `creditLimit > 0` on the client. Null means "credit not enabled" and is
 *      refused identically by POS and server. `baseline.ts` seeds
 *      `CLIENT_CREDIT_LIMIT` on the shared client.
 *
 * ## Why CASHIER and not a richer role
 *
 * `SalesPosService.create()` and `CreditService` both require CASHIER or
 * ADMIN, so a MANAGER cannot complete a credit sale at all. ADMIN is used here
 * for the same reason `sales-flow.e2e.ts` uses it: the boot pulls
 * fiscal-dian/issuer-config and the purchases syncs, which CASHIER may not read,
 * and those 403s stall the boot before the sales screen ever renders.
 */

import { $, $$, browser, expect } from "@wdio/globals";
import {
  login,
  addProductToCart,
  goToPayment,
  waitForReceiptAndNewSale,
  waitVisible,
  waitEnabled,
  waitStaysDisabled,
  clickWhenPresent,
  setInputValue,
  readPaymentTotalDue,
  expectPesos,
  resetForSpec,
  signInAs,
  openConfigTab,
  setSwitch,
  openScreen,
  type SuiteAccount,
} from "./helpers";
import { fetchLatestLocalNumber, waitForNewServerSale } from "./server-state";
import {
  fetchLocalCreditState,
  fetchLocalCreditSalePayment,
  fetchLocalCreditMethods,
  fetchLocalClients,
  fetchLocalConfig,
  fetchLocalSales,
} from "./local-state";
import {
  fetchServerCreditState,
  fetchServerCreditMethods,
  waitForServerCreditDebt,
} from "./server-state";
import { reconcileRow, assertNoDefects } from "./reconcile";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
} as const;

/**
 * OWNER, not the suite's usual ADMIN, because enabling store credit happens on
 * the configuration page and every other config spec already establishes that
 * page's behaviour under this role.
 */
const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const ACETAMINOFEN = "Acetaminofén 500mg";
const CLIENT_NAME = "Cliente de Prueba E2E";

/**
 * The client's identification as stored.
 *
 * "900123456-7", not "900123456": the fixture seeds the check digit, and the POS
 * copies the full string when it pulls the client. The cart's search box matches
 * on a prefix, which is why typing the short form finds the row — but every
 * equality assertion against the database has to use the stored value.
 */
const CLIENT_IDENTIFICATION = "900123456-7";

/**
 * The select that offers a given payment method.
 *
 * Addressed by the option it contains rather than by row index: the number of
 * rows depends on how many payment methods the cashier has added, and the
 * `Crédito` option only exists once the method is in the local catalog.
 */
function methodSelect(methodName: string): string {
  return `//select[option[normalize-space(.)="${methodName}"]]`;
}

/**
 * Split the tender across rows: everything on `methodName`, nothing on cash.
 *
 * The first row always resolves to the DB cash method, so the split is
 * "row 1 = 0, row 2 = full total" — the same shape `sales-flow.e2e.ts` uses for
 * its cash/debit split.
 */
async function payEntirelyWith(
  methodName: string,
  total: number,
): Promise<void> {
  await waitVisible("button*=Agregar método", 15, 1_000, "Add method button");
  await (await $("button*=Agregar método")).click();

  await waitVisible(
    methodSelect(methodName),
    15,
    1_000,
    `${methodName} method picker`,
  );

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
 * Turn on store credit in Settings → Ventas.
 *
 * Not optional, and not a shortcut: `getActivePaymentMethodsList()` filters
 * every CREDIT method out of every picker while `salesConfig.creditEnabled` is
 * false (`cash-shift.service.ts:1735`), and that flag defaults to false. With
 * the method hidden there is no way to put the sale on credit at all, so a spec
 * that skipped this would be testing nothing.
 *
 * Run as OWNER because that is the role the configuration page is exercised
 * with elsewhere, then the sale itself runs as ADMIN — `SalesPosService.create()`
 * requires CASHIER or ADMIN.
 *
 * Idempotent (`setSwitch` only clicks when the value differs), so every spec
 * that needs credit calls this rather than depending on the one before it having
 * left the switch on.
 */
async function enableStoreCredit(): Promise<void> {
  await signInAs(OWNER);

  await openScreen("Configuración");
  // The nav is the config page's readiness signal — it appears once the shell
  // mounts, and it carries aria-label "Empresa" whichever of the tabs is up.
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
 * Wait for the client pull to land the baseline client locally.
 *
 * The boot's client sync is asynchronous and its completion is not observable
 * from the login screen, so reading the client immediately after signing in
 * races it. The sale itself would fail identically — the credit state reader
 * would find no row — but the error would point at the credit assertion rather
 * than at the missing sync.
 */
async function waitForLocalClient(
  identificationNumber: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen: string[] = [];

  while (Date.now() < deadline) {
    const clients = await fetchLocalClients();
    seen = clients.map((c) => `${c.identificationNumber}/${c.fullName}`);
    if (clients.some((c) => c.identificationNumber === identificationNumber)) {
      return;
    }
    await browser.pause(1_000);
  }

  throw new Error(
    `client ${identificationNumber} never reached the local database within ` +
      `${timeoutMs}ms. Local clients: ${seen.length ? seen.join(" | ") : "(none)"}`,
  );
}

describe("Store credit (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-CR01: the CREDIT payment method reaches both databases", async () => {
    // The precondition every other spec here rests on. Without it the credit
    // code paths are not merely wrong, they are unreachable: `creditMethods`
    // filters to category CREDIT, so an empty set makes `sumCreditPayments`
    // return zero and the limit is never consulted at all.
    await login(ADMIN.identifier, ADMIN.password);

    const local = await fetchLocalCreditMethods();
    expect(local.map((m) => m.name)).toContain("Crédito");
    // Store credit is a receivable, not cash tendered. If it were flagged cash
    // the shift reconciliation would balance against money never received.
    expect(local.every((m) => m.isCash === false)).toBe(true);

    const server = await fetchServerCreditMethods();
    expect(server.map((m) => m.name)).toContain("Crédito");

    assertNoDefects(
      reconcileRow(
        "PaymentMethod CREDIT",
        { name: local[0].name, isCash: String(local[0].isCash) },
        { name: server[0].name, isCash: String(server[0].isCash) },
        { name: { kind: "text" }, isCash: { kind: "text" } },
      ),
      "credit payment method",
    );
  });

  it("E2E-CR02: a credit sale is persisted locally and replayed to the server with the same debt", async () => {
    await enableStoreCredit();
    await signInAs({
      identifier: ADMIN.identifier,
      password: ADMIN.password,
      displayName: "Administradora Principal",
    });
    await waitForLocalClient(CLIENT_IDENTIFICATION);

    // The POS never hardcodes the limit — it comes from the client row the
    // server holds. Assert the local copy carries it before selling on credit,
    // because a client pulled without a limit makes every credit sale fail with
    // CreditNotEnabledForClientException and the cause is invisible from the UI.
    //
    // The debt is snapshotted rather than assumed to be zero: the POS's local
    // database survives between e2e runs (only the server is re-baselined), so
    // this spec has to assert the DELTA it causes. That is also the stronger
    // claim — it proves this sale moved the balance by exactly its own total,
    // whatever was outstanding beforehand.
    const before = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    expect(before.creditLimit).toBeGreaterThan(0);

    const baseline = await fetchLatestLocalNumber();

    await addProductToCart("acetaminofén", ACETAMINOFEN);

    // The client selector lives in the CART panel and must be used BEFORE the
    // payment screen, which has no such control — the payment screen only shows
    // whichever client is already attached. The collapsed prompt reads
    // "Cliente (opcional)" / "Cliente requerido para esta venta" and only exists
    // once the cart has items.
    //
    // `ancestor-or-self` is required: the sidebar entry IS the role="menuitem"
    // element, so a plain `ancestor::` does not exclude it and the click
    // navigates to the clients page instead of opening the selector.
    await clickWhenPresent(
      '//button[contains(., "Cliente") and not(ancestor-or-self::*[@role="menuitem"])]',
      "client selector prompt",
    );

    // Located by aria-label, not placeholder: the client selector's visible hint
    // changes with context and is not a stable handle. The bare number is typed
    // deliberately — `ClientsService.search` only treats an all-digits query as a
    // document lookup, so "900123456-7" would be matched against the client NAME
    // and find nothing.
    const clientSearchSelector =
      'input[aria-label="Buscar cliente por nombre o documento..."]';
    await waitVisible(clientSearchSelector, 20, 500, "Client search input");
    await setInputValue(clientSearchSelector, "900123456", "client search");

    const resultSelector =
      '//*[@role="option"][contains(., "Cliente de Prueba E2E")]';
    await waitVisible(resultSelector, 20, 500, "client search result");
    await (await $(resultSelector)).click();

    await goToPayment();
    const totalDue = await readPaymentTotalDue();

    await payEntirelyWith("Crédito", totalDue);

    // The credit panel is the register's own statement of what this sale will
    // do to the client's balance. It reads limit / debt / available, so it is
    // worth asserting it is showing THIS client's figures and not placeholders.
    await waitVisible('//*[contains(., "Crédito")]', 15, 1_000, "credit panel");

    await waitEnabled(
      "button*=Confirmar pago",
      15,
      1_000,
      "Confirm payment button",
    );
    await (await $("button*=Confirmar pago")).click();
    await waitForReceiptAndNewSale();

    // ---- Local: the sale and its credit line must both be on disk -----------
    const localNumber = await waitForLocalCreditSale(baseline, totalDue);

    const localPayment = await fetchLocalCreditSalePayment(localNumber);
    expect(localPayment).not.toBeNull();
    expect(localPayment?.category).toBe("CREDIT");
    expect(localPayment?.isCash).toBe(false);
    expectPesos(
      localPayment?.amount ?? 0,
      totalDue,
      "local credit payment amount",
    );

    const localAfter = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    expectPesos(
      localAfter.debt,
      before.debt + totalDue,
      "local client debt after credit sale",
    );
    expect(localAfter.creditLimit).toBe(before.creditLimit);
    expect(localAfter.creditPaymentCount).toBe(before.creditPaymentCount + 1);

    // ---- Server: the replay must reproduce the same money -------------------
    const sale = await waitForNewServerSale(baseline);
    expect(sale.operationalState).toBe("CONFIRMED");
    expectPesos(sale.totalAmount, totalDue, "server sale total");

    const creditPayments = sale.payments.filter((p) => p.category === "CREDIT");
    expect(creditPayments).toHaveLength(1);
    expectPesos(
      creditPayments[0].amount,
      totalDue,
      "server credit payment amount",
    );
    expect(creditPayments[0].isCash).toBe(false);

    // The client attribution is what makes the debt attributable to anybody.
    expect(sale.client?.identificationNumber).toBe(CLIENT_IDENTIFICATION);
    expect(sale.client?.fullName).toBe(CLIENT_NAME);

    // ---- The whole point: two independent computations must agree -----------
    // Compared against the LOCAL figure rather than the sale total, so a sale
    // that synced but was mis-stored still fails here instead of being masked by
    // a server that happened to agree with the wrong number.
    await waitForServerCreditDebt(CLIENT_IDENTIFICATION, localAfter.debt);
    const serverAfter = await fetchServerCreditState(CLIENT_IDENTIFICATION);

    assertNoDefects(
      reconcileRow(
        `Client ${CLIENT_IDENTIFICATION} credit state`,
        {
          creditLimit: localAfter.creditLimit,
          debt: localAfter.debt,
          creditPaymentCount: localAfter.creditPaymentCount,
        },
        {
          creditLimit: serverAfter.creditLimit,
          debt: serverAfter.debt,
          creditPaymentCount: serverAfter.creditPaymentCount,
        },
        {
          creditLimit: { kind: "money" },
          debt: { kind: "money" },
          creditPaymentCount: { kind: "number" },
        },
      ),
      "client credit state after a credit sale",
    );
  });

  it("E2E-CR03: credit is refused without a registered client, and nothing is persisted", async () => {
    // The domain raises CreditRequiresRegisteredClientException for the generic
    // consumer. Asserted at the UI because the button state is the only thing
    // that stops a cashier finding out the expensive way — and then asserted in
    // the databases, because "the button was disabled" does not prove the sale
    // was never written.
    await login(ADMIN.identifier, ADMIN.password);
    await enableStoreCredit();
    await signInAs({
      identifier: ADMIN.identifier,
      password: ADMIN.password,
      displayName: "Administradora Principal",
    });

    const salesBefore = new Set(
      (await fetchLocalSales()).map((s) => s.localNumber),
    );
    const creditBefore = await fetchLocalCreditState(CLIENT_IDENTIFICATION);

    await addProductToCart("acetaminofén", ACETAMINOFEN);
    await goToPayment();
    const totalDue = await readPaymentTotalDue();

    await payEntirelyWith("Crédito", totalDue);

    // The refusal message, and a confirm button that stays shut for the whole
    // budget — polling it once would pass on a button that merely had not
    // finished rendering.
    await waitVisible(
      '//*[contains(., "crédito solo está disponible para clientes registrados")]',
      15,
      1_000,
      "credit-requires-client notice",
    );
    await waitStaysDisabled(
      "button*=Confirmar pago",
      8,
      500,
      "Confirm payment button",
    );

    // No CONFIRMED sale carrying a credit line was added.
    //
    // NOT "no sale row appeared", and NOT "no row above `baseline`". Reaching
    // the payment screen legitimately creates a DRAFT sale locally, so the row
    // count grows whatever happens next; and `fetchLatestLocalNumber` reads the
    // SERVER while these rows are local, so a numeric comparison is between two
    // different databases and misreports sales that have not synced yet. A set
    // difference over local numbers answers the question actually being asked:
    // did this spec's own actions confirm anything?
    const newSales = (await fetchLocalSales()).filter(
      (s) => !salesBefore.has(s.localNumber),
    );
    for (const sale of newSales) {
      expect(sale.operationalState).not.toBe("CONFIRMED");
      expect(
        await fetchLocalCreditSalePayment(Number(sale.localNumber)),
      ).toBeNull();
    }

    const localAfter = await fetchLocalCreditState(CLIENT_IDENTIFICATION);
    expectPesos(
      localAfter.debt,
      creditBefore.debt,
      "local debt after a refused credit sale",
    );
    expect(localAfter.creditPaymentCount).toBe(creditBefore.creditPaymentCount);

    // A short grace period rather than a long one: the point is that the sale
    // was never queued, and a queued sale would surface within seconds.
    await browser.pause(3_000);
    const serverAfter = await fetchServerCreditState(CLIENT_IDENTIFICATION);
    expectPesos(
      serverAfter.debt,
      creditBefore.debt,
      "server debt after a refused credit sale",
    );
    expect(serverAfter.creditPaymentCount).toBe(
      creditBefore.creditPaymentCount,
    );

    expect(totalDue).toBeGreaterThan(0);
  });
});

/**
 * The local number of a CONFIRMED sale above `baseline` that carries a credit
 * payment for `expectedAmount`.
 *
 * Separate from `waitForNewServerSale` because this asserts the POS wrote the
 * row itself, which is the half of the round trip the server wait would happily
 * mask: a sale synced from a stale queue would arrive with the right server row
 * while the local one was missing.
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
    if (fresh.length > 0)
      lastSeen = Math.max(...fresh.map((s) => Number(s.localNumber)));

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
