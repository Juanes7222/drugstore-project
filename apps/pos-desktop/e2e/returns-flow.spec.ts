/**
 * E2E: Returns flow — verified and un-verified return scenarios.
 *
 * ## Infrastructure dependencies
 *
 * See `sales-flow.spec.ts` header for the dev-mode PrismaClient limitation
 * that prevents these tests from running in a plain browser.  These tests
 * exercise the ReturnsPage which depends on ReturnsService from the
 * ServiceProvider — requiring the full PGlite + Prisma stack.
 */
import { test, expect, mockLoginApi } from "./setup";

test.describe("Returns flow", () => {
  test.beforeEach(async ({ page }) => {
    await mockLoginApi(page);

    // Mock the returns search endpoint.
    await page.route("**/api/v1/returns/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sale: {
            id: "sale-001",
            localNumber: 42,
            totalCents: 850000,
            createdAt: "2026-07-10T10:30:00.000Z",
            client: {
              fullName: "María Rodríguez",
              identificationNumber: "123456789",
            },
            items: [
              {
                id: "item-1",
                productName: "Acetaminofén 500mg",
                quantity: 2,
                unitPriceCents: 50000,
                totalCents: 100000,
              },
              {
                id: "item-2",
                productName: "Ibuprofeno 400mg",
                quantity: 1,
                unitPriceCents: 35000,
                totalCents: 35000,
              },
            ],
          },
        }),
      });
    });

    // Mock the returns creation endpoint.
    await page.route("**/api/v1/returns", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "return-001",
            state: "DRAFT",
            createdAt: new Date().toISOString(),
          }),
        });
      } else {
        await route.fulfill({ status: 200, body: "{}" });
      }
    });
  });

  test("E2E-R01: Verified return — search sale, select items, confirm", async ({
    page,
  }) => {
    // Navigate to returns screen.
    // In the real app this is done via the sidebar navigation.
    // The login redirects to sales by default, so we navigate to / first.
    await page.goto("/");
    await expect(page.getByText("Otra cuenta")).toBeVisible({ timeout: 5_000 });

    // Login
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Open sidebar (collapsed by default). Hover the left edge or click
    // the hamburger icon to expand.
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();
    // Click on "Devoluciones" in the nav.
    await page.getByText("Devoluciones").click();

    // The returns page should show two tabs: "Verificada" and "No verificada".
    await expect(page.getByText("Verificada")).toBeVisible();
    await expect(page.getByText("No verificada")).toBeVisible();

    // ---- Verified return ----
    // Search for sale by local number.
    const searchInput = page.getByPlaceholder(/n.*mero de venta/i);
    await searchInput.fill("42");
    // The result should show the sale items.
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("María Rodríguez")).toBeVisible();

    // Enter a quantity to return for the first item.
    const quantityInput = page
      .getByText("Acetaminofén 500mg")
      .locator("..")
      .getByRole("spinbutton");
    await quantityInput.fill("1");

    // Confirm the return.
    await page.getByText("Devolver").click();
    // After a successful return creation, a confirmation toast appears.
    await expect(page.getByText("Devolución creada")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("E2E-R02: Un-verified return — manual entry with manager PIN", async ({
    page,
  }) => {
    await page.goto("/");

    // Login as cashier
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to returns via sidebar
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();
    await page.getByText("Devoluciones").click();

    // Click the "No verificada" tab.
    await page.getByText("No verificada").click();

    // Fill in manual return fields.
    await page.getByPlaceholder(/producto/i).fill("Acetaminofén 500mg");
    await page.getByPlaceholder(/cantidad/i).fill("1");
    await page.getByPlaceholder(/precio/i).fill("50000");
    await page.getByPlaceholder(/motivo/i).fill("Cliente insatisfecho");

    // A manager PIN is required for un-verified returns.
    await page.getByPlaceholder(/PIN del gerente/i).fill("999999");

    // Submit the return.
    await page.getByText("Devolver").click();

    // Expect a confirmation or toast.
    // Depending on implementation, this may show a "Devolución creada" toast
    // or navigate to a confirmation screen. For now we assert the button
    // becomes disabled or a status message appears.
    await expect(
      page.getByText("Devolución creada").or(page.getByText("Pendiente de aprobación")),
    ).toBeVisible({ timeout: 5_000 });
  });
});
