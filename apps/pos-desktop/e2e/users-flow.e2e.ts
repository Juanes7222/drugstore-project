/**
 * E2E: User management — create, reset PIN, disable and enable against the real backend.
 *
 * Unlike clients and sales, nothing here is queued for sync: every action on the
 * user-management screen is a direct authenticated HTTP call to `/users`, so the
 * database is the only thing that can confirm it happened. Each spec therefore
 * asserts the server row and reads the server's own `status`/`pinHash` rather
 * than trusting the toast.
 *
 * ## Role-duplication note
 *
 * The suite's default account is an ADMIN, and ADMIN is refused by every
 * `/users` guard: `POST|PATCH|DELETE /users*` are all `@Roles(OWNER, MANAGER)`.
 * The same divergence shows up on the sales side, where `CartLineItem` offers
 * ADMIN a price-override editor that `validateItemPricing` then rejects, because
 * `resolvePriceOverrideRoleKey` has no ADMIN branch.
 *
 * ADMIN and OWNER are currently distinct roles with overlapping intent, so these
 * specs sign in as OWNER — the only role that clears every users guard. If the
 * two are ever unified (the intended direction, per the product owner), these
 * specs should switch to the unified role and the price-override assertion in
 * `sales-pricing-flow.e2e.ts` (E2E-S11) will fail, which is the signal that the
 * two disagreements were fixed together.
 */

import { $, browser, expect } from "@wdio/globals";
import {
  signInAs,
  waitVisible,
  expectToast,
  openScreen,
  setInputValue,
  clickButtonByExactText,
  clickButtonInScope,
  resetForSpec,
  waitGone,
  type SuiteAccount,
} from "./helpers";
import {
  waitForServerUser,
  waitForServerUserStatus,
  fetchServerUsers,
} from "./server-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const OWNER: SuiteAccount = {
  identifier: "owner@pos-e2e.local",
  password: "123456",
  displayName: "Dueña E2E",
};

const NEW_USER = {
  displayName: "Cajero E2E",
  username: "cajero.e2e",
  email: "cajero.e2e@pos-e2e.local",
  pin: "4821",
};

/**
 * Row for a user, located by the display name it renders in the first column.
 *
 * Written `td//p`, not the `.//p` the other specs use, because WebView2's
 * `evaluate` rejects an XPath with `//` directly inside a nested predicate:
 * `//tr[.//p[…]]` comes back as "not a valid XPath expression", and every
 * `waitVisible` retry then re-sends the same broken string for the full
 * timeout. `td//p` is an ordinary child path inside the predicate and parses.
 */
function userRow(displayName: string): string {
  return `//tr[td//p[normalize-space(.)="${displayName}"]]`;
}

/**
 * The actions CELL of that row — the last cell, which holds Editar / Desactivar
 * / Reset PIN / Eliminar.
 *
 * A dedicated helper because `userRow(x) + " button"` compounds the problem
 * above into a trailing descendant step, which this driver also refuses. One
 * path expression per selector, and this one stops at the cell so
 * `clickButtonInScope` can append its own `//button[…]` step to it.
 */
function userRowActionsCell(displayName: string): string {
  return `//tr[td//p[normalize-space(.)="${displayName}"]]/td[last()]`;
}

/** The row's action buttons, for readiness checks. */
function userRowActions(displayName: string): string {
  return `${userRowActionsCell(displayName)}//button`;
}

/**
 * Selector conventions this file depends on, both established by measurement:
 *
 * 1. Modal scope and fields are CSS, not XPath. An exact attribute or text
 *    equality inside an XPath predicate does not match in this driver —
 *    `//input[placeholder="Nombre del usuario"]` returns nothing while the same
 *    attribute matches through `contains(@placeholder, …)` and through
 *    `querySelectorAll`. XPath is used only for structure.
 * 2. Buttons are addressed by exact text via `clickButtonByExactText`, which
 *    refuses to click when the label is not unique. A `contains` match picks
 *    whichever element comes first and a native click on a covered element
 *    reports success without doing anything.
 *
 * Both modal panels render as `div.pos-panel` with a heading, and only one modal
 * is ever open at a time in this spec.
 */
const CREATE_MODAL = "div.pos-panel:has(h2)";

describe("User management (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-U01: a cashier created in the POS exists server-side with its role and a PIN hash", async () => {
    await signInAs(OWNER);

    expect(
      (await fetchServerUsers()).some((u) => u.username === NEW_USER.username),
    ).toBe(false);

    await openScreen("Usuarios");
    // The filters only render once the list request resolves, so the status
    // select is the reliable "the page is ready" signal — not the title.
    await waitVisible(
      'select[aria-label="Filtrar por rol"]',
      30,
      1_000,
      "user table filters",
    );

    // Exact text, not a `contains` match: the header button's label is
    // "+ Agregar usuario" and clicking it through a partial selector reported
    // success while the modal never opened.
    await clickButtonByExactText("+ Agregar usuario");

    // The modal exposes no ids and no aria-labels on its inputs — only
    // placeholders — so every field is addressed by its placeholder inside the
    // modal, which is what keeps them from colliding with the edit modal.
    await waitVisible(
      `${CREATE_MODAL} input[placeholder="Nombre del usuario"]`,
      20,
      1_000,
      "display name input",
    );
    await setInputValue(
      `${CREATE_MODAL} input[placeholder="Nombre del usuario"]`,
      NEW_USER.displayName,
      "display name",
    );
    await setInputValue(
      `${CREATE_MODAL} input[placeholder="Nombre de usuario (opcional)"]`,
      NEW_USER.username,
      "username",
    );
    await setInputValue(
      `${CREATE_MODAL} input[placeholder="correo@ejemplo.com (opcional)"]`,
      NEW_USER.email,
      "email",
    );

    // CASHIER is the modal's default role, which is also the only one that
    // renders the PIN input.
    const roleSelect = `${CREATE_MODAL} select`;
    await waitVisible(roleSelect, 20, 500, "role select");
    await (await $(roleSelect)).selectByAttribute("value", "CASHIER");

    await setInputValue(
      `${CREATE_MODAL} input[placeholder="4-6 dígitos (opcional)"]`,
      NEW_USER.pin,
      "initial PIN",
    );

    await clickButtonByExactText("Crear");
    await expectToast("Usuario creado exitosamente");

    // The new row appears without a reload — the list re-fetches on success.
    await waitVisible(userRow(NEW_USER.displayName), 30, 500, "new user row");

    // ---- Server side.
    const user = await waitForServerUser(NEW_USER.username);
    expect(user.fullName).toBe(NEW_USER.displayName);
    expect(user.email).toBe(NEW_USER.email);
    expect(user.role).toBe("CASHIER");
    expect(user.status).toBe("ACTIVE");
    expect(user.isActive).toBe(true);
    expect(user.deletedAt).toBeNull();

    // A PIN is stored only as a hash and is never retrievable, so the presence of
    // one is the assertion — plus the fact that no password was set, which is why
    // the modal only offered the PIN field in the first place.
    expect(user.pinHash ?? "").not.toBe("");
    expect(user.authMethod).toBe("PIN_ONLY");

    // And the server refuses a second account claiming the same EMAIL rather
    // than creating a duplicate identity.
    //
    // EMAIL, not username: the schema makes `User.email` `@unique` but leaves
    // `User.username` as a plain nullable column behind a non-unique
    // `@@index([subscriptionId, username])` (auth.prisma). So a repeated
    // username is accepted by design and this spec used to assert a rejection
    // the server never performed — it passed for the wrong reason on a stale
    // toast and failed outright once that toast was gone.
    await clickButtonByExactText("+ Agregar usuario");
    await waitVisible(
      `${CREATE_MODAL} input[placeholder="Nombre del usuario"]`,
      20,
      1_000,
      "second create modal",
    );
    await setInputValue(
      `${CREATE_MODAL} input[placeholder="Nombre del usuario"]`,
      `${NEW_USER.displayName} duplicado`,
      "duplicate display name",
    );
    await setInputValue(
      `${CREATE_MODAL} input[placeholder="correo@ejemplo.com (opcional)"]`,
      NEW_USER.email,
      "duplicate email",
    );
    await clickButtonByExactText("Crear");
    await expectToast("Error al crear usuario");

    const users = await fetchServerUsers();
    expect(users.filter((u) => u.email === NEW_USER.email)).toHaveLength(1);
    expect(
      users.filter((u) => u.fullName === `${NEW_USER.displayName} duplicado`),
    ).toHaveLength(0);

    // A rejected create leaves its modal open, and the backdrop then swallows
    // every navigation click in the specs that follow — the next spec failed
    // with "element click intercepted" on a sidebar item, which points at the
    // screen and not at the leftover overlay that was actually in the way.
    await clickButtonByExactText("Cancelar");
    await waitGone(CREATE_MODAL, 10, 500, "create modal");
  });

  it("E2E-U02: resetting the PIN rehashes it server-side", async () => {
    await signInAs(OWNER);

    const before = await waitForServerUser(NEW_USER.username);
    expect(before.pinHash ?? "").not.toBe("");

    await openScreen("Usuarios");
    await waitVisible(
      'select[aria-label="Filtrar por estado"]',
      30,
      1_000,
      "user table filters",
    );

    await waitVisible(
      userRowActions(NEW_USER.displayName),
      30,
      500,
      "user row actions",
    );
    await clickButtonInScope(
      userRowActionsCell(NEW_USER.displayName),
      "Reset PIN",
    );

    // The PIN dialog is a plain overlay too, so it is the same `pos-panel`
    // dialog shape as the create modal; only one is open at a time here.
    const pinDialog = "div.pos-panel:has(h2)";
    const pinInput = `${pinDialog} input[placeholder="4-6 dígitos (opcional)"]`;
    await waitVisible(pinInput, 20, 1_000, "set PIN dialog");

    // Under four digits the dialog refuses to submit — the button stays disabled
    // and the length error is shown without any ARIA role, so the disabled state
    // is the assertion.
    await setInputValue(pinInput, "12", "too-short PIN");
    await expect(
      await browser.execute(
        () =>
          !Array.from(document.querySelectorAll("button")).some(
            (b) =>
              b.textContent?.trim() === "Confirmar" &&
              !(b as HTMLButtonElement).disabled,
          ),
      ),
    ).toBe(true);

    await setInputValue(pinInput, "7359", "new PIN");
    await clickButtonByExactText("Confirmar");
    await expectToast("PIN actualizado correctamente");

    // The hash is salted, so it must differ — a hash that stayed the same would
    // mean the reset silently did nothing while reporting success.
    const after = await waitForServerUser(NEW_USER.username);
    expect(after.pinHash ?? "").not.toBe("");
    expect(after.pinHash).not.toBe(before.pinHash);
  });

  it("E2E-U03: disabling and re-enabling a user flips its server status", async () => {
    await signInAs(OWNER);

    await openScreen("Usuarios");
    await waitVisible(
      'select[aria-label="Filtrar por estado"]',
      30,
      1_000,
      "user table filters",
    );

    const row = userRow(NEW_USER.displayName);

    // "Activar" is a substring of "Desactivar", so the button is matched on its
    // EXACT text inside the row — a partial match would toggle the wrong way.
    await waitVisible(
      userRowActions(NEW_USER.displayName),
      30,
      500,
      "user row actions",
    );
    await clickButtonInScope(
      userRowActionsCell(NEW_USER.displayName),
      "Desactivar",
    );
    await expectToast("Usuario desactivado");

    const disabled = await waitForServerUserStatus(
      NEW_USER.username,
      "DISABLED",
    );
    expect(disabled.isActive).toBe(false);

    // The row renders "Activar" now, and a status filter proves the change is a
    // server-side query rather than a local one.
    await waitVisible(
      userRowActions(NEW_USER.displayName),
      30,
      500,
      "user row actions",
    );

    await (
      await $('select[aria-label="Filtrar por estado"]')
    ).selectByAttribute("value", "DISABLED");
    await waitVisible(row, 30, 500, "user row under the DISABLED filter");

    await clickButtonInScope(
      userRowActionsCell(NEW_USER.displayName),
      "Activar",
    );
    await expectToast("Usuario activado");

    const enabled = await waitForServerUserStatus(NEW_USER.username, "ACTIVE");
    expect(enabled.isActive).toBe(true);
  });
});
