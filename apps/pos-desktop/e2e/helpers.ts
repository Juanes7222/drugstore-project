/**
 * Shared WDIO helpers for Tauri e2e tests.
 *
 * These helpers drive the real Tauri app (WebView2) through WebDriver against
 * the real NestJS backend (see e2e/real-backend.ts). They rely on the app's
 * Spanish UI labels and on the server fixture world seeded by
 * apps/server/test/pos-e2e/baseline.ts.
 *
 * NOTE: `isDisplayed` / `waitForDisplayed` / `waitForEnabled` / `isExisting`
 * run their checks through `executeAsyncScript`, which is killed by the
 * @wdio/utils 17s wrapper when the tauri-driver bridge is busy (a known
 * flood of browser-level `executeAsyncScript` calls drowns the session).
 * ALL element-state checks in this file therefore use `browser.execute` — a
 * SYNCHRONOUS `executeScript` that is not subject to that wrapper and
 * resolves in milliseconds. Interactions (findElement/click/sendKeys) are
 * native WebDriver protocol commands and are reliable.
 */

import { $, browser } from "@wdio/globals";

const SEARCH_SELECTOR =
  'input[aria-label="Buscar producto por nombre o código de barras..."]';

/**
 * Isolation is handled once per RUN, by `resetWebViewProfile()` in onPrepare.
 *
 * There is deliberately no per-spec reset of the backend either: truncating it
 * between specs destroys the UserSession behind the token the app already holds
 * (the app logs in once and stays logged in for the whole run), so the POS stops
 * pushing entirely and every later spec fails with "the POS never pushed".
 *
 * Specs therefore identify their own sale by comparison: they read the highest
 * local number before acting and wait for a higher one, which is unambiguous
 * because the local sequence only moves forward.
 */
export function resetForSpec(): void {
  // Intentionally empty — see the docblock.
}

/**
 * Resolve an element via the same selector styles used across the specs
 * (plain CSS, webdriverio `tag*=text` partial-text and XPath `//...`) and
 * report its visibility/disabled state — all inside one synchronous script.
 */
async function elementState(
  selector: string,
): Promise<{ found: boolean; visible: boolean; disabled: boolean }> {
  return browser.execute((sel) => {
    let el: Element | null = null;

    if (sel.startsWith("//") || sel.startsWith("(")) {
      const result = document.evaluate(
        sel,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      );
      el = result.singleNodeValue as Element | null;
    } else {
      const textMatch = sel.match(/^([a-zA-Z-]+)\*="?([^"]+)"?$/);
      if (textMatch) {
        const [, tag, text] = textMatch;
        el =
          Array.from(document.querySelectorAll(tag)).find((node) =>
            node.textContent?.includes(text),
          ) ?? null;
      } else {
        el = document.querySelector(sel);
      }
    }

    if (!el) {
      return { found: false, visible: false, disabled: true };
    }

    const visible =
      el instanceof HTMLElement && el.checkVisibility
        ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : el.getBoundingClientRect().width > 0 &&
          el.getBoundingClientRect().height > 0;

    const disabled =
      el instanceof HTMLButtonElement ||
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement
        ? el.disabled
        : el.getAttribute("aria-disabled") === "true";

    return { found: true, visible, disabled };
  }, selector);
}

/**
 * Synchronous visibility check via `executeScript`. Returns true only when
 * the element exists in the DOM and occupies layout space.
 */
async function isVisible(selector: string): Promise<boolean> {
  try {
    const state = await elementState(selector);
    return state.found && state.visible;
  } catch {
    return false;
  }
}

/**
 * Poll `isVisible` with pauses until visible or the attempt budget is spent.
 * Throws with a descriptive message when it never becomes visible.
 */
async function waitVisible(
  selector: string,
  attempts: number,
  pauseMs = 1_000,
  label = "element",
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isVisible(selector)) {
      return;
    }
    await browser.pause(pauseMs);
  }
  throw new Error(`${label} never became visible (selector: ${selector})`);
}

/**
 * Poll with pauses until the element exists, is visible and is enabled
 * (`!disabled`). Replaces `waitForEnabled`, which dies in the 17s wrapper.
 */
async function waitEnabled(
  selector: string,
  attempts: number,
  pauseMs = 1_000,
  label = "element",
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await elementState(selector);
    if (state.found && state.visible && !state.disabled) {
      return;
    }
    await browser.pause(pauseMs);
  }
  throw new Error(`${label} never became enabled (selector: ${selector})`);
}

/**
 * Assert an element never becomes enabled within the attempt budget.
 *
 * The inverse of waitEnabled, for negative cases: a control that must stay
 * locked (confirming a payment that has not been fully tendered, for example).
 * Polls the whole budget instead of sampling once, so a button that enables
 * late — after the state settles — is still caught.
 */
export async function waitStaysDisabled(
  selector: string,
  attempts: number,
  pauseMs = 1_000,
  label = "element",
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await elementState(selector);
    if (state.found && state.visible && !state.disabled) {
      throw new Error(
        `${label} became enabled but must stay disabled (selector: ${selector})`,
      );
    }
    await browser.pause(pauseMs);
  }
}

export { isVisible, waitVisible, waitEnabled };

/**
 * Pin the navigation sidebar so menuitems stay visible and clickable
 * without hover. The rail is collapsed (48px) by default and expands on
 * hover; the hover state is lost between commands, leaving the
 * collapsed rail's hidden menuitem to swallow clicks. Pinning removes that
 * flakiness for the rest of the run (the pin lives in the persisted
 * user-preferences store).
 */
export async function pinSidebar(): Promise<void> {
  if (await isVisible('button[aria-label="Expandir menú"]')) {
    const pinButton = await $('button[aria-label="Expandir menú"]');
    await pinButton.click();
    await waitVisible(
      'button[aria-label="Colapsar menú"]',
      15,
      1_000,
      "Sidebar pin",
    );
  }
}

/**
 * The app instance persists across specs in the same WDIO run, so a cart
 * left over by a failed spec would pollute the next one (products add up
 * and totals no longer match). When the sales screen is visible with items
 * already in the cart, reload the WebView: the Redux cart state is reset
 * while the auth token and the synced PGlite DB survive, so the app boots
 * straight back into the shell.
 *
 * Returns true when a reload was issued (the caller should re-login).
 */
async function clearResidualCart(): Promise<boolean> {
  const hasItems = await browser.execute(() => {
    // The cart panel renders a table with product rows when non-empty.
    return document.querySelectorAll("section table tbody tr").length > 0;
  });
  if (!hasItems) {
    return false;
  }

  await browser
    .execute(() => {
      window.location.reload();
    })
    .catch(() => undefined);
  // Reloaded WebView: wait for the booted sales screen again (fast poll —
  // checks are ms; the warm app boots in seconds).
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await isVisible(SEARCH_SELECTOR)) {
      return true;
    }
    await browser.pause(500);
  }
  return true;
}

/**
 * Wait for the login screen and sign in through the manual form.
 *
 * The manual form appears automatically when no cached users exist, or via
 * the "Otro usuario" link. It has a text input, a password input and an
 * "Ingresar" submit button.
 *
 * If a session is already active (any app screen visible), the helper just
 * navigates to the sales screen so specs stay idempotent across a warm app.
 */
export async function login(
  identifier: string,
  password: string,
): Promise<void> {
  // Already on the sales screen? ensureSalesScreen() handles residual-cart
  // cleanup, so just delegate and return.
  if (await isVisible(SEARCH_SELECTOR)) {
    await ensureSalesScreen();
    return;
  }

  const LOGIN_IDENTIFIER_SELECTOR = 'input[placeholder="usuario@ejemplo.com"]';

  /**
   * The app is not stable right after launch: React renders the login form
   * first, then the boot services take over and it falls back to "Cargando..."
   * while PGlite initialises and the catalog sync runs. A single-pass login
   * therefore finds a form that disappears mid-interaction, or gives up during
   * a cold boot that simply takes longer than the budget.
   *
   * So: retry the whole detect-and-sign-in cycle until the shell is up. Each
   * pass is a fresh look at the DOM, which is what makes a form that remounted
   * mid-fill recoverable instead of fatal.
   */
  let lastError = "";

  for (let pass = 0; pass < 4; pass += 1) {
    // 1. Wait for any known screen. Generous: a wiped PGlite plus a real boot
    //    sync against the backend is minutes on a cold start.
    const landed = await pollFor(
      () =>
        browser.execute(() => ({
          hasSearch: !!document.querySelector(
            'input[aria-label="Buscar producto por nombre o código de barras..."]',
          ),
          hasForm: !!document.querySelector(
            'input[placeholder="usuario@ejemplo.com"]',
          ),
          hasOther: Array.from(document.querySelectorAll("button")).some((b) =>
            b.textContent?.includes("Otro usuario"),
          ),
          hasHome: !!document.querySelector('nav[role="navigation"]'),
        })),
      90,
    );

    if (!landed) {
      lastError = "app never reached a known screen (login or app shell)";
      continue;
    }

    // 2. Already signed in? Jump to sales and finish.
    if (await isVisible(SEARCH_SELECTOR)) {
      await ensureSalesScreen();
      return;
    }

    const otherAccountVisible = await isVisible("button*=Otro usuario");
    const manualFormVisible = await isVisible(LOGIN_IDENTIFIER_SELECTOR);

    if (!manualFormVisible && !otherAccountVisible) {
      // The shell rendered without the search input (e.g. home dashboard).
      await ensureSalesScreen();
      if (await isVisible(SEARCH_SELECTOR)) return;
      lastError = "app shell appeared but never exposed the sales screen";
      continue;
    }

    try {
      if (otherAccountVisible && !manualFormVisible) {
        await clickWhenPresent("button*=Otro usuario", "other-user link");
        await waitVisible(
          LOGIN_IDENTIFIER_SELECTOR,
          15,
          1_000,
          "Manual login form",
        );
      }

      await setInputValue(
        LOGIN_IDENTIFIER_SELECTOR,
        identifier,
        "login identifier",
      );
      await setInputValue('input[type="password"]', password, "login password");
      await clickWhenPresent("button*=Ingresar", "login submit");

      // 3. Wait for the shell to take over.
      const signedIn = await pollFor(
        () =>
          browser.execute(() => ({
            hasSearch: !!document.querySelector(
              'input[aria-label="Buscar producto por nombre o código de barras..."]',
            ),
            hasHome: !!document.querySelector('nav[role="navigation"]'),
          })),
        60,
      );

      if (!signedIn) {
        lastError = "sales or home screen never appeared after login";
        continue;
      }

      await ensureSalesScreen();
      return;
    } catch (error) {
      // A form that remounted mid-interaction lands here; the next pass looks
      // at the DOM again rather than failing the spec.
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`login did not reach the sales screen: ${lastError}`);
}

/**
 * Poll `probe` until it reports a truthy state, or the budget runs out.
 * Returns whether it became truthy, so callers can retry rather than throw.
 */
async function pollFor(
  probe: () => Promise<Record<string, boolean>>,
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await probe();
    if (Object.values(state).some(Boolean)) return true;
    await browser.pause(1_000);
  }
  return false;
}

/**
 * Make sure the sales screen (with the product search input) is visible.
 *
 * After login the app lands on the Home dashboard, and the sales screen is
 * gated by an active cash shift: without one it shows ShiftRequiredOverlay.
 * This helper: Home → "Nueva venta"; if the shift overlay appears, opens a
 * cash shift through the Cash Shift page and returns to sales.
 */
export async function ensureSalesScreen(depth = 0): Promise<void> {
  if (await isVisible(SEARCH_SELECTOR)) {
    // A failed spec can leave items in the cart (e.g. it died mid-payment);
    // reset once per call chain so totals stay deterministic.
    if (depth === 0 && (await clearResidualCart())) {
      return ensureSalesScreen(1);
    }
    return;
  }

  // Shift-required overlay already blocking the sales screen?
  if (await isVisible("button*=Ir a Turno")) {
    await openCashShiftAndReturnToSales();
    await waitVisible(SEARCH_SELECTOR, 20, 1_000, "Sales search input");
    return;
  }

  const sidebarVisible = await isVisible('nav[role="navigation"]');
  if (sidebarVisible) {
    await pinSidebar();
    const ventasSelector = '//*[@role="menuitem" and contains(., "Ventas")]';
    if (await isVisible(ventasSelector)) {
      await (await $(ventasSelector)).click();
      await handleSalesGate();
      return;
    }
  }

  if (await isVisible("button*=Nueva venta")) {
    await (await $("button*=Nueva venta")).click();
    await handleSalesGate();
  }
}

/**
 * After navigating to the sales screen, wait for the search input and, if
 * the shift-required overlay blocks it, open a cash shift and retry.
 */
async function handleSalesGate(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isVisible(SEARCH_SELECTOR)) {
      return;
    }
    if (await isVisible("button*=Ir a Turno")) {
      await openCashShiftAndReturnToSales();
      await waitVisible(SEARCH_SELECTOR, 20, 1_000, "Sales search input");
      return;
    }
    await browser.pause(1_000);
  }
  throw new Error("Neither the sales screen nor the shift overlay appeared");
}

/**
 * From the ShiftRequiredOverlay, open a cash shift via the Cash Shift page
 * and navigate back to the sales screen through the pinned sidebar.
 */
async function openCashShiftAndReturnToSales(): Promise<void> {
  const goToShift = await $("button*=Ir a Turno");
  await goToShift.click();

  // Cash Shift page with the open-shift form (no active shift yet). The
  // submit button is disabled until a non-empty opening balance is set.
  // These waits keep a >=20s budget (cold PGlite write + re-render).
  await waitVisible("#opening-balance", 20, 1_000, "Opening balance input");
  const balanceInput = await $("#opening-balance");
  await balanceInput.setValue("0");

  await waitEnabled("button*=Abrir turno", 20, 1_000, "Open shift button");
  await (await $("button*=Abrir turno")).click();

  // Return to sales through the pinned sidebar (no hover dependency).
  await pinSidebar();
  const sidebar = await $('nav[role="navigation"]');
  await sidebar.moveTo().catch(() => undefined);
  await (
    await $('//*[@role="menuitem" and contains(., "Ventas")]')
  )
    .click()
    .catch(() => undefined);

  // The real gate: the sales search input appears only after the shift
  // write lands and the sales screen re-renders. Poll it at 1s granularity
  // (checks are ms) instead of a blind 60s pause; if the shift failed, the
  // ShiftRequiredOverlay keeps blocking the sales screen and this throws.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isVisible(SEARCH_SELECTOR)) {
      return;
    }
    await browser.pause(1_000);
  }
  throw new Error(
    "Sales search input never appeared after opening the cash shift",
  );
}

/** Search for a product and click its result card to add it to the cart. */
export async function addProductToCart(
  query: string,
  productName: string,
): Promise<void> {
  await setInputValue(SEARCH_SELECTOR, query, "product search");

  // The result card renders with role="option" inside a role="listbox".
  const resultSelector = `//*[@role="option" or @role="listbox"]//*[contains(text(), "${productName}")]`;
  await waitVisible(
    resultSelector,
    20,
    1_000,
    `Search result for ${productName}`,
  );

  const result = await $(resultSelector);
  await result.click();

  // The cart panel (a table of rows) shows the added item.
  const cartItemSelector = `//tr[.//p[contains(text(), "${productName}")]]`;
  await waitVisible(
    cartItemSelector,
    20,
    1_000,
    `Cart item for ${productName}`,
  );
}

/** Click COBRAR and wait for the payment screen. */
export async function goToPayment(): Promise<void> {
  await waitVisible("button*=COBRAR", 15, 1_000, "COBRAR button");
  await (await $("button*=COBRAR")).click();

  await waitVisible(
    '[data-testid="payment-total-due"]',
    15,
    1_000,
    "Payment total",
  );
}

/**
 * Fill the cash "Recibido" amount. The change panel updates live, so specs
 * that need to assert the change value call this before confirming.
 */
export async function setCashReceived(
  cashReceivedPesos: string,
): Promise<void> {
  await waitVisible(
    'input[aria-label="Recibido"]',
    15,
    1_000,
    "Cash received input",
  );
  const received = await $('input[aria-label="Recibido"]');
  await received.setValue(cashReceivedPesos);
}

/**
 * Pay with cash: fill the "Recibido" amount and confirm.
 * The default first row resolves to the DB cash method automatically.
 */
export async function payWithCash(cashReceivedPesos: string): Promise<void> {
  await setCashReceived(cashReceivedPesos);

  await waitEnabled(
    "button*=Confirmar pago",
    15,
    1_000,
    "Confirm payment button",
  );
  await (await $("button*=Confirmar pago")).click();
}

/** Wait for the receipt screen ("Pago confirmado") and start a new sale. */
export async function waitForReceiptAndNewSale(): Promise<void> {
  await waitVisible(
    '//*[contains(text(), "Pago confirmado")]',
    15,
    1_000,
    "Receipt title",
  );

  await waitVisible("button*=Nueva venta", 15, 1_000, "New sale button");
  await (await $("button*=Nueva venta")).click();

  await waitVisible(SEARCH_SELECTOR, 15, 1_000, "Sales search input");
}

/**
 * Parse a Colombian peso amount out of display text.
 *
 * Handles "$1.234.567,89" (dot thousands, comma decimals), "$1234.56",
 * "$ 595" and bare digits. The specs must not assume a particular rendering:
 * the point of these tests is to catch money bugs, and a hardcoded expectation
 * would fail on formatting instead of on arithmetic.
 */
export function parsePesos(text: string): number {
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (cleaned === "") {
    throw new Error(`No numeric amount in "${text}"`);
  }

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal point.
    const decimalAt = Math.max(lastDot, lastComma);
    const thousands = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
    const decimals = cleaned.slice(decimalAt + 1);
    normalized = `${thousands}.${decimals}`;
  } else if (lastComma >= 0) {
    const decimals = cleaned.slice(lastComma + 1);
    normalized =
      decimals.length === 3
        ? cleaned.replace(/,/g, "")
        : cleaned.replace(",", ".");
  } else if (lastDot >= 0) {
    const decimals = cleaned.slice(lastDot + 1);
    normalized =
      decimals.length === 3
        ? cleaned.replace(/\./g, "")
        : cleaned.replace(".", ".");
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (Number.isNaN(value)) {
    throw new Error(`Could not parse "${text}" as a peso amount`);
  }
  return value;
}

/**
 * Read the amount the payment screen says is due, in pesos.
 *
 * Paying exactly what the screen claims is deliberate: it turns the cash
 * tender into a cross-check. If the screen and the server disagree, the
 * confirmation either fails (overpay/underpay) or the sale lands with a
 * different total than the cashier was shown — and the specs assert the
 * server total equals this number.
 */
export async function readPaymentTotalDue(): Promise<number> {
  await waitVisible(
    '[data-testid="payment-total-due"]',
    15,
    1_000,
    "Payment total due",
  );
  const total = await $('[data-testid="payment-total-due"]');
  return parsePesos(await total.getText());
}

/**
 * Type into a field, tolerating a remount between locating and filling it.
 *
 * `waitVisible` checks visibility through `browser.execute`, i.e. JS
 * `querySelector`. The interaction then goes through WebDriver `findElement`,
 * and the two can disagree: the login form is re-mounted while the boot
 * services finish, so a field that was verified a moment ago can be gone by
 * the time `$()` runs. Waiting for existence at the DRIVER level (which retries
 * findElement) and retrying the write closes that gap.
 */
export async function setInputValue(
  selector: string,
  value: string,
  label = "input",
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const field = await $(selector);
    try {
      await field.waitForExist({ timeout: 10_000 });
      await field.setValue(value);
      return;
    } catch (error) {
      lastError = error;
      await browser.pause(500);
    }
  }

  throw new Error(
    `could not fill ${label} (${selector}): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Click an element, tolerating a remount between locating and clicking it. */
export async function clickWhenPresent(
  selector: string,
  label = "element",
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const target = await $(selector);
      await target.waitForExist({ timeout: 10_000 });
      await target.click();
      return;
    } catch (error) {
      lastError = error;
      await browser.pause(500);
    }
  }

  throw new Error(
    `could not click ${label} (${selector}): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/** Assert an actual amount equals the expected one to the cent. */
export function expectPesos(
  actual: number,
  expected: number,
  label: string,
): void {
  if (Math.abs(actual - expected) > 0.005) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

/** Expand the sidebar (pinned) and click "Devoluciones". */
export async function openReturns(): Promise<void> {
  await pinSidebar();

  const returnsSelector =
    '//*[@role="menuitem" and contains(., "Devoluciones")]';
  await waitVisible(returnsSelector, 15, 1_000, "Returns menu item");
  await (await $(returnsSelector)).click();
}

/** Trimmed text of the first match, or "" when absent. */
async function getText(selector: string): Promise<string> {
  try {
    return (await $(selector).getText()).trim();
  } catch {
    return "";
  }
}

/**
 * Assert the shared operation toast appears after a return submission.
 *
 * The toast is only set once the local create and confirm both succeed, so a
 * submission that fails surfaces as the page's `role="alert"` instead. Reporting
 * that text turns "the toast never showed up" into the actual cause.
 */
export async function expectReturnToast(): Promise<void> {
  const TOAST = '[role="status"][class*="pos-toast"]';
  const SUBMIT_ERROR = '[role="alert"]';

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await isVisible(TOAST)) return;

    if (await isVisible(SUBMIT_ERROR)) {
      throw new Error(
        `return submission was rejected: ${await getText(SUBMIT_ERROR)}`,
      );
    }
    await browser.pause(500);
  }
  throw new Error(`Operation toast never appeared (selector: ${TOAST})`);
}
