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

      // Fall back to the keyboard instead of retrying the same failing call.
      //
      // `setValue` clears before typing, and `elementClear` intermittently
      // fails with "element not interactable" on inputs that are re-rendering.
      // A failed clear still moves focus, which is fatal for the cart's inline
      // editors: their `onBlur` commits, so the editor unmounts and the retry
      // then finds nothing. Focusing and typing never touches the clear step.
      if (attempt === 0 && (await typeOverFocused(selector, value))) return;

      await browser.pause(500);
    }
  }

  throw new Error(
    `could not fill ${label} (${selector}): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Focus a field, select whatever it holds and type over it.
 *
 * Returns false when the element cannot be found or focused, so the caller can
 * keep its own retry/timeout policy rather than inheriting a second one.
 */
async function typeOverFocused(
  selector: string,
  value: string,
): Promise<boolean> {
  const focused = await browser.execute((sel: string) => {
    const el =
      sel.startsWith("//") || sel.startsWith("(")
        ? (document.evaluate(
            sel,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          ).singleNodeValue as HTMLElement | null)
        : document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  }, selector);

  if (!focused) return false;

  // Select-all then type, which replaces the field's current contents the same
  // way a user would. Done with keys rather than the DOM's `select()` because
  // that throws on `input[type=number]`, which is what the cart editors are.
  await browser.keys(["Control", "a"]);
  await browser.keys(value);
  return true;
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

    const error = await readText(SUBMIT_ERROR);
    if (error !== "") {
      throw new Error(`return submission was rejected: ${error}`);
    }
    await browser.pause(500);
  }
  throw new Error(`Operation toast never appeared (selector: ${TOAST})`);
}

/**
 * Press Enter on a field, focusing it explicitly first.
 *
 * Two things make the obvious `browser.keys("Enter")` unreliable here:
 *
 *   - WebDriver's element `sendKeys` does not guarantee the element holds DOM
 *     focus, and `browser.keys` sends to whatever `document.activeElement` is.
 *     When that is `<body>` the key goes nowhere and the commit silently never
 *     happens. Focusing the target by selector removes the ambiguity.
 *   - These inputs are React-controlled and their `onKeyDown` reads the state
 *     variable, not the DOM value, so the key must not land in the same tick as
 *     the last keystroke — otherwise it submits a stale (empty) value, which on
 *     the QuickSwitch password panel looks exactly like valid credentials being
 *     rejected.
 *
 * @param selector The field to commit. Omit to press Enter wherever focus is.
 */
export async function pressEnter(selector?: string): Promise<void> {
  if (selector) {
    await browser.execute((sel: string) => {
      const el =
        sel.startsWith("//") || sel.startsWith("(")
          ? (document.evaluate(
              sel,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null,
            ).singleNodeValue as HTMLElement | null)
          : document.querySelector<HTMLElement>(sel);
      el?.focus();
    }, selector);
  }
  await browser.pause(300);
  await browser.keys("Enter");
}

/**
 * Pick an option from a `SearchableSelect` combobox by typing then pressing Enter.
 *
 * The component offers two ways to choose, and only one of them is reliable from
 * a driver:
 *
 *   - Clicking the `<li>` is bound to `onMouseDown`, and the listbox is
 *     portalled to `document.body` with a `mousedown` document listener that
 *     closes it on any click outside the portal. A driver click on the option
 *     races that listener, and the observable symptom is a silently ignored
 *     selection — which downstream looks like "the next field stayed disabled".
 *   - The keyboard path is not racy: typing narrows the list, and
 *     `handleKeyDown` selects the single remaining option on Enter.
 *
 * So the label is typed (which also proves the filter matches it) and the
 * selection is committed with Enter.
 *
 * @param inputSelector  The combobox's `input`, addressed by aria-label or placeholder.
 * @param optionLabel    The exact visible label of the option to choose.
 */
export async function selectSearchableOption(
  inputSelector: string,
  optionLabel: string,
  label = inputSelector,
): Promise<void> {
  await setInputValue(inputSelector, optionLabel, label);

  const option = `//li[@role="option"][.//span[normalize-space(.)="${optionLabel}"]]`;
  await waitVisible(option, 20, 500, `${optionLabel} option`);

  // The option has to be present before Enter is sent, but Enter has to reach the
  // INPUT — so the input is focused explicitly rather than relying on the click
  // having left it there.
  await browser.execute((selector: string) => {
    document.querySelector<HTMLInputElement>(selector)?.focus();
  }, inputSelector);
  await pressEnter(inputSelector);
}

// ---------------------------------------------------------------------------
// Reading element text
// ---------------------------------------------------------------------------

/**
 * Resolve a selector to its trimmed text, or "" when it is absent.
 *
 * Goes through `browser.execute` for the same reason the state helpers do: a
 * synchronous `executeScript` is not subject to the @wdio/utils 17s async
 * wrapper. Handles the same selector dialect as `elementState` — plain CSS,
 * `tag*=text` partial text and XPath.
 */
export async function readText(selector: string): Promise<string> {
  try {
    const text = await browser.execute((sel: string) => {
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
          const [, tag, needle] = textMatch;
          el =
            Array.from(document.querySelectorAll(tag)).find((node) =>
              node.textContent?.includes(needle),
            ) ?? null;
        } else {
          el = document.querySelector(sel);
        }
      }

      return el?.textContent?.trim() ?? "";
    }, selector);
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/** Poll `readText` until it is non-empty, or the budget runs out. */
export async function waitForText(
  selector: string,
  attempts: number,
  pauseMs = 1_000,
  label = "element",
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = await readText(selector);
    if (text !== "") return text;
    await browser.pause(pauseMs);
  }
  throw new Error(`${label} never produced text (selector: ${selector})`);
}

// ---------------------------------------------------------------------------
// Waiting for absence
// ---------------------------------------------------------------------------

/**
 * Poll until the selector matches nothing, or the budget runs out.
 *
 * The inverse of `waitVisible`, for the transitions these specs actually rely
 * on: a form unmounting after a successful save, a page switching view mode.
 * Asserting on the transition rather than on a fixed pause is what keeps a
 * "did the save actually happen?" check honest.
 */
export async function waitGone(
  selector: string,
  attempts: number,
  pauseMs = 500,
  label = "element",
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isVisible(selector))) return;
    await browser.pause(pauseMs);
  }
  throw new Error(`${label} never went away (selector: ${selector})`);
}

// ---------------------------------------------------------------------------
// Toast / inline alert assertions
// ---------------------------------------------------------------------------

/**
 * Assert a sileo toast carrying `expected` is on screen.
 *
 * The POS uses sileo (`renderer/utils/notify.ts`) for the success and failure
 * toasts of the clients and user-management screens, which is a DIFFERENT
 * component from the `role="status" pos-toast` the returns flow uses. Matching
 * on the shared `data-sileo-toast` attribute is what makes one helper usable
 * for both.
 *
 * `data-ready="true"` is required because sileo animates the toast in and the
 * text is present before the element is fully shown.
 */
export async function expectToast(expected: string): Promise<void> {
  const TOAST = '[data-sileo-toast][data-ready="true"]';
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const text = await readText(TOAST);
    if (text.includes(expected)) return;

    if (text !== "") {
      throw new Error(
        `a toast appeared but did not carry "${expected}": ${text}`,
      );
    }
    await browser.pause(500);
  }
  throw new Error(`no toast carrying "${expected}" appeared within 20s`);
}

/**
 * Assert an inline `role="alert"` banner carrying `expected` is on screen.
 *
 * Used for the flows with no toast at all: the purchase screens surface every
 * failure as a red banner (`reception-form.tsx`, `supplier-form.tsx`,
 * `purchase-orders.page.tsx`), and so does the cart when a checkout-level rule
 * rejects the sale.
 */
export async function expectAlert(expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const text = await readText('[role="alert"]');
    if (text.includes(expected)) return;

    if (text !== "") {
      throw new Error(
        `an alert appeared but did not carry "${expected}": ${text}`,
      );
    }
    await browser.pause(500);
  }
  throw new Error(`no alert carrying "${expected}" appeared within 15s`);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Open a screen from the pinned navigation sidebar by its visible label.
 *
 * The rail is collapsed by default, so pinning first is what makes the menu
 * items reachable at all — an unpinned click lands on the collapsed rail's
 * hidden menuitem instead. Every screen is addressed by its Spanish label
 * because that is what the sidebar's `aria-label` actually is.
 */
export async function openScreen(menuLabel: string): Promise<void> {
  await pinSidebar();
  const item = `button[role="menuitem"][aria-label="${menuLabel}"]`;
  await waitVisible(item, 20, 1_000, `Sidebar item "${menuLabel}"`);
  await (await $(item)).click();
}

/**
 * Open a sub-screen from a hub page card, addressed by the card's heading.
 *
 * The purchases and inventory hub pages are card grids whose only handle is the
 * `<h3>` title inside a `<button>`, so the heading is the anchor — matching the
 * button by partial text would also match the sub-page's own "+ Nuevo …"
 * buttons.
 */
export async function openHubCard(cardTitle: string): Promise<void> {
  const card = `//h3[normalize-space(text())="${cardTitle}"]/ancestor::button`;
  await waitVisible(card, 20, 1_000, `Hub card "${cardTitle}"`);
  await (await $(card)).click();
}

/** Assert a hub page finished loading by its page heading. */
export async function expectPageHeading(
  heading: string,
  attempts = 20,
): Promise<void> {
  await waitVisible(
    `//h1[normalize-space(text())="${heading}"]`,
    attempts,
    1_000,
    `Page heading "${heading}"`,
  );
}

// ---------------------------------------------------------------------------
// Cart pricing controls
// ---------------------------------------------------------------------------

/**
 * The cart panel's scoped root.
 *
 * Every cart control repeats across the whole screen (one discount button per
 * line, one "Eliminar" per row), so scoping to the panel is what keeps the
 * selectors unambiguous as soon as more than one line is in the cart.
 *
 * Expressed in XPath because the helpers resolve a selector with
 * `document.evaluate` whenever it starts with `//` — a CSS prefix would send
 * `cartRow`'s composite selector to `querySelector` instead, where the `//tr…`
 * tail is not valid CSS.
 */
const CART = '//section[@data-nav-zone="cart"]';

/** The `<tr>` for one cart line, addressed by the product name it renders. */
function cartRow(productName: string): string {
  return `${CART}//tr[.//p[contains(text(),"${productName}")]]`;
}

/** Read a cart totals row by its Spanish label ("Subtotal", "IVA (19%)", "TOTAL"). */
export async function readCartTotalRow(label: string): Promise<number> {
  return parsePesos(
    await readText(
      `//span[normalize-space(text())="${label}"]/following-sibling::span[1]`,
    ),
  );
}

/**
 * The grand total the cart panel shows.
 *
 * Distinct from `readPaymentTotalDue`: this is what the cashier sees BEFORE
 * charging, so a spec can prove the cart arithmetic before paying rather than
 * only reconciling after the fact.
 */
export async function readCartTotal(): Promise<number> {
  await waitVisible(
    `//span[normalize-space(text())="TOTAL"]/following-sibling::span[1]`,
    20,
    500,
    "Cart TOTAL row",
  );
  return readCartTotalRow("TOTAL");
}

/**
 * Apply a per-line discount percentage and commit it with Enter.
 *
 * The discount cell is a button (`aria-label` "Editar descuento") that swaps to
 * an `input[type=number]` with the SAME aria-label, so the edit is entered
 * through the input and the button only afterwards. Enter is required rather
 * than a blur because a blur commits too but leaves the spec racing whatever the
 * next click lands on.
 */
export async function applyCartLineDiscount(
  productName: string,
  percent: number,
): Promise<void> {
  const button = `${cartRow(productName)}//button[@aria-label="Editar descuento"]`;
  await waitVisible(button, 20, 500, `Discount button for ${productName}`);
  await (await $(button)).click();

  const input = `${cartRow(productName)}//input[@aria-label="Editar descuento"]`;
  await waitVisible(input, 20, 500, `Discount input for ${productName}`);
  await typeIntoEditor(input, String(percent), `discount for ${productName}`);
  await pressEnter(input);

  // The input unmounts on commit; that is the confirmation the percentage stuck.
  await waitGone(input, 20, 250, `Discount input for ${productName}`);
}

/** The percentage the cart line now shows ("25%" or the empty "—"). */
export async function readCartLineDiscount(
  productName: string,
): Promise<string> {
  return readText(
    `${cartRow(productName)}//button[@aria-label="Editar descuento"]`,
  );
}

/**
 * Type a new unit price for a cart line and commit it with Enter.
 *
 * Does NOT throw when the commit is refused: refusing is the point of the price
 * floor, and the caller asserts on the error that the refused commit leaves
 * behind. `setLinePriceExpectingRejection` documents that intent at the call
 * site.
 */
export async function setCartLinePrice(
  productName: string,
  pesos: string,
): Promise<void> {
  const button = `${cartRow(productName)}//button[@aria-label="Editar precio"]`;
  await waitVisible(button, 20, 500, `Price button for ${productName}`);
  await (await $(button)).click();

  const input = `${cartRow(productName)}//input[@aria-label="Editar precio"]`;
  await waitVisible(input, 20, 500, `Price input for ${productName}`);
  await typeIntoEditor(input, pesos, `price for ${productName}`);
  await pressEnter(input);
  await browser.pause(500);
}

/**
 * Type into a field that commits on blur, without using `setValue`.
 *
 * The cart's inline price and discount editors unmount the moment they lose
 * focus, and WebDriver's `setValue` is built on `elementClear`, which moves
 * focus. A clear that fails intermittently — "element not interactable" on a
 * re-rendering input — is therefore enough to make the editor commit and
 * vanish, after which the element handle can never be resolved again and the
 * failure surfaces as an unrelated "not interactable"/"not existing".
 *
 * Focusing the field directly and typing avoids the clear step altogether:
 * focus is already where it needs to be, Ctrl+A selects the pre-filled value,
 * and the keystrokes replace it.
 */
export async function typeIntoEditor(
  selector: string,
  value: string,
  label = "editor",
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await typeOverFocused(selector, value)) return;
    await browser.pause(300);
  }
  throw new Error(
    `could not type into ${label} (${selector}) — the editor is probably ` +
      `already committed`,
  );
}

/**
 * The cost-floor message the cart shows inside the price cell.
 *
 * Only rendered while the edit stays open: `commitPrice` returns early on a
 * below-cost price instead of closing, which is what makes the refusal visible.
 * Returns "" when the price was accepted.
 */
export async function readCartPriceError(productName: string): Promise<string> {
  return readText(`${cartRow(productName)}//p[@role="alert"]`);
}

/** Whether the price editor for a line is still open (i.e. still refusing). */
export async function isCartPriceEditing(
  productName: string,
): Promise<boolean> {
  return isVisible(
    `${cartRow(productName)}//input[@aria-label="Editar precio"]`,
  );
}

/**
 * Bump a cart line's quantity through its own "+" control.
 *
 * Used instead of the keyboard shortcut because the button carries an explicit
 * `aria-label`, so the spec does not depend on which element currently holds
 * keyboard focus.
 */
export async function incrementCartLineQuantity(
  productName: string,
  times: number,
): Promise<void> {
  const plus = `${cartRow(productName)}//button[@aria-label="Agregar"]`;
  for (let step = 0; step < times; step += 1) {
    await (await $(plus)).click();
    await browser.pause(250);
  }
}

// ---------------------------------------------------------------------------
// Configuration switches
// ---------------------------------------------------------------------------

/**
 * Read a configuration toggle's on/off state.
 *
 * The config tabs render their booleans as `<button role="switch" id={key}>`
 * with `aria-checked`, not as checkboxes, so this is the only way to read them.
 */
export async function readSwitch(id: string): Promise<boolean> {
  return browser.execute((switchId: string) => {
    const el = document.getElementById(switchId);
    return el?.getAttribute("aria-checked") === "true";
  }, id);
}

/**
 * Put a configuration toggle into `desired`, clicking only when it differs.
 *
 * Idempotent on purpose: several specs need a flag on, and clicking an
 * already-correct toggle would silently invert it. The config page has no undo
 * and no save button, so every click is an immediate server write.
 */
export async function setSwitch(id: string, desired: boolean): Promise<void> {
  const selector = `button#${id}[role="switch"]`;
  await waitVisible(selector, 20, 1_000, `Config switch #${id}`);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await readSwitch(id)) === desired) return;
    await (await $(selector)).click();
    await browser.pause(500);
    if ((await readSwitch(id)) === desired) return;
  }
  throw new Error(`config switch #${id} never reached ${desired}`);
}

/** Open a tab of the tenant configuration page by its visible label. */
export async function openConfigTab(label: string): Promise<void> {
  const tab = `//nav[@aria-label="Empresa"]//button[normalize-space(.)="${label}"]`;
  await waitVisible(tab, 20, 1_000, `Config tab "${label}"`);
  await (await $(tab)).click();
}

/** Assert a config tab finished mounting by its section heading. */
export async function expectConfigSection(heading: string): Promise<void> {
  await waitVisible(
    `//h3[normalize-space(.)="${heading}"]`,
    20,
    1_000,
    `Config section "${heading}"`,
  );
}

// ---------------------------------------------------------------------------
// Session identity and switching
// ---------------------------------------------------------------------------

/** The QuickSwitch trigger, which renders the signed-in user's display name. */
const QUICK_SWITCH = 'button[aria-label="Cambiar de usuario"]';

/**
 * Display name of the signed-in user, or "" when the login screen is up.
 *
 * Reading it off the QuickSwitch trigger is the only DOM-visible statement of
 * who is signed in, and it is what makes `signInAs` able to notice that the
 * session belongs to somebody else instead of silently reusing it.
 */
export async function currentUserName(): Promise<string> {
  return readText(QUICK_SWITCH);
}

/**
 * Switch the active user through the QuickSwitch component.
 *
 * This is the app's own user-switching UI, so a spec that needs a different
 * role drives the same path a cashier does rather than poking the session
 * store. It works from an ADMIN session because QuickSwitch lists the
 * available users from the local cache when `GET /users` is refused, and that
 * cache is complete: `AuthService.login` fire-and-forgets
 * `UserPullService.pullUserIdentities()` on every successful login, and
 * `GET /users/login-identities` is open to every role.
 *
 * The password panel is chosen over the PIN keypad by the component itself:
 * `handleUserSelect` defaults to a PIN only for CASHIER and MANAGER, or when
 * the server reports `hasPin`.
 */
export async function switchUser(
  displayName: string,
  password: string,
): Promise<void> {
  await waitVisible(QUICK_SWITCH, 20, 1_000, "QuickSwitch trigger");
  await (await $(QUICK_SWITCH)).click();

  const entry = `//div[contains(@class,"pos-panel")]//button[.//span[normalize-space(.)="${displayName}"]]`;
  await waitVisible(entry, 20, 1_000, `QuickSwitch entry for ${displayName}`);
  await (await $(entry)).click();

  // Wait for the panel's CONFIRM button, not just the input: the component swaps
  // the whole list panel for the password panel in one re-render, so an input that
  // merely "exists" can still be the node the previous render produced. The
  // button only exists once the password panel is mounted.
  await browser.waitUntil(
    async () =>
      (await readText(
        '//button[@aria-label="Cambiar de usuario"]/following-sibling::div//input[@type="password"]/following::button[normalize-space(.)="Cambiar"]',
      )) !== "",
    {
      timeout: 20_000,
      interval: 500,
      timeoutMsg:
        "the QuickSwitch password panel never appeared after selecting " +
        displayName,
    },
  );

  // The password panel is a following sibling of the trigger button, inside the
  // same wrapper. XPath rather than a CSS sibling combinator so the whole
  // selector is resolved by the one code path in this file that understands it.
  const passwordInput =
    '//button[@aria-label="Cambiar de usuario"]/following-sibling::div//input[@type="password"]';
  await waitVisible(passwordInput, 20, 500, "QuickSwitch password input");
  await setInputValue(passwordInput, password, "quick-switch password");
  await pressEnter(passwordInput);

  // The switch is a real login round trip: QuickSwitch calls
  // `authService.login`, swaps the session and only then closes the panel. The
  // panel shows a literal "..." while that is in flight, so the wait is bounded
  // generously and distinguishes "still authenticating" from "the server
  // rejected it" — conflating the two turns a slow switch into a false
  // credentials error.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const current = await currentUserName();
    if (current.includes(displayName)) return;

    if (!(await isQuickSwitchBusy())) {
      throw new Error(
        `switching to ${displayName} left the session as "${current}" — the ` +
          `login returned without switching. ${await describeQuickSwitchState()}`,
      );
    }
    await browser.pause(1_000);
  }
  throw new Error(
    `the session never became ${displayName} within 120s. ` +
      (await describeQuickSwitchState()),
  );
}

/**
 * Whether the QuickSwitch panel is still showing its in-flight marker.
 *
 * The confirm button renders `...` while `isLoading` is true, so its absence of
 * that literal means the login settled — successfully or not.
 */
async function isQuickSwitchBusy(): Promise<boolean> {
  return browser.execute(() =>
    (document.querySelector("div.pos-panel")?.textContent ?? "").includes(
      "...",
    ),
  );
}

/**
 * What the QuickSwitch panel is showing right now.
 *
 * A session switch that silently does nothing is otherwise indistinguishable
 * from one the server refused: both leave the trigger showing the old user. The
 * panel text and the typed password's length separate "the panel never opened",
 * "the password never landed" and "the server rejected it".
 */
async function describeQuickSwitchState(): Promise<string> {
  const state = await browser.execute(() => {
    const panel = document.querySelector("div.pos-panel");
    const password = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    return {
      panelOpen: Boolean(panel),
      panelText: (panel?.textContent ?? "").trim().slice(0, 200),
      passwordLength: password?.value.length ?? -1,
    };
  });
  return (
    `QuickSwitch panel open=${state.panelOpen} ` +
    `passwordLength=${state.passwordLength} panelText=${JSON.stringify(state.panelText)}`
  );
}

/**
 * Dismiss any modal still open from a previous spec.
 *
 * The app shares ONE WebView across the whole run, and a Radix dialog's overlay
 * is `position: fixed; inset: 0` at `z-50` — so a dialog left open by one spec
 * intercepts every click in the next one, and the failure surfaces far away as
 * "element click intercepted" on a sidebar item. Escape is the dialog's own
 * dismissal affordance, so this is the same path a user takes.
 */
export async function dismissOverlays(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const open = await browser.execute(
      () => document.querySelectorAll('[role="dialog"]').length,
    );
    if (!open) return;
    await browser.keys("Escape");
    await browser.pause(500);
  }

  const stillOpen = await browser.execute(
    () => document.querySelectorAll('[role="dialog"]').length,
  );
  if (stillOpen) {
    throw new Error(
      `${stillOpen} dialog(s) survived five Escape presses — a spec left a ` +
        `modal open, and it will intercept every later click`,
    );
  }
}

/** An account the suite signs in as, with the display name the UI renders. */
export interface SuiteAccount {
  identifier: string;
  password: string;
  displayName: string;
}

/**
 * Ensure the active session belongs to `account`, switching or logging in as needed.
 *
 * `login` alone is not enough once the suite uses more than one role: it
 * returns as soon as the sales screen is on, so a spec that "logs in" as a
 * different user would keep running as whoever signed in before — a false green
 * for every role-gated assertion in it. This helper checks the session identity
 * first and only acts when it does not match.
 */
export async function signInAs(account: SuiteAccount): Promise<void> {
  // Before anything else: a modal left open by the previous spec would swallow
  // every click below and report the failure somewhere unrelated.
  await dismissOverlays();

  const current = await currentUserName();

  if (current.includes(account.displayName)) {
    await ensureSalesScreen();
    return;
  }

  if (current !== "") {
    // A session exists for somebody else — swap it through QuickSwitch.
    await switchUser(account.displayName, account.password);
    await ensureSalesScreen();
    return;
  }

  await login(account.identifier, account.password);
  const signedIn = await currentUserName();
  if (!signedIn.includes(account.displayName)) {
    throw new Error(
      `signed in as ${account.identifier} but the session reports "${signedIn}"`,
    );
  }
}
