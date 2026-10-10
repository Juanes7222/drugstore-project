/**
 * E2E: the Ventas tab's settings are global, not per-workstation.
 *
 * ## Why this file exists
 *
 * `discountLimits` and `salesConfig` (price-override permissions, price floor,
 * store credit) were written only to the POS's local Zustand store. Nothing was
 * pushed, so:
 *
 *   - a limit set at one terminal reached no other machine, and
 *   - the next boot sync, which pulls `POS_DISCOUNT_LIMITS` / `POS_SALES_CONFIG`
 *     from the server, silently overwrote it with the server's value.
 *
 * Both blocks live in `SystemConfig`, which is keyed
 * `@@id([subscriptionId, key])` — already global per pharmacy. What was missing
 * was any write path, and the tab's own `applySalesConfigDefaults` had silently
 * dropped the store-credit fields on every read, so credit could not be turned
 * on from configuration at all.
 *
 * The specs therefore assert against the server ROW, not against the local
 * store. Asserting the store would have passed before the fix: the store always
 * held whatever the user typed.
 *
 * Ownership: `PUT /configuration/pos-settings/sales` is OWNER-only. ADMIN is
 * the platform role and is refused by every pharmacy-scoped guard in this API
 * (`/users`, `/tenant-config`), so exposing the write there would make the
 * platform operator the only actor able to set a pharmacy's discount policy.
 *
 * ## Order
 *
 * The specs run in numeric order with no ordering constraint between them: each
 * restores every pharmacy-wide value it changes, so the file leaves
 * `POS_DISCOUNT_LIMITS` / `POS_SALES_CONFIG` as it found them.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  signInAs,
  openScreen,
  openConfigTab,
  expectConfigSection,
  waitVisible,
  setInputValue,
  setSwitch,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import { fetchLocalConfig } from "./local-state";
import {
  POS_DISCOUNT_LIMITS_KEY,
  POS_SALES_CONFIG_KEY,
  fetchServerSystemConfig,
  waitForServerSystemConfig,
} from "./server-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

/** ADMIN rather than a cashier: the sales config page is not a cashier surface. */
const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

interface ServerDiscountLimits {
  cashier: { itemMaxPercent: number; globalMaxPercent: number };
  owner: { itemMaxPercent: number; globalMaxPercent: number };
}

interface ServerSalesConfig {
  creditEnabled: boolean;
  defaultCreditLimitCents: number;
  priceFloor: { enabled: boolean; type: string; minMarginPercent: number };
  priceOverridePermissions: {
    cashier: { allowed: boolean; requireReason: boolean };
  };
}

async function openVentasTab(): Promise<void> {
  await openScreen("Configuración");
  // The nav is the config page's readiness signal; it carries aria-label
  // "Empresa" whichever of the tabs is currently mounted.
  await waitVisible('//nav[@aria-label="Empresa"]', 30, 1_000, "config tab nav");
  await openConfigTab("Ventas");
  await expectConfigSection("Límites de descuento por rol");
}

/**
 * Wait for the save-failure toast.
 *
 * Asserted rather than inferred: a silent refusal would leave the server value
 * unchanged for the right reason (the write never happened) while the user
 * believed it had saved.
 */
async function waitForErrorToast(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = await browser.execute(() => {
      const toasts = Array.from(
        document.querySelectorAll('[data-sileo-toast][data-ready="true"]'),
      );
      return toasts
        .map((el) => (el.textContent ?? "").trim())
        .join(" | ");
    });
    if (text.includes("Error al guardar la configuración")) return;
    await browser.pause(500);
  }

  throw new Error(
    "the save-failure toast never appeared — the refusal may not have been " +
      "surfaced to the user at all",
  );
}

/**
 * The cashier's per-product limit field.
 *
 * Addressed by id, not by label: all four editable roles render the same
 * "Máx. por producto" label, so a label lookup is ambiguous.
 */
function cashierItemLimit(): string {
  return "#discount-cashier-item";
}

describe("Sales configuration is global (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-SC01: a discount limit set on the Ventas tab reaches the server", async () => {
    await signInAs(OWNER);
    await openVentasTab();

    const cashierItem = cashierItemLimit();
    const cashierGlobal = "#discount-cashier-global";
    await waitVisible(cashierItem, 20, 1_000, "cashier per-item limit");
    await waitVisible(cashierGlobal, 20, 1_000, "cashier sale-wide limit");

    await setInputValue(cashierItem, "17", "cashier per-item limit");
    await setInputValue(cashierGlobal, "9", "cashier sale-wide limit");

    // The server row is the assertion. Before the fix this never existed — the
    // tab only wrote localStorage, so a fresh `SystemConfig` stayed empty and
    // the next workstation booted with the server defaults.
    const limits = await waitForServerSystemConfig<ServerDiscountLimits>(
      POS_DISCOUNT_LIMITS_KEY,
      (value) => value.cashier?.itemMaxPercent === 17,
      "POS_DISCOUNT_LIMITS.cashier.itemMaxPercent === 17",
    );

    expect(limits.cashier.itemMaxPercent).toBe(17);
    expect(limits.cashier.globalMaxPercent).toBe(9);
    // The whole block travels, so every OTHER role is preserved rather than
    // blanked. Owner stays exempt at 100 — a partial payload would have
    // silently capped the owner too.
    expect(limits.owner.itemMaxPercent).toBe(100);

    // And the local store agrees, so the screen is not showing a fiction.
    const stored = await fetchLocalConfig();
    const local = stored.discountLimits as ServerDiscountLimits;
    expect(local.cashier.itemMaxPercent).toBe(17);

    // Restore, so a later run is not measuring its own leftovers.
    await setInputValue(cashierItem, "10", "restore cashier per-item limit");
    await setInputValue(cashierGlobal, "5", "restore cashier sale-wide limit");
    await waitForServerSystemConfig<ServerDiscountLimits>(
      POS_DISCOUNT_LIMITS_KEY,
      (value) => value.cashier?.itemMaxPercent === 10,
      "POS_DISCOUNT_LIMITS.cashier.itemMaxPercent === 10 (restore)",
    );
  });

  it("E2E-SC02: the price floor reaches the server", async () => {
    await signInAs(OWNER);
    await openVentasTab();

    // The margin field only renders while the floor type is COST_PLUS_MARGIN
    // (`sales-config-tab.tsx` gates it on exactly that condition), and the
    // seeded type is COST — so waiting for `#floor-margin` first would time out
    // on a tab that had rendered perfectly.
    //
    // The LABEL is clicked, not the input: the radio carries `sr-only`, so a
    // native click on it fails with "element not interactable". The label is
    // what the user clicks, and the input is inside it.
    const marginType =
      'label:has(input[name="floor-type"][value="COST_PLUS_MARGIN"])';
    await waitVisible(marginType, 20, 1_000, "floor type option");
    await (await $(marginType)).click();

    await waitVisible("#floor-margin", 20, 1_000, "floor margin");
    await setInputValue("#floor-margin", "35", "floor margin");

    const config = await waitForServerSystemConfig<ServerSalesConfig>(
      POS_SALES_CONFIG_KEY,
      (value) => value.priceFloor?.minMarginPercent === 35,
      "POS_SALES_CONFIG.priceFloor.minMarginPercent === 35",
    );

    expect(config.priceFloor.minMarginPercent).toBe(35);
    // Credit is a separate flag; changing the margin must not disturb it, which
    // is what a whole-blob overwrite would do.
    expect(typeof config.creditEnabled).toBe("boolean");

    // Restore BOTH halves of the floor, in reverse order. Restoring only the
    // margin would leave the type switched, which changes what every later
    // render of this tab shows.
    await setInputValue("#floor-margin", "0", "restore floor margin");
    await waitForServerSystemConfig<ServerSalesConfig>(
      POS_SALES_CONFIG_KEY,
      (value) => value.priceFloor?.minMarginPercent === 0,
      "POS_SALES_CONFIG.priceFloor.minMarginPercent === 0 (restore)",
    );

    const costType = 'label:has(input[name="floor-type"][value="COST"])';
    await waitVisible(costType, 20, 1_000, "floor type option (restore)");
    await (await $(costType)).click();
    await waitForServerSystemConfig<ServerSalesConfig>(
      POS_SALES_CONFIG_KEY,
      (value) => value.priceFloor?.type === "COST",
      "POS_SALES_CONFIG.priceFloor.type === COST (restore)",
    );
  });

  it("E2E-SC03: store credit reaches the server, including the fields the server used to drop", async () => {
    await signInAs(OWNER);
    await openVentasTab();

    await waitVisible(
      "button#credit-enabled[role='switch']",
      20,
      1_000,
      "credit toggle",
    );
    await setSwitch("credit-enabled", true);

    const config = await waitForServerSystemConfig<ServerSalesConfig>(
      POS_SALES_CONFIG_KEY,
      (value) => value.creditEnabled === true,
      "POS_SALES_CONFIG.creditEnabled === true",
    );

    // The regression that made credit unreachable: `applySalesConfigDefaults`
    // rebuilt this object field by field and omitted both credit fields, so
    // even a correctly stored value never reached a POS.
    expect(config.creditEnabled).toBe(true);
    // Enabling credit always leaves a usable default behind, so clients are not
    // activated with a $0 (disabled) limit.
    expect(config.defaultCreditLimitCents).toBeGreaterThan(0);

    await setSwitch("credit-enabled", false);
    await waitForServerSystemConfig<ServerSalesConfig>(
      POS_SALES_CONFIG_KEY,
      (value) => value.creditEnabled === false,
      "POS_SALES_CONFIG.creditEnabled === false (restore)",
    );
  });

  it("E2E-SC04: ADMIN is refused and the value reverts instead of looking saved", async () => {
    // The failure mode worth preventing: the tab applies optimistically, so a
    // rejected save would otherwise leave a setting on screen that exists on no
    // machine and vanishes at the next boot.
    await signInAs(OWNER);
    await openVentasTab();

    // Seed a known value as OWNER so there is something for ADMIN to fail to
    // change — otherwise "unchanged" would pass for the wrong reason.
    await waitVisible(cashierItemLimit(), 20, 1_000, "cashier per-item limit");
    await setInputValue(cashierItemLimit(), "10", "seed cashier limit");
    await waitForServerSystemConfig<ServerDiscountLimits>(
      POS_DISCOUNT_LIMITS_KEY,
      (value) => value.cashier?.itemMaxPercent === 10,
      "POS_DISCOUNT_LIMITS seeded at 10",
    );

    const seeded = await fetchServerSystemConfig<ServerDiscountLimits>(
      POS_DISCOUNT_LIMITS_KEY,
    );

    await signInAs(ADMIN);
    await openVentasTab();
    await waitVisible(cashierItemLimit(), 20, 1_000, "cashier per-item limit");

    await setInputValue(cashierItemLimit(), "42", "admin attempt");

    // The push is debounced and then refused; give it room to be rejected.
    await waitForErrorToast();

    const after = await fetchServerSystemConfig<ServerDiscountLimits>(
      POS_DISCOUNT_LIMITS_KEY,
    );
    expect(after?.cashier.itemMaxPercent).toBe(seeded?.cashier.itemMaxPercent);
    expect(after?.cashier.itemMaxPercent).not.toBe(42);

    // And the screen went back to the server's value.
    const local = (await fetchLocalConfig())
      .discountLimits as ServerDiscountLimits;
    expect(local.cashier.itemMaxPercent).toBe(seeded?.cashier.itemMaxPercent);
  });
});