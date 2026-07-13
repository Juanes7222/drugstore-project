/**
 * E2E: Offline → online sync flow.
 *
 * Simulates a network interruption while the cashier creates sales, then
 * restores connectivity and verifies the sync engine picks up the queued
 * operations.
 *
 * ## Infrastructure dependencies
 *
 * These tests use Playwright's `page.route()` to simulate offline/online
 * transitions by aborting requests.  The app's sync engine
 * (SyncSchedulerService, SyncPushService) runs inside the ServiceProvider
 * and requires the full PGlite + Prisma stack.
 *
 * The OperationQueuedToast component (tested in unit tests as OQT-01..04)
 * should appear when the app detects offline mode during a sale.
 */
import { test, expect, mockLoginApi, mockCatalogApi } from "./setup";

test.describe("Offline → online sync flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockLoginApi(page);
    await mockCatalogApi(page);
  });

  test("E2E-O01: Offline sale queues operation, restores on reconnect", async ({
    page,
  }) => {
    // ---- Login (while online) ----
    await page.goto("/");
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // ---- Go offline (abort all outbound requests) ----
    // Use page.route to block requests to the backend.
    await page.route("**/api/v1/**", (route) => route.abort());

    // ---- Add product to cart (works offline) ----
    await page.getByPlaceholder(/buscar/i).fill("acetaminofén");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Acetaminofén 500mg").click();

    // Proceed to payment.
    await page.getByText("Cobrar").click();

    // ---- Complete payment offline ----
    await page.getByText("Agregar método").click();
    const cashInput = page.getByLabel("Efectivo recibido");
    await cashInput.fill("50000");
    await page.getByText("Confirmar pago").click();

    // The operation should be queued locally. An "En cola" toast should
    // appear (OperationQueuedToast component).
    // This toast appears after the receipt screen when the app detects
    // it is offline.
    await expect(page.getByText(/en cola|pendiente de sincronizaci|offline/i)).toBeVisible({
      timeout: 10_000,
    });

    // ---- Go back online ----
    // Remove the route abort handler to restore connectivity.
    await page.unroute("**/api/v1/**");

    // Re-mock the login and catalog endpoints for subsequent requests.
    await mockLoginApi(page);
    await mockCatalogApi(page);

    // The sync scheduler should auto-detect the reconnection and push
    // the queued operation.  A "Sincronizado" toast should appear.
    await expect(page.getByText(/sincronizado|enviado|completado/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("E2E-O02: Multiple operations queued offline, all sync on reconnect", async ({
    page,
  }) => {
    // ---- Login ----
    await page.goto("/");
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // ---- Go offline ----
    await page.route("**/api/v1/**", (route) => route.abort());

    // ---- Create 3 offline sales ----
    const productNames = ["acetaminofén", "ibuprofeno", "acetaminofén"];

    for (const productName of productNames) {
      await page.getByPlaceholder(/buscar/i).fill(productName);
      await expect(page.getByText("Acetaminofén 500mg").or(page.getByText("Ibuprofeno 400mg"))).toBeVisible({
        timeout: 5_000,
      });
      await page
        .getByText(productName === "ibuprofeno" ? "Ibuprofeno 400mg" : "Acetaminofén 500mg")
        .first()
        .click();

      await page.getByText("Cobrar").click();
      await page.getByText("Agregar método").click();
      await page.getByLabel("Efectivo recibido").fill("50000");
      await page.getByText("Confirmar pago").click();

      // After the receipt, click "Nueva venta" to start another sale.
      await expect(page.getByText("Nueva venta")).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("Nueva venta").click();
      await expect(page.getByPlaceholder(/buscar/i)).toBeVisible();
    }

    // ---- Restore online ----
    await page.unroute("**/api/v1/**");
    await mockLoginApi(page);
    await mockCatalogApi(page);

    // The sync engine should push all 3 queued operations.
    // Each operation should produce a sync toast.
    await expect(page.getByText(/sincronizado/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Verify the sync health page shows cleared queue.
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();
    await page.getByText("Estado de sincronización").click();
    await expect(page.getByText(/0 pendiente|sin datos/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
