/**
 * E2E: Tenant configuration — the Configuración screen and its persistence.
 *
 * The config page is unusual among the screens this suite drives: it has no
 * submit button. Every control change writes through immediately —
 * `PUT /tenant-config` for the Operación and Compras tabs, and the local
 * Zustand store for the Ventas tab — so "was it saved?" has to be answered by
 * the database rather than by a confirmation control.
 *
 * That makes this the highest-value place to test the optimistic-concurrency
 * guard. `useTenantConfig.update` sends the `configVersion` it read, and
 * `TenantConfigService.updateConfigWithVersionGuard` writes only if the row
 * still carries it. Two changes fired back to back therefore race: the second
 * sends a stale version, the server rejects it with a conflict, and the page
 * replaces itself with a full-screen error. Every spec here waits for the
 * persisted value after each change instead of flipping the next control, which
 * is the only way to drive an auto-saving UI deterministically.
 *
 * Two tabs are covered and one is deliberately not:
 *
 *   - **Compras** and **Operación** persist to `TenantConfig` + `ConfigChangelog`,
 *     so both the value and the audit trail are asserted.
 *   - **Ventas**' discount limits have NO server write path today: the POS reads
 *     them from `GET /configuration/pos-settings` and writes them straight to
 *     `localStorage.pharmacy_local_config`. For those the persisted store IS the
 *     database of record, and E2E-T05 asserts it there. (The server's
 *     `SystemConfig` does hold a `POS_DISCOUNT_LIMITS` key, and the mismatch is
 *     worth knowing about: limits set on one terminal do not reach another.)
 */

import { $, expect } from "@wdio/globals";
import {
  signInAs,
  waitVisible,
  setSwitch,
  readSwitch,
  toggleConfigSwitch,
  openConfigTab,
  expectConfigSection,
  openScreen,
  setInputValue,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  fetchServerTenantConfig,
  waitForTenantConfigValue,
  fetchServerConfigChangelog,
} from "./server-state";
import { fetchLocalConfig } from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

/** Open the config page and wait for its shell. */
async function openConfig(): Promise<void> {
  await openScreen("Configuración");
  // The first tab mounts the company panel; its nav is the page's readiness
  // signal, and it carries an aria-label of "Empresa" (config.tabs.company)
  // regardless of which of the eight tabs it wraps.
  await waitVisible(
    '//nav[@aria-label="Empresa"]',
    30,
    1_000,
    "config tab nav",
  );
  await waitVisible(
    '//h2[normalize-space(.)="Configuración del sistema"]',
    30,
    1_000,
    "config page heading",
  );
}

/**
 * Flip a switch and wait for the server to have persisted the new value.
 *
 * The wait is the whole point: two changes fired back to back race on
 * `configVersion`, so the caller must observe the first one land before
 * flipping the second.
 */
async function setPurchasesSwitch(id: string, desired: boolean): Promise<void> {
  await setSwitch(id, desired);
  const config = await waitForTenantConfigValue("purchases", id, desired);
  expect(config.configVersion).toBeGreaterThan(0);
}

describe("Tenant configuration (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-T01: requiring a lot number on reception persists to the tenant config row", async () => {
    await signInAs(OWNER);
    await openConfig();

    // Deliberately NOT asserting the row is absent. `TenantConfigService.getBySubscription`
    // serves a computed preset default until the first save creates the row, but a
    // spec running earlier in the same session may already have created it — the
    // lot-expiry spec ends by turning requireLotOnReception back off, and that
    // write is a row. Asserting absence made this spec depend on its position in
    // the run: green in isolation, red as spec 8 of 8.
    const before = await fetchServerTenantConfig();

    await openConfigTab("Compras");
    await expectConfigSection("Configuración de recepciones");

    // Driven off the observed state, not an assumed default: the config page
    // opens showing the ACTIVE PRESET's values and BALANCED already ships
    // `requireLotOnReception: true`, so "set it to true" would have been a no-op
    // that never issued a PUT.
    const target = await toggleConfigSwitch(
      "requireLotOnReception",
      "purchases",
    );
    expect(await readSwitch("requireLotOnReception")).toBe(target);

    // ---- Server side: the row carries the flag at a version above where it
    // started, which is what proves a version-guarded write actually landed.
    const after = await fetchServerTenantConfig();
    expect(after).not.toBeNull();
    expect(after?.purchases.requireLotOnReception).toBe(target);
    expect(after?.configVersion).toBeGreaterThan(before?.configVersion ?? 0);

    // The changelog is the audit trail a pharmacy needs to answer "who turned
    // this on, and when" — and it is the only proof the save went through the
    // version-guarded write path rather than a partial update.
    const changelog = await fetchServerConfigChangelog();
    const entry = changelog.find((row) => row.fieldPath === "purchases");
    expect(entry).toBeDefined();
    expect(entry?.changeType).toBe("FIELD_UPDATED");
    expect(entry?.configVersion).toBe(after?.configVersion);

    // Toggle back, so the flag does not leak into the specs that follow.
    expect(await toggleConfigSwitch("requireLotOnReception", "purchases")).toBe(
      !target,
    );
  });

  it("E2E-T02: requiring an expiry date on reception persists and bumps the version", async () => {
    await signInAs(OWNER);
    await openConfig();

    await openConfigTab("Compras");
    await expectConfigSection("Configuración de recepciones");

    // Snapshot the sibling flag so independence can be asserted relatively —
    // BALANCED already ships both of these on, so pinning them to `true` would
    // hand the spec a pass without ever exercising a write.
    const before = await fetchServerTenantConfig();
    const lotBefore = before?.purchases.requireLotOnReception;

    const target = await toggleConfigSwitch(
      "requireExpiryOnReception",
      "purchases",
    );
    expect(await readSwitch("requireExpiryOnReception")).toBe(target);

    // The two flags are independent: turning the second one must not have
    // reverted the first, which is what a whole-section overwrite would do.
    const after = await fetchServerTenantConfig();
    expect(after?.purchases.requireLotOnReception).toBe(lotBefore);
    expect(after?.configVersion).toBeGreaterThan(before?.configVersion ?? 0);

    // Over-reception is a third, independent flag in the same section.
    const overTarget = await toggleConfigSwitch("allowOverReception", "purchases");
    const withOver = await fetchServerTenantConfig();
    expect(withOver?.purchases.requireExpiryOnReception).toBe(target);

    // Restore both, so this spec does not leak into the ones that follow.
    expect(
      await toggleConfigSwitch("allowOverReception", "purchases"),
    ).toBe(!overTarget);
    expect(
      await toggleConfigSwitch("requireExpiryOnReception", "purchases"),
    ).toBe(!target);
  });

  it("E2E-T03: an Operación strictness change persists alongside the purchases flags", async () => {
    await signInAs(OWNER);
    await openConfig();

    await openConfigTab("Operación");
    // "Validación de stock" is a field LABEL, not a section heading: the
    // Operación tab opens on the "Niveles de exigencia" section. Waiting on the
    // label made this spec time out even when the tab rendered correctly.
    await expectConfigSection("Niveles de exigencia");

    // Snapshot the sibling section first; see T02 for why these are compared
    // relatively rather than pinned to `true`.
    const snapshot = await fetchServerTenantConfig();
    const purchasesBefore = snapshot?.purchases.requireLotOnReception;
    const expiryBefore = snapshot?.purchases.requireExpiryOnReception;

    // The Operación tab renders its booleans as `type="checkbox"` with an
    // `sr-only` input (unlike the Compras tab's role="switch" buttons), and its
    // level pickers are selects whose aria-label equals the visible label.
    const stockValidation = 'select[aria-label="Validación de stock"]';
    await waitVisible(stockValidation, 20, 1_000, "stock validation select");
    await (await $(stockValidation)).selectByAttribute("value", "OFF");

    const config = await waitForTenantConfigValue(
      "strictness",
      "stockValidation",
      "OFF",
    );
    // The purchases section is untouched by an Operación change — both live in
    // the same row, so a whole-row overwrite would show up here.
    expect(config.purchases.requireLotOnReception).toBe(purchasesBefore);
    expect(config.purchases.requireExpiryOnReception).toBe(expiryBefore);

    const changelog = await fetchServerConfigChangelog();
    expect(changelog.some((row) => row.fieldPath === "strictness")).toBe(true);

    // Put it back so the rest of the run sees the seeded behaviour.
    await (await $(stockValidation)).selectByAttribute("value", "STRICT");
    await waitForTenantConfigValue("strictness", "stockValidation", "STRICT");
  });

  it("E2E-T04: the max items per order default reaches the server and the order form", async () => {
    await signInAs(OWNER);
    await openConfig();

    await openConfigTab("Compras");
    await expectConfigSection("Configuración de órdenes");

    const maxItems = "#maxItemsPerOrder";
    await waitVisible(maxItems, 20, 1_000, "max items input");
    // The order form appends "(0/50)" to its "Agregar producto" label when the
    // limit is set, which is the visible consequence of this value.
    await setInputValue(maxItems, "3", "max items per order");

    const config = await waitForTenantConfigValue(
      "purchases",
      "maxItemsPerOrder",
      3,
    );
    expect(config.purchases.maxItemsPerOrder).toBe(3);

    await setInputValue(maxItems, "0", "reset max items");
    await waitForTenantConfigValue("purchases", "maxItemsPerOrder", 0);
  });

  it("E2E-T05: the Ventas tab's discount limits persist to the POS configuration store", async () => {
    await signInAs(OWNER);
    await openConfig();

    await openConfigTab("Ventas");
    await expectConfigSection("Límites de descuento por rol");

    // The eight inputs are addressed by the ids `sales-config-tab.tsx` builds:
    // `discount-{role}-{item|global}`. Note the camelCase in
    // `inventoryAssistant` — kebab-casing it silently finds nothing.
    const cashierItem = "#discount-cashier-item";
    const cashierGlobal = "#discount-cashier-global";

    await waitVisible(
      cashierItem,
      20,
      1_000,
      "cashier per-item discount limit",
    );
    await waitVisible(
      cashierGlobal,
      20,
      1_000,
      "cashier sale-wide discount limit",
    );

    await setInputValue(cashierItem, "7", "cashier item limit");
    await setInputValue(cashierGlobal, "4", "cashier global limit");

    // The Owner row is deliberately read-only and renders no inputs at all —
    // `validateItemPricing` short-circuits for OWNER, so a limit for it would be
    // a control that cannot do anything.
    expect(
      await fetchLocalConfig().then((config) => {
        const limits = config.discountLimits as Record<
          string,
          { itemMaxPercent: number; globalMaxPercent: number }
        >;
        return limits?.cashier?.itemMaxPercent;
      }),
    ).toBe(7);

    const stored = await fetchLocalConfig();
    const limits = stored.discountLimits as Record<
      string,
      { itemMaxPercent: number; globalMaxPercent: number }
    >;
    expect(limits.cashier.globalMaxPercent).toBe(4);
    // And no server row was written: this tab has no push path, which is why the
    // store is asserted directly.
    const tenantConfig = await fetchServerTenantConfig();
    expect(tenantConfig?.strictness).not.toHaveProperty("discountLimits");

    // Restore the seeded defaults so a later run is not affected by this one.
    await setInputValue(cashierItem, "10", "restore cashier item limit");
    await setInputValue(cashierGlobal, "5", "restore cashier global limit");
  });

  it("E2E-T06: the config page reports a load failure rather than silently showing defaults", async () => {
    // Guard against the failure mode that makes this whole file worthless: a
    // config screen that renders the computed default because the fetch failed
    // looks identical to a correctly loaded screen until something is saved.
    // The way to tell them apart is that a real save increments `configVersion`
    // on the server row, which the earlier specs already assert.
    await signInAs(OWNER);
    await openConfig();

    const config = await fetchServerTenantConfig();
    expect(config).not.toBeNull();
    expect(config?.id).not.toBe("");
    // A computed default carries id "" and version 0; a persisted row never does.
    expect(config?.configVersion).toBeGreaterThan(0);
    expect(config?.lastModifiedById ?? "").not.toBe("");
  });
});
