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
  waitEnabled,
  expectToast,
  openScreen,
  setInputValue,
  clickWhenPresent,
  resetForSpec,
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

/** Row for a user, located by the display name it renders in the first column. */
function userRow(displayName: string): string {
  return `//tr[.//p[normalize-space(.)="${displayName}"]]`;
}

/**
 * The create-user modal, which is a plain overlay div and carries no ARIA role.
 *
 * Scoped by the panel's own class rather than by "any div containing the
 * heading": the overlay wraps the panel, so a bare descendant test matches both
 * and the outer wrapper has no fields in it.
 */
const CREATE_MODAL =
  '(//div[contains(@class,"pos-panel")][.//h2[normalize-space(.)="Agregar usuario"]])[1]';

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

    await waitEnabled(
      '//button[contains(normalize-space(.),"Agregar usuario")]',
      20,
      1_000,
      "Agregar usuario",
    );
    await clickWhenPresent(
      '//button[contains(normalize-space(.),"Agregar usuario")]',
      "Agregar usuario",
    );

    // The modal exposes no ids and no aria-labels on its inputs — only
    // placeholders — so every field is addressed by its placeholder inside the
    // modal, which is what keeps them from colliding with the edit modal.
    await waitVisible(
      `${CREATE_MODAL}//input[placeholder="Nombre del usuario"]`,
      20,
      1_000,
      "display name input",
    );
    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="Nombre del usuario"]`,
      NEW_USER.displayName,
      "display name",
    );
    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="Nombre de usuario (opcional)"]`,
      NEW_USER.username,
      "username",
    );
    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="correo@ejemplo.com (opcional)"]`,
      NEW_USER.email,
      "email",
    );

    // CASHIER is the modal's default role, which is also the only one that
    // renders the PIN input.
    const roleSelect = `${CREATE_MODAL}//select`;
    await waitVisible(roleSelect, 20, 500, "role select");
    await (await $(roleSelect)).selectByAttribute("value", "CASHIER");

    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="4-6 dígitos (opcional)"]`,
      NEW_USER.pin,
      "initial PIN",
    );

    await clickWhenPresent(
      `${CREATE_MODAL}//button[normalize-space(.)="Crear"]`,
      "Crear",
    );
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

    // And the server refuses a second user with the same username rather than
    // creating a duplicate identity.
    await clickWhenPresent(
      '//button[contains(normalize-space(.),"Agregar usuario")]',
      "Agregar usuario",
    );
    await waitVisible(
      `${CREATE_MODAL}//input[placeholder="Nombre del usuario"]`,
      20,
      1_000,
      "second create modal",
    );
    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="Nombre del usuario"]`,
      `${NEW_USER.displayName} duplicado`,
      "duplicate display name",
    );
    await setInputValue(
      `${CREATE_MODAL}//input[placeholder="Nombre de usuario (opcional)"]`,
      NEW_USER.username,
      "duplicate username",
    );
    await clickWhenPresent(
      `${CREATE_MODAL}//button[normalize-space(.)="Crear"]`,
      "Crear",
    );
    await expectToast("Error al crear usuario");

    const users = await fetchServerUsers();
    expect(users.filter((u) => u.username === NEW_USER.username)).toHaveLength(
      1,
    );
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

    const row = userRow(NEW_USER.displayName);
    await waitVisible(
      `${row}//button[normalize-space(.)="Reset PIN"]`,
      30,
      500,
      "Reset PIN",
    );
    await clickWhenPresent(
      `${row}//button[normalize-space(.)="Reset PIN"]`,
      "Reset PIN",
    );

    // The PIN dialog is a plain overlay too; only its title distinguishes it from
    // the create modal's identically-placed PIN input.
    const pinDialog = `//div[.//h2[contains(text(),"Establecer PIN para")]]`;
    const pinInput = `${pinDialog}//input[placeholder="4-6 dígitos (opcional)"]`;
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
    await clickWhenPresent(
      `${pinDialog}//button[normalize-space(.)="Confirmar"]`,
      "Confirmar",
    );
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
      `${row}//button[normalize-space(.)="Desactivar"]`,
      30,
      500,
      "Desactivar",
    );
    await clickWhenPresent(
      `${row}//button[normalize-space(.)="Desactivar"]`,
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
      `${userRow(NEW_USER.displayName)}//button[normalize-space(.)="Activar"]`,
      30,
      500,
      "Activar",
    );

    await (
      await $('select[aria-label="Filtrar por estado"]')
    ).selectByAttribute("value", "DISABLED");
    await waitVisible(row, 30, 500, "user row under the DISABLED filter");

    await clickWhenPresent(
      `${row}//button[normalize-space(.)="Activar"]`,
      "Activar",
    );
    await expectToast("Usuario activado");

    const enabled = await waitForServerUserStatus(NEW_USER.username, "ACTIVE");
    expect(enabled.isActive).toBe(true);
  });
});
