/**
 * E2E: Clients — create, edit and deactivate from the POS against the real backend.
 *
 * The clients screen is the clearest example of the local-first contract in this
 * app: `ClientsService.create` writes the row into PGlite AND queues a
 * CLIENT_CREATION sync operation in the same transaction, then fires the push
 * trigger. So a client can be on screen — searchable, sellable, editable —
 * while the server has never heard of it.
 *
 * Every spec therefore asserts both halves: the row the cashier sees in the POS
 * mirror, and the row the server replayed. The fiscal document is issued
 * against the client's identifier snapshot, so a client that never reaches the
 * server is a compliance gap, not just a missing record.
 *
 * Toasts here come from sileo (`renderer/utils/notify.ts`), NOT from the
 * `role="status" pos-toast` the returns flow uses — see `expectToast`.
 */

import { $, expect } from "@wdio/globals";
import {
  signInAs,
  waitVisible,
  waitEnabled,
  waitGone,
  expectToast,
  expectPageHeading,
  openScreen,
  selectSearchableOption,
  setInputValue,
  clickWhenPresent,
  readText,
  resetForSpec,
  type SuiteAccount,
} from "./helpers";
import {
  waitForServerClient,
  waitForServerClientActiveState,
  fetchServerClients,
  waitForTerminalSyncOperation,
} from "./server-state";
import { fetchLocalClients } from "./local-state";

// `describe` / `it` / `beforeEach` are Mocha globals injected by the WDIO runner.
/* global describe, it, beforeEach */

const ADMIN: SuiteAccount = {
  identifier: "admin@pos-e2e.local",
  password: "123456",
  displayName: "Administradora Principal",
};

/**
 * Distinct document number per spec.
 *
 * The client identity the server enforces is the identification number, so
 * reusing one across specs would make each one a duplicate-identification
 * failure rather than a creation. They are digits only because
 * `ClientsService.search` treats an all-digit query as a document lookup while
 * anything else is matched against the name.
 */
const NEW_CLIENT = {
  identificationNumber: "51890987",
  fullName: "Camila Restrepo E2E",
  email: "camila.e2e@pos-e2e.local",
  phone: "3104445566",
  address: "Carrera 43A # 1-50",
  department: "Bogotá D.C.",
  municipality: "Bogotá D.C.",
};

const RENAMED_CLIENT = "Camila Restrepo E2E (editada)";

/** The clients list search box; its aria-label and placeholder are identical. */
const CLIENT_SEARCH = 'input[aria-label="Buscar por nombre o documento..."]';

/** The "+ Nuevo cliente" button in the page header. */
const NEW_CLIENT_BUTTON =
  '//h1[normalize-space(.)="Clientes"]/following-sibling::div//button[normalize-space(.)="Nuevo cliente"]';

/** Open the create form and wait for its header. */
async function openClientForm(): Promise<void> {
  await waitEnabled(NEW_CLIENT_BUTTON, 20, 1_000, "Nuevo cliente");
  await clickWhenPresent(NEW_CLIENT_BUTTON, "Nuevo cliente");
  await waitVisible(
    '//h3[normalize-space(.)="Crear nuevo cliente"]',
    20,
    1_000,
    "client create form",
  );
}

/**
 * Fill the identification type.
 *
 * Scoped to the form because the clients table also renders a `<span>` per row
 * showing the type, and the search box sits outside the form entirely.
 */
async function selectIdentificationType(value: string): Promise<void> {
  const select =
    '//div[.//h3[normalize-space(.)="Crear nuevo cliente"]]//select[@aria-label="Tipo de identificación"]';
  await waitVisible(select, 20, 500, "identification type select");
  await (await $(select)).selectByAttribute("value", value);
}

describe("Clients flow (real Tauri app against the real backend)", () => {
  beforeEach(() => {
    resetForSpec();
  });

  it("E2E-C01: a client created in the POS is replayed server-side with every field", async () => {
    await signInAs(ADMIN);

    expect(
      (await fetchServerClients()).some(
        (c) => c.identificationNumber === NEW_CLIENT.identificationNumber,
      ),
    ).toBe(false);

    await openScreen("Clientes");
    await expectPageHeading("Clientes");

    await openClientForm();
    await selectIdentificationType("CC");

    // No field in this form has an id or a `for`, so `aria-label` — which
    // client-form.tsx sets to the same string as the placeholder — is the only
    // stable hook.
    await setInputValue(
      'input[aria-label="Nombre completo"]',
      NEW_CLIENT.fullName,
      "client name",
    );
    await setInputValue(
      'input[aria-label="Número de documento"]',
      NEW_CLIENT.identificationNumber,
      "client document",
    );
    await setInputValue(
      'input[aria-label="Correo electrónico"]',
      NEW_CLIENT.email,
      "client email",
    );
    await setInputValue(
      'input[aria-label="Teléfono"]',
      NEW_CLIENT.phone,
      "client phone",
    );
    await setInputValue(
      'input[aria-label="Dirección"]',
      NEW_CLIENT.address,
      "client address",
    );

    // The linked department/municipality pair. Both are `SearchableSelect`
    // comboboxes whose dropdown is portalled to document.body with a `mousedown`
    // listener that closes it on an outside click, so each choice is committed
    // with Enter (which selects the single filtered option) rather than a driver
    // click on the <li>.
    await selectSearchableOption(
      'input[aria-label="Departamento"]',
      NEW_CLIENT.department,
      "department",
    );
    // The municipality only enables once a department is chosen, which makes the
    // enabled state the confirmation that the selection landed.
    await waitEnabled(
      'input[aria-label="Municipio"]',
      20,
      500,
      "municipality combobox, enabled once a department is picked",
    );
    await selectSearchableOption(
      'input[aria-label="Municipio"]',
      NEW_CLIENT.municipality,
      "municipality",
    );

    await clickWhenPresent(
      '//div[.//h3[normalize-space(.)="Crear nuevo cliente"]]//button[normalize-space(.)="Nuevo cliente"]',
      "submit client",
    );
    await expectToast("Cliente creado correctamente.");

    // ---- POS mirror: the client is immediately searchable, because the cart's
    // client lookup reads this table and nothing else.
    await setInputValue(
      CLIENT_SEARCH,
      NEW_CLIENT.identificationNumber,
      "client search",
    );
    await waitVisible(
      `//tr[.//span[normalize-space(.)="${NEW_CLIENT.fullName}"]]`,
      20,
      500,
      "new client row",
    );
    const local = await fetchLocalClients();
    expect(
      local.some(
        (c) => c.identificationNumber === NEW_CLIENT.identificationNumber,
      ),
    ).toBe(true);

    // ---- Server: the replay produced the row with the same identity.
    const replay = await waitForTerminalSyncOperation("CLIENT_CREATION");
    expect(replay.status).toBe("COMPLETED");

    const server = await waitForServerClient(NEW_CLIENT.identificationNumber);
    expect(server.identificationType).toBe("CC");
    expect(server.fullName).toBe(NEW_CLIENT.fullName);
    expect(server.email).toBe(NEW_CLIENT.email);
    expect(server.phone).toBe(NEW_CLIENT.phone);
    expect(server.isActive).toBe(true);

    // The location pair is a regression guard, not filler. Both callbacks of the
    // linked comboboxes fire in one handler, so a non-functional `onChange` made
    // the second one overwrite the department the first had just set — and every
    // client was saved with no location at all.
    expect(server.municipality).toBe(NEW_CLIENT.municipality);
    expect(server.department).toBe(NEW_CLIENT.department);
  });

  it("E2E-C02: editing a client through the detail dialog replays the change server-side", async () => {
    await signInAs(ADMIN);

    const before = await waitForServerClient(NEW_CLIENT.identificationNumber);
    expect(before.fullName).toBe(NEW_CLIENT.fullName);

    await openScreen("Clientes");
    await expectPageHeading("Clientes");

    await setInputValue(
      CLIENT_SEARCH,
      NEW_CLIENT.identificationNumber,
      "client search",
    );
    const row = `//tr[.//span[normalize-space(.)="${NEW_CLIENT.fullName}"]]`;
    await waitVisible(row, 20, 500, "client row");

    // Editing is reached through the DETAIL DIALOG here because the table's own
    // pencil button is covered by E2E-C04, which drives it directly.
    await clickWhenPresent(`${row}/td[1]`, "client row name cell");

    const dialog = '//div[@role="dialog"]';
    await waitVisible(dialog, 20, 1_000, "client detail dialog");
    await waitVisible(
      `${dialog}//h2[normalize-space(.)="${NEW_CLIENT.fullName}"]`,
      20,
      500,
      "dialog title",
    );

    await clickWhenPresent(
      `${dialog}//button[normalize-space(.)="Editar"]`,
      "Editar in the detail dialog",
    );

    // Edit mode slides in a panel whose header is the only thing distinguishing
    // it from the create form, and whose inputs are pre-filled.
    await waitVisible(
      '//h3[normalize-space(.)="Editar cliente"]',
      20,
      1_000,
      "client edit panel",
    );
    const nameInput = 'input[aria-label="Nombre completo"]';
    expect(await (await $(nameInput)).getValue()).toBe(NEW_CLIENT.fullName);

    await setInputValue(nameInput, RENAMED_CLIENT, "renamed client");
    await clickWhenPresent(
      '//div[.//h3[normalize-space(.)="Editar cliente"]]//button[normalize-space(.)="Guardar cliente"]',
      "Guardar cliente",
    );
    await expectToast("Cliente actualizado correctamente.");

    // The search still filters on the (unchanged) document number, so the row is
    // found by its NEW name.
    await waitVisible(
      `//tr[.//span[normalize-space(.)="${RENAMED_CLIENT}"]]`,
      20,
      500,
      "renamed client row",
    );

    const replay = await waitForTerminalSyncOperation("CLIENT_UPDATE");
    expect(replay.status).toBe("COMPLETED");

    const server = await waitForServerClient(NEW_CLIENT.identificationNumber);
    expect(server.fullName).toBe(RENAMED_CLIENT);
    // An edit must not silently alter the identity the client is invoiced under.
    expect(server.identificationNumber).toBe(NEW_CLIENT.identificationNumber);
  });

  it("E2E-C03: the detail dialog shows the identity and status a cashier checks", async () => {
    // The dialog is the one per-client view reachable from the row, so it is what
    // this spec pins.
    await signInAs(ADMIN);

    await openScreen("Clientes");
    await expectPageHeading("Clientes");

    await setInputValue(
      CLIENT_SEARCH,
      NEW_CLIENT.identificationNumber,
      "client search",
    );
    const row = `//tr[.//span[normalize-space(.)="${RENAMED_CLIENT}"]]`;
    await waitVisible(row, 20, 500, "client row");
    await clickWhenPresent(`${row}/td[1]`, "client row name cell");

    const dialog = '//div[@role="dialog"]';
    await waitVisible(dialog, 20, 1_000, "client detail dialog");

    const text = await readText(dialog);
    // The identification the fiscal document is issued against, plus the status
    // pill — the two facts a cashier checks before handing over a prescription.
    expect(text).toContain(NEW_CLIENT.identificationNumber);
    expect(text).toContain("CC");
    expect(text).toContain("Activo");
    expect(text).toContain(NEW_CLIENT.email);
  });

  it("E2E-C04: the row's edit and delete buttons fire, and delete deactivates server-side", async () => {
    // Regression guard for a defect this suite found: the action buttons were
    // wrapped in a container whose `onClickCapture` called stopPropagation().
    // React replays the tree capture-first, so that halted the traversal before
    // the buttons' own onClick ran — the eye, pencil and trash buttons did
    // nothing at all, which also left deactivation with no reachable UI path
    // (it is wired only to the trash button).
    //
    // The buttons are `opacity-0` until the row is hovered, so they are never
    // "visible" to a visibility-aware check; they are located by existence
    // inside the row instead.
    await signInAs(ADMIN);

    await openScreen("Clientes");
    await expectPageHeading("Clientes");

    await setInputValue(
      CLIENT_SEARCH,
      NEW_CLIENT.identificationNumber,
      "client search",
    );
    const row = `//tr[.//span[normalize-space(.)="${RENAMED_CLIENT}"]]`;
    await waitVisible(row, 20, 500, "client row");

    // ---- Edit, straight from the row button.
    await clickWhenPresent(`${row}//button[@aria-label="Editar"]`, "Editar");
    await waitVisible(
      '//h3[normalize-space(.)="Editar cliente"]',
      20,
      1_000,
      "client edit panel opened from the row button",
    );
    // Leaving without saving must not have changed anything.
    await clickWhenPresent(
      '//div[.//h3[normalize-space(.)="Editar cliente"]]//button[normalize-space(.)="Cancelar"]',
      "Cancelar",
    );
    await waitGone(
      '//h3[normalize-space(.)="Editar cliente"]',
      20,
      250,
      "client edit panel after cancelling",
    );

    // ---- Delete, straight from the row button.
    await clickWhenPresent(
      `${row}//button[@aria-label="Eliminar"]`,
      "Eliminar",
    );

    // Radix dialog: the title and the confirm button both read "Eliminar", so
    // everything is scoped to the dialog and the confirmation is the last button.
    await waitVisible('//div[@role="dialog"]', 20, 1_000, "delete dialog");
    await clickWhenPresent(
      '(//div[@role="dialog"])[last()]//button[normalize-space(.)="Eliminar"]',
      "confirm delete",
    );
    await expectToast("Cliente eliminado correctamente.");

    // A delete is a deactivation, never a row removal: the server keeps the
    // client because past invoices reference it.
    const server = await waitForServerClientActiveState(
      NEW_CLIENT.identificationNumber,
      false,
    );
    expect(server.isActive).toBe(false);
    expect(server.fullName).toBe(RENAMED_CLIENT);

    const replay = await waitForTerminalSyncOperation("CLIENT_DEACTIVATE");
    expect(replay.status).toBe("COMPLETED");

    // Still on the server, just inactive, and still exactly one row.
    const all = await fetchServerClients();
    expect(
      all.filter(
        (c) => c.identificationNumber === NEW_CLIENT.identificationNumber,
      ),
    ).toHaveLength(1);
  });
});
