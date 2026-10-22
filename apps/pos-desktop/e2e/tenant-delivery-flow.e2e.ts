/**
 * E2E: Tenant delivery policy (domicilios).
 *
 * `workflow.delivery` is the only block of the tenant configuration the POS
 * actually ENFORCES at runtime: `SalesPosService.validateDeliveryAgainstPolicy`
 * reads it on every sale and refuses the sale when the policy is broken, and
 * the configuration screen's own dialog enforces the same rules before the
 * draft is even saved. It had ZERO e2e coverage — not one spec in the suite
 * mentioned "delivery" — even though Configuración → Domicilios offers ten
 * controls for it.
 *
 * What these specs prove:
 *
 *   - the cart offers the domicilio control only while the policy is on;
 *   - each requirement of the policy blocks the CASHIER at the counter, not
 *     just the server afterwards;
 *   - a sale that satisfies the policy stores the domicilio — address, contact
 *     and fee — in BOTH databases, and the fee is part of the amount due.
 *
 * Roles: one role for the whole file. `PUT /tenant-config` is OWNER-only, and
 * `SalesPosService.create()` requires CASHIER or ADMIN — but the role
 * supersession table admits OWNER for both (`auth.service.ts:452`), so the
 * specs never switch users. Switching roles mid-suite also proved to be the
 * flakiest thing in the harness: the QuickSwitch trigger is in the top bar,
 * and clicking it from a screen whose content had scrolled failed with
 * "element not interactable".
 *
 * Ordering inside the policy: the amounts are only editable in FIXED and
 * MANUAL mode, and FIXED cannot be selected until the amount is greater than
 * zero (both the tab and the server refuse it otherwise). So the amounts are
 * set in MANUAL mode and the mode is selected afterwards.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  addProductToCart,
  currentUserName,
  ensureSalesScreen,
  expectConfigSection,
  expectPesos,
  goToPayment,
  isVisible,
  openConfigTab,
  openScreen,
  payWithCash,
  readPaymentTotalDue,
  readSwitch,
  readText,
  resetCartAndEnsureSalesScreen,
  resetForSpec,
  setInputValue,
  signInAs,
  waitEnabled,
  waitForReceiptAndNewSale,
  waitStaysDisabled,
  waitVisible,
  type SuiteAccount,
} from "./helpers";
import {
  fetchLatestLocalNumber,
  fetchServerSaleDelivery,
  fetchServerTenantConfig,
  waitForNewServerSale,
  waitForTenantConfigDelivery,
} from "./server-state";
import {
  forceTenantConfigSync,
  putServerTenantConfig,
} from "./tenant-config-harness";
import {
  fetchLocalClients,
  fetchLocalSaleDelivery,
  fetchLocalSales,
} from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const ACETAMINOFEN = "Acetaminofén 500mg";

/** 500.00 + 19% IVA — the product total, as seeded by the server fixture. */
const ACETAMINOFEN_TOTAL = 595;

/** What the tenant charges for every domicilio, in pesos. */
const FIXED_FEE_PESOS = 3000;
const FIXED_FEE_CENTS = FIXED_FEE_PESOS * 100;

/** The ceiling the cashier may charge in MANUAL mode, in pesos. */
const MAX_FEE_PESOS = 5000;

const DELIVERY_ADDRESS = "Calle 45 # 12-30, barriocentro";

/** The fixture's shared client (`baseline.ts`), used to satisfy a client policy. */
const CLIENT_IDENTIFICATION = "900123456-7";
const CLIENT_NAME = "Cliente de Prueba E2E";

/** The cart's domicilio control. Absent while the policy is off. */
const DELIVERY_TOGGLE = 'button[data-nav-zone="delivery"][role="switch"]';

/** The cart's domicilio summary, which REPLACES the toggle once a draft exists. */
const DELIVERY_SUMMARY = 'button[aria-label="Quitar domicilio"]';

/** The dialog's fields, addressed by their visible label. */
const ADDRESS_INPUT =
  '//label[contains(normalize-space(.), "Dirección")]/following-sibling::input';
const PHONE_INPUT =
  '//label[contains(normalize-space(.), "Teléfono de contacto")]/following-sibling::input';
const DIALOG_FEE_INPUT =
  '//label[contains(normalize-space(.), "Valor del domicilio")]/following-sibling::div//input';
const CONFIRM_DIALOG = '//button[normalize-space(.)="Confirmar domicilio"]';

/** DOM id of each delivery switch → the tenant-config key it writes. */
const DELIVERY_SWITCH_KEYS: Record<string, string> = {
  "delivery-enabled": "enabled",
  "delivery-requires-client": "requiresClient",
  "delivery-address-required": "addressRequired",
  "delivery-phone-required": "phoneRequired",
};

/** The policy a spec wants the tenant to be running. */
interface DeliveryPolicy {
  enabled?: boolean;
  requiresClient?: boolean;
  addressRequired?: boolean;
  phoneRequired?: boolean;
  deliveryFeeMode?: "DISABLED" | "FIXED" | "MANUAL";
  /** Reference fee, in pesos. */
  fixedFeePesos?: number;
  /** Cap the cashier may charge, in pesos. */
  maxFeePesos?: number;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Make sure the session belongs to the owner.
 *
 * The whole file runs as OWNER, so this is a no-op after the first spec — and
 * skipping it avoids the cart reset and the navigation that `signInAs` does
 * when the session already matches.
 */
async function ensureOwner(): Promise<void> {
  if ((await currentUserName()).includes(OWNER.displayName)) return;
  await signInAs(OWNER);
}

/** Open Configuración on the Domicilios tab. */
async function openDeliveryTab(): Promise<void> {
  await openScreen("Configuración");
  await waitVisible(
    '//nav[@aria-label="Empresa"]',
    30,
    1_000,
    "config tab nav",
  );
  await openConfigTab("Domicilios");
  await expectConfigSection("Activo");
}

/**
 * Wait until a switch shows the wanted state.
 *
 * The switch only flips when the PUT resolves and the POS store is updated,
 * so the DOM is the signal that the POS is ready for the NEXT change: the
 * config page sends the version it read, and two changes fired back to back
 * race into a conflict the server rejects.
 */
async function waitForSwitchState(
  domId: string,
  desired: boolean,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if ((await readSwitch(domId)) === desired) return;
    await browser.pause(500);
  }
  throw new Error(`delivery switch #${domId} never reached ${desired}`);
}

/**
 * Drive one delivery switch and wait until the server has stored it.
 *
 * A switch already showing the wanted value is left alone: the server is the
 * source of truth and the tab renders the stored policy, so there is nothing
 * to write and nothing to wait for.
 */
async function setDeliverySwitch(
  domId: string,
  desired: boolean,
): Promise<void> {
  const selector = `button#${domId}[role="switch"]`;
  await waitVisible(selector, 20, 1_000, `delivery switch #${domId}`);
  if ((await readSwitch(domId)) === desired) return;

  await (await $(selector)).click();
  await waitForSwitchState(domId, desired);
  await waitForTenantConfigDelivery({ [DELIVERY_SWITCH_KEYS[domId]]: desired });
}

/**
 * Select one of the three fee modes.
 *
 * The radio itself is `sr-only`, so the LABEL that wraps it is clicked — that
 * is also what the cashier clicks.
 */
async function setDeliveryFeeMode(
  mode: "DISABLED" | "FIXED" | "MANUAL",
): Promise<void> {
  const label = `//label[.//input[@name="delivery-fee-mode" and @value="${mode}"]]`;
  await waitVisible(label, 20, 1_000, `delivery fee mode ${mode}`);

  const target = await $(label);
  await target.scrollIntoView({ block: "center", inline: "center" });
  await target.click();

  await waitForTenantConfigDelivery({ deliveryFeeMode: mode });
}

/**
 * Type a peso amount into one of the tab's money fields.
 *
 * The field stores CENTS but renders the amount FORMATTED ("3000" is typed
 * and "3.000" is shown), so the value is written through the native setter
 * and then waited for on the FORMATTED string. `setInputValue` cannot be used
 * here: it verifies the field against the raw string it wrote, and the
 * component re-formats it on every keystroke.
 */
async function setDeliveryMoney(
  selector: string,
  pesos: number,
): Promise<void> {
  await waitVisible(selector, 20, 1_000, `delivery money field ${selector}`);
  const field = await $(selector);
  await field.scrollIntoView({ block: "center", inline: "center" });

  await browser.execute(
    (sel: string, digits: string) => {
      const el = document.querySelector<HTMLInputElement>(sel);
      if (!el) throw new Error(`no ${sel} in the configuration tab`);
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(el, digits);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    String(pesos),
  );

  const expected = pesos.toLocaleString("es-CO");
  const deadline = Date.now() + 30_000;
  let last = "";
  while (Date.now() < deadline) {
    last = await field.getValue();
    if (last === expected) return;
    await browser.pause(500);
  }
  throw new Error(
    `delivery money field ${selector} never showed ${expected} (last: ${last})`,
  );
}

/**
 * Write a whole delivery policy through the configuration screen.
 *
 * Every control writes through immediately (there is no save button) and
 * every write carries the version the tab read, so each change waits for
 * the server before the next one is fired.
 */
async function applyDeliveryPolicy(policy: DeliveryPolicy): Promise<void> {
  await ensureOwner();
  await openDeliveryTab();

  // The master switch first: every other control only renders while the
  // feature is on.
  if (policy.enabled !== undefined) {
    await setDeliverySwitch("delivery-enabled", policy.enabled);
  }
  if (policy.enabled === false) return;

  if (policy.requiresClient !== undefined) {
    await setDeliverySwitch("delivery-requires-client", policy.requiresClient);
  }
  if (policy.addressRequired !== undefined) {
    await setDeliverySwitch(
      "delivery-address-required",
      policy.addressRequired,
    );
  }
  if (policy.phoneRequired !== undefined) {
    await setDeliverySwitch("delivery-phone-required", policy.phoneRequired);
  }

  const needsAmounts =
    policy.fixedFeePesos !== undefined || policy.maxFeePesos !== undefined;

  if (needsAmounts) {
    // MANUAL is the only mode that exposes both amounts without a fee
    // already set, so the amounts are written there.
    await setDeliveryFeeMode("MANUAL");
    // The reference fee is cleared first: the MANUAL cap cannot be lower than
    // the reference, so writing a reference below the current cap is refused.
    await setDeliveryMoney("#delivery-fixed-fee", 0);
    if (policy.maxFeePesos !== undefined) {
      await setDeliveryMoney("#delivery-max-fee", policy.maxFeePesos);
    }
    if (policy.fixedFeePesos !== undefined) {
      await setDeliveryMoney("#delivery-fixed-fee", policy.fixedFeePesos);
    }
  }

  if (policy.deliveryFeeMode !== undefined) {
    await setDeliveryFeeMode(policy.deliveryFeeMode);
  }
}

/** Put the tenant back on a policy that offers no domicilio at all. */
async function disableDelivery(): Promise<void> {
  await applyDeliveryPolicy({ enabled: false });
}

// ---------------------------------------------------------------------------
// Cart helpers
// ---------------------------------------------------------------------------

/** Assert a control stays absent for the whole budget. */
async function waitStaysAbsent(
  selector: string,
  attempts = 5,
  pauseMs = 1_000,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isVisible(selector)) {
      throw new Error(`${selector} is visible but must stay absent`);
    }
    await browser.pause(pauseMs);
  }
}

/**
 * Wait until the fixture client is in the POS's local mirror.
 *
 * The client picker only searches the LOCAL catalogue, so a client that has
 * not been pulled yet cannot be selected.
 */
async function waitForFixtureClientInMirror(): Promise<void> {
  const deadline = Date.now() + 120_000;
  let seen = "no client yet";

  while (Date.now() < deadline) {
    const clients = await fetchLocalClients();
    const found = clients.find(
      (client) => client.identificationNumber === CLIENT_IDENTIFICATION,
    );
    if (found) return;
    seen = clients.length
      ? clients.map((client) => client.identificationNumber).join(", ")
      : "no client in the mirror yet";
    await browser.pause(2_000);
  }

  throw new Error(
    `the client ${CLIENT_IDENTIFICATION} never reached the local mirror ` +
      `(clients seen: ${seen})`,
  );
}

/**
 * Select the fixture client in the cart.
 *
 * The selector lives in the CART panel, so it has to be used before moving
 * on to the payment screen.
 */
async function selectFixtureClient(): Promise<void> {
  await waitForFixtureClientInMirror();

  const prompt =
    '//button[contains(., "Cliente") and not(ancestor-or-self::*[@role="menuitem"])]';
  await waitVisible(prompt, 20, 1_000, "client selector prompt");
  await (await $(prompt)).click();

  const search = 'input[aria-label="Buscar cliente por nombre o documento..."]';
  await waitVisible(search, 20, 1_000, "client search input");
  await setInputValue(search, CLIENT_IDENTIFICATION, "client search");

  const option = `//*[@role="option"][contains(., "${CLIENT_NAME}")]`;
  await waitVisible(option, 20, 500, "client search result");
  await (await $(option)).click();
}

/**
 * Put the cart in the state the spec expects: one product, no client, no
 * domicilio.
 *
 * The leftovers matter more than they look:
 *
 *   - a SELECTED client is rendered as a chip instead of the prompt, and the
 *     delivery dialog PREFILLS the address from it — so a leftover client
 *     makes the "the address is required" refusal unreachable;
 *   - a delivery DRAFT is rendered as a summary that REPLACES the toggle the
 *     specs address, and removing a cart line does not drop it (only
 *     `clearCart` does, and the specs clear the cart through the UI).
 */
async function prepareCart(): Promise<void> {
  await resetCartAndEnsureSalesScreen();
  await addProductToCart("acetaminofén", ACETAMINOFEN);

  const clientChip = 'button[aria-label="Quitar cliente"]';
  if (await isVisible(clientChip)) {
    await (await $(clientChip)).click();
    await browser.pause(500);
  }

  if (await isVisible(DELIVERY_SUMMARY)) {
    await (await $(DELIVERY_SUMMARY)).click();
    await browser.pause(500);
  }
}

/**
 * Assert the delivery dialog shows a validation message.
 *
 * Scoped to the dialog: the cart panel has alerts of its own, and the dialog
 * is portalled to the end of the body, so a global `[role="alert"]` read can
 * land on the wrong one.
 */
async function expectDialogAlert(expected: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let last = "";

  while (Date.now() < deadline) {
    last = await readText('//div[@role="dialog"]//p[@role="alert"]');
    if (last.includes(expected)) return;
    await browser.pause(500);
  }

  throw new Error(
    `the delivery dialog never showed "${expected}" (last alert: ${last})`,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("Tenant delivery policy (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-DV01: the cart offers the domicilio only while the policy is on", async () => {
    await applyDeliveryPolicy({ enabled: false });

    await prepareCart();
    await waitStaysAbsent(DELIVERY_TOGGLE, 5, 1_000);

    await applyDeliveryPolicy({ enabled: true });

    await prepareCart();
    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");

    await disableDelivery();
  });

  it("E2E-DV02: with a client required, the domicilio stays locked until one is selected", async () => {
    await applyDeliveryPolicy({ enabled: true, requiresClient: true });

    await prepareCart();

    // The control is rendered but disabled: the policy says a domicilio is a
    // sale for a client, and no client is selected yet.
    await waitStaysDisabled(DELIVERY_TOGGLE, 5, 1_000, "delivery toggle");
    await waitVisible(
      "#delivery-client-hint",
      20,
      1_000,
      "delivery client hint",
    );

    // With a client selected the same policy stops blocking the cashier.
    await selectFixtureClient();
    await waitEnabled(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");

    await disableDelivery();
  });

  it("E2E-DV03: with the address required, the dialog refuses an empty address", async () => {
    await applyDeliveryPolicy({
      enabled: true,
      requiresClient: false,
      addressRequired: true,
      phoneRequired: false,
    });

    await prepareCart();

    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");
    await (await $(DELIVERY_TOGGLE)).click();
    await waitVisible(CONFIRM_DIALOG, 20, 1_000, "delivery dialog");

    await (await $(CONFIRM_DIALOG)).click();
    await expectDialogAlert("La dirección de entrega es obligatoria.");

    // The refused draft did not reach the cart.
    await waitStaysAbsent(DELIVERY_SUMMARY, 3, 1_000);

    // With an address it does.
    await setInputValue(ADDRESS_INPUT, DELIVERY_ADDRESS, "delivery address");
    await (await $(CONFIRM_DIALOG)).click();
    await waitVisible(
      DELIVERY_SUMMARY,
      20,
      1_000,
      "delivery summary in the cart",
    );

    await disableDelivery();
  });

  it("E2E-DV04: with the phone required, the dialog refuses an empty phone", async () => {
    await applyDeliveryPolicy({
      enabled: true,
      requiresClient: false,
      addressRequired: false,
      phoneRequired: true,
    });

    await prepareCart();

    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");
    await (await $(DELIVERY_TOGGLE)).click();
    await waitVisible(CONFIRM_DIALOG, 20, 1_000, "delivery dialog");

    await (await $(CONFIRM_DIALOG)).click();
    await expectDialogAlert("El teléfono de contacto es obligatorio.");

    await setInputValue(PHONE_INPUT, "3001234567", "delivery phone");
    await (await $(CONFIRM_DIALOG)).click();
    await waitVisible(
      DELIVERY_SUMMARY,
      20,
      1_000,
      "delivery summary in the cart",
    );

    await disableDelivery();
  });

  it("E2E-DV05: in manual mode the dialog refuses a fee above the tenant's cap", async () => {
    await applyDeliveryPolicy({
      enabled: true,
      requiresClient: false,
      addressRequired: false,
      phoneRequired: false,
      fixedFeePesos: FIXED_FEE_PESOS,
      maxFeePesos: MAX_FEE_PESOS,
      deliveryFeeMode: "MANUAL",
    });

    await prepareCart();

    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");
    await (await $(DELIVERY_TOGGLE)).click();
    await waitVisible(CONFIRM_DIALOG, 20, 1_000, "delivery dialog");

    // The fee is the cashier's to type, and the cap is the tenant's.
    await setInputValue(DIALOG_FEE_INPUT, "6000", "delivery fee");
    await (await $(CONFIRM_DIALOG)).click();
    await expectDialogAlert("El valor del domicilio no puede superar");

    // A fee under the cap is accepted.
    await setInputValue(DIALOG_FEE_INPUT, "4000", "delivery fee");
    await (await $(CONFIRM_DIALOG)).click();
    await waitVisible(
      DELIVERY_SUMMARY,
      20,
      1_000,
      "delivery summary in the cart",
    );

    await disableDelivery();
  });

  it("E2E-DV06: a sale under the fixed fee stores the domicilio in both databases", async () => {
    await applyDeliveryPolicy({
      enabled: true,
      requiresClient: false,
      addressRequired: true,
      phoneRequired: false,
      fixedFeePesos: FIXED_FEE_PESOS,
      maxFeePesos: MAX_FEE_PESOS,
      deliveryFeeMode: "FIXED",
    });

    const baseline = await fetchLatestLocalNumber();

    await prepareCart();

    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");
    await (await $(DELIVERY_TOGGLE)).click();
    await waitVisible(CONFIRM_DIALOG, 20, 1_000, "delivery dialog");

    // The fee is not typed: the policy charges its own fixed amount.
    await setInputValue(ADDRESS_INPUT, DELIVERY_ADDRESS, "delivery address");
    await (await $(CONFIRM_DIALOG)).click();
    await waitVisible(
      DELIVERY_SUMMARY,
      20,
      1_000,
      "delivery summary in the cart",
    );

    await goToPayment();

    // The fee is part of what the customer owes.
    const totalDue = await readPaymentTotalDue();
    expectPesos(totalDue, ACETAMINOFEN_TOTAL + FIXED_FEE_PESOS, "total due");

    await payWithCash(String(totalDue));
    await waitForReceiptAndNewSale();

    // ---- Server side: the sale and the domicilio it carries -------------
    const sale = await waitForNewServerSale(baseline);
    expect(sale.operationalState).toBe("CONFIRMED");
    // The sale's own total is the product total: the delivery fee is charged
    // on top of it, not folded into it.
    expectPesos(sale.totalAmount, ACETAMINOFEN_TOTAL, "server sale total");
    expect(sale.payments).toHaveLength(1);
    expectPesos(
      sale.payments[0].amount,
      ACETAMINOFEN_TOTAL + FIXED_FEE_PESOS,
      "server payment amount",
    );

    const serverDelivery = await fetchServerSaleDelivery(sale.localNumber);
    if (!serverDelivery) {
      throw new Error(
        `the server stored no domicilio on sale ${sale.localNumber}`,
      );
    }
    expect(serverDelivery.state).toBe("PENDING");
    expect(serverDelivery.address).toBe(DELIVERY_ADDRESS);
    expect(serverDelivery.feeCents).toBe(FIXED_FEE_CENTS);

    // ---- Local mirror: the POS's own copy of the same domicilio ---------
    const localDelivery = await fetchLocalSaleDelivery(sale.localNumber);
    if (!localDelivery) {
      throw new Error(
        `the POS stored no domicilio on sale ${sale.localNumber}`,
      );
    }
    expect(localDelivery.state).toBe(serverDelivery.state);
    expect(localDelivery.address).toBe(serverDelivery.address);
    expect(localDelivery.feeCents).toBe(serverDelivery.feeCents);

    await disableDelivery();
  });

  it("E2E-DV07: a policy tightened under a built sale makes the service refuse it, and nothing is written", async () => {
    // A permissive policy: the domicilio can be attached without a client.
    await applyDeliveryPolicy({
      enabled: true,
      requiresClient: false,
      addressRequired: false,
      phoneRequired: false,
    });

    await prepareCart();

    await waitVisible(DELIVERY_TOGGLE, 20, 1_000, "delivery toggle");
    await (await $(DELIVERY_TOGGLE)).click();
    await waitVisible(CONFIRM_DIALOG, 20, 1_000, "delivery dialog");
    await (await $(CONFIRM_DIALOG)).click();
    await waitVisible(
      DELIVERY_SUMMARY,
      20,
      1_000,
      "delivery summary in the cart",
    );

    // Now the tenant tightens the policy behind the POS's back — the case the
    // dialog can never catch, because the domicilio was already attached.
    const current = await fetchServerTenantConfig();
    const workflow = (current?.workflow ?? {}) as Record<string, unknown>;
    const delivery = (workflow.delivery ?? {}) as Record<string, unknown>;
    const write = await putServerTenantConfig(
      {
        workflow: {
          ...workflow,
          delivery: { ...delivery, requiresClient: true },
        },
      },
      OWNER,
    );
    expect(write.status).toBe(200);

    const after = await fetchServerTenantConfig();
    await forceTenantConfigSync({ configVersion: after?.configVersion });

    // Back to the counter with the cart intact: the sync moved the app to the
    // sync screen, and the cart must NOT be rebuilt — the domicilio attached
    // under the permissive policy is the whole point.
    await ensureSalesScreen();

    const localSalesBefore = (await fetchLocalSales()).length;
    const serverBaseline = await fetchLatestLocalNumber();

    // The sale is refused by the SERVICE, at checkout time.
    await waitVisible("button*=COBRAR", 20, 1_000, "COBRAR button");
    await (await $("button*=COBRAR")).click();

    const alert = '//section[@data-nav-zone="cart"]//div[@role="alert"]';
    await waitVisible(alert, 20, 1_000, "cart error banner");
    const message = await readText(alert);
    expect(message).toContain(
      "A client must be selected to attach a domicilio to this sale.",
    );

    // And nothing was written: the policy is checked BEFORE the sale row is
    // created, so neither store has a sale of it.
    expect((await fetchLocalSales()).length).toBe(localSalesBefore);
    expect(await fetchLatestLocalNumber()).toBe(serverBaseline);

    await disableDelivery();
  });
});
