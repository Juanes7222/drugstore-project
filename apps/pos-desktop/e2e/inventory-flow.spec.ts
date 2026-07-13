/**
 * E2E: Inventory adjustment flow — search lot, apply increase adjustment.
 *
 * ## Infrastructure dependencies
 *
 * See `sales-flow.spec.ts` header for the dev-mode PrismaClient limitation.
 * The InventoryAdjustmentsPage depends on the InventoryAdjustmentsService
 * from the ServiceProvider — requiring the full PGlite + Prisma stack.
 *
 * ## Backend mock expectations
 *
 * This test assumes an API mock at `/api/v1/inventory/lots/search` returns
 * lot data, and `/api/v1/inventory/adjustments` accepts POST requests.
 */
import { test, expect, mockLoginApi } from "./setup";

test.describe("Inventory adjustment flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockLoginApi(page);

    // Mock the lot search endpoint.
    await page.route("**/api/v1/inventory/lots/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lots: [
            {
              id: "lot-001",
              productName: "Acetaminofén 500mg",
              lotCode: "LOT-001",
              currentStock: 15,
              minimumStock: 10,
              expirationDate: "2027-06-01T00:00:00.000Z",
              unitCostCents: 25000,
            },
          ],
        }),
      });
    });

    // Mock the adjustment creation endpoint.
    await page.route("**/api/v1/inventory/adjustments", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "adj-001",
            type: "INCREASE",
            quantity: 10,
            reason: "DAMAGE",
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });
  });

  test("E2E-I01: Positive inventory adjustment", async ({ page }) => {
    // Login
    await page.goto("/");
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to inventory adjustments via sidebar.
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();
    await page.getByText("Ajustes de inventario").click();

    // The adjustments page should show a lot search input.
    await expect(
      page.getByPlaceholder(/buscar lote/i).or(page.getByPlaceholder(/lote/i)),
    ).toBeVisible({ timeout: 5_000 });

    // Search for a lot.
    const lotSearch = page
      .getByPlaceholder(/buscar lote/i)
      .or(page.getByPlaceholder(/lote/i));
    await lotSearch.fill("LOT-001");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });

    // Select the lot.
    await page.getByText("Acetaminofén 500mg").click();

    // The adjustment form should now show the current stock and expiry.
    await expect(page.getByText("15")).toBeVisible(); // current stock

    // Select "Aumentar" (INCREASE) adjustment type.
    await page.getByText("Aumentar").click();

    // Enter quantity.
    const quantityInput = page
      .getByLabel(/cantidad/i)
      .or(page.getByPlaceholder(/cantidad/i));
    await quantityInput.fill("10");

    // Select a reason (not OTHER to avoid extra text field).
    await page.getByText("Daño").click();

    // Apply the adjustment.
    await page.getByText("Aplicar ajuste").click();

    // A success toast or confirmation should appear.
    await expect(page.getByText("Ajuste aplicado")).toBeVisible({
      timeout: 5_000,
    });
  });
});
