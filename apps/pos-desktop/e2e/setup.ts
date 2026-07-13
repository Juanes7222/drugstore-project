/**
 * Shared E2E test utilities — Pharmacy POS Desktop.
 *
 * Provides a test fixture that extends Playwright's base `test` with
 * app-level helpers: page-level Tauri IPC mocking, login shortcuts, and
 * common assertions.
 *
 * ## Tauri IPC mock
 *
 * The `@tauri-apps/api/core` module's `invoke` function calls into the
 * Tauri backend via `window.__TAURI_INTERNALS__`.  In the browser (our E2E
 * environment) this bridge does not exist, so we inject a shim before the
 * app loads so the dynamic imports in `service-context.tsx` resolve without
 * throwing.
 *
 * The shim intercepts specific Tauri commands (print_file, discover_printers)
 * and returns a plausible no-op result so the print/backup services degrade
 * gracefully instead of crashing the app initialisation.
 */
import { test as base, type Page, type TestInfo } from "@playwright/test";

// ---------------------------------------------------------------------------
// Tauri IPC shim — injected before any page script runs
// ---------------------------------------------------------------------------

const TAURI_IPC_SHIM = `
(function () {
  if (window.__TAURI_INTERNALS__) return;

  var __TAURI_INTERNALS__ = {
    invoke: function (cmd, args) {
      // Return a no-op failure for every command so the app does not crash.
      switch (cmd) {
        case "print_file":
          return Promise.resolve({ success: false, errorMessage: "E2E mock: no printer available" });
        case "discover_printers":
          return Promise.resolve([]);
        case "plugin:shell|open":
          return Promise.resolve();
        default:
          return Promise.reject(new Error("E2E mock: " + cmd + " is not implemented"));
      }
    },
    convertFileSrc: function (path) { return path; },
    transformCallback: function (fn, once) {
      var id = window.__TAURI_INTERNALS__.transformCallback.__nextId || 1;
      window.__TAURI_INTERNALS__.transformCallback.__nextId = id + 1;
      return id;
    },
    metadata: function () { return Promise.resolve({}); },
    isTauri: false,
  };

  window.__TAURI_INTERNALS__ = __TAURI_INTERNALS__;
})();
`;

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

export type AppFixtures = {
  /** Tauri-mocked page ready for POS interactions.  Page has loaded
   *  http://localhost:5173 with the Tauri IPC shim pre-injected. */
  posPage: Page;
};

export const test = base.extend<AppFixtures>({
  posPage: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>, _testInfo: TestInfo) => {
    // Inject the Tauri IPC shim before any script on the page runs.
    await page.addInitScript(TAURI_IPC_SHIM);
    await page.goto("/");
    // Wait for the React app to mount (root div populated).
    await page.waitForSelector("#root", { state: "attached" });
    await use(page);
  },
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Mock the NestJS backend login endpoint so the app can bypass the real
 * server during E2E.  After calling this helper the user avatar list on
 * the login page becomes actionable.
 *
 * Call this in `beforeEach` for any test that needs to reach the sales
 * screen.
 */
export async function mockLoginApi(page: Page): Promise<void> {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        accessToken: "e2e-mock-token",
        refreshToken: "e2e-mock-refresh",
        user: {
          id: "cashier-1",
          fullName: "Carlos López",
          role: "CASHIER",
          username: "carlos.lopez",
        },
        workstationId: "e2e-workstation-1",
        requiresTwoFactor: false,
      }),
    });
  });
}

/**
 * Mock the catalog search endpoint.
 */
export async function mockCatalogApi(page: Page): Promise<void> {
  await page.route("**/api/v1/catalog/search*", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "prod-1",
            name: "Acetaminofén 500mg",
            genericName: "Acetaminofén",
            unitPriceCents: 50000,
            taxPercentage: 0,
            saleType: "FREE_SALE",
            requiresPrescription: false,
            isRestricted: false,
            lotCode: "LOT-001",
            lotExpirationDate: "2027-06-01T00:00:00.000Z",
            currentStock: 100,
            minimumStock: 10,
            invimaCertificate: "INVIMA-2023-01",
            hasCompleteData: true,
          },
          {
            id: "prod-2",
            name: "Ibuprofeno 400mg",
            genericName: "Ibuprofeno",
            unitPriceCents: 35000,
            taxPercentage: 19,
            saleType: "FREE_SALE",
            requiresPrescription: false,
            isRestricted: false,
            lotCode: "LOT-002",
            lotExpirationDate: "2027-03-15T00:00:00.000Z",
            currentStock: 50,
            minimumStock: 5,
            invimaCertificate: "INVIMA-2023-02",
            hasCompleteData: true,
          },
        ].filter((item) =>
          query
            ? item.name.toLowerCase().includes(query.toLowerCase()) ||
              item.genericName.toLowerCase().includes(query.toLowerCase())
            : true,
        ),
      }),
    });
  });
}

/**
 * Wait for the loading spinner to disappear (PGlite init finished).
 */
export async function waitForAppReady(page: Page): Promise<void> {
  // The app shows a loading spinner during PGlite initialisation.
  // Wait until it disappears or the main UI appears.
  await page.waitForFunction(
    () => {
      const spinner = document.querySelector('[class*="animate-spin"]');
      const panel = document.querySelector('[class*="pos-panel"]');
      const errorAlert = document.querySelector('[role="alert"]');
      // If we see a panel or error, the app initialised (or failed).
      return !spinner || !!panel || !!errorAlert;
    },
    { timeout: 15_000 },
  );
}

/**
 * Assert that a toast with the given text is visible.
 */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 5_000 });
}
