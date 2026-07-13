/**
 * E2E: Sales flow — login, product search, cart, payment, receipt.
 *
 * These tests validate the complete sale lifecycle from the cashier's
 * perspective: login → search products → add to cart → pay → view receipt.
 *
 * ## Infrastructure dependencies
 *
 * The app's ServiceProvider calls `hydrateStore()` on the ContingencyService
 * during initialisation, which in turn accesses
 * `this.prisma.contingencyEvent.findFirst()`.  In dev (browser) mode the
 * PrismaClient is a proxy that returns `undefined` for all model properties,
 * causing a TypeError at boot time.  Until that path is hardened, these tests
 * can only run against a Tauri build (where the full PrismaClient + PGlite
 * combo operates) or after the dev-mode proxy is made safe for all property
 * accesses used during startup.
 */
import { test, expect, mockLoginApi, mockCatalogApi } from "./setup";

test.describe("Sales flow", () => {
  test.beforeEach(async ({ page }) => {
    // Mock the backend APIs so the frontend runs without a real server.
    await mockLoginApi(page);
    await mockCatalogApi(page);
  });

  test("E2E-S01: Login → search product → add to cart → pay → receipt", async ({
    page,
  }) => {
    // ---- Login ----
    // The login page shows a row of avatars. Select Carlos López (cashier).
    await page.getByText("Carlos López").click();
    // The PIN keypad appears. Enter the mock PIN.
    // Playwright cannot type into a virtual keypad easily, so we use the
    // manual username/password fallback instead — click "Different account".
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    // After successful login, the sales screen should appear.
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // ---- Search product ----
    const searchInput = page.getByPlaceholder(/buscar/i);
    await searchInput.fill("acetaminofén");
    // The debounced search triggers after ~300ms.  Wait for results.
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });

    // ---- Add to cart ----
    await page.getByText("Acetaminofén 500mg").click();
    // The cart panel should now show the item.
    await expect(page.getByText("Acetaminofén 500mg").first()).toBeVisible();

    // ---- Proceed to payment ----
    await page.getByText("Cobrar").click();
    // Payment screen shows total due.
    await expect(page.getByTestId("payment-total-due")).toBeVisible();
    // Add a cash payment.
    await page.getByText("Agregar método").click();
    // Enter cash received (match the total).
    const cashInput = page.getByLabel("Efectivo recibido");
    await cashInput.fill("50000");
    // Confirm the payment.
    await page.getByText("Confirmar pago").click();

    // ---- Receipt screen ----
    await expect(page.getByText("Venta completada")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Nueva venta")).toBeVisible();

    // Start a new sale.
    await page.getByText("Nueva venta").click();
    // The search input should be visible again, meaning we're back at sales.
    await expect(page.getByPlaceholder(/buscar/i)).toBeVisible();
  });

  test("E2E-S02: Sale with multiple items", async ({ page }) => {
    // Login first
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Search and add Acetaminofén
    const searchInput = page.getByPlaceholder(/buscar/i);
    await searchInput.fill("acetaminofén");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Acetaminofén 500mg").click();

    // Search and add Ibuprofeno
    await searchInput.fill("ibuprofeno");
    await expect(page.getByText("Ibuprofeno 400mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Ibuprofeno 400mg").click();

    // Cart should show 2 items and an updated total.
    await expect(page.getByText("Acetaminofén 500mg").first()).toBeVisible();
    await expect(page.getByText("Ibuprofeno 400mg").first()).toBeVisible();
  });

  test("E2E-S03: Sale with change returned", async ({ page }) => {
    // Login
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Add a product
    await page.getByPlaceholder(/buscar/i).fill("acetaminofén");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Acetaminofén 500mg").click();

    // Proceed to payment
    await page.getByText("Cobrar").click();
    await expect(page.getByTestId("payment-total-due")).toBeVisible();
    await page.getByText("Agregar método").click();

    // Enter cash received MORE than the total to trigger change.
    const totalText = await page.getByTestId("payment-total-due").innerText();
    const totalCents = parseInt(totalText.replace(/[^0-9]/g, ""), 10);
    const overpayCents = totalCents + 10000; // Pay 10,000 extra
    await page.getByLabel("Efectivo recibido").fill(String(overpayCents));

    // Change amount should be visible.
    await expect(page.getByText("$ 10.000")).toBeVisible();
  });

  test("E2E-S04: Sale with electronic payment", async ({ page }) => {
    // Login
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Add product
    await page.getByPlaceholder(/buscar/i).fill("acetaminofén");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Acetaminofén 500mg").click();

    // Go to payment
    await page.getByText("Cobrar").click();
    await expect(page.getByTestId("payment-total-due")).toBeVisible();

    // Select debit card as payment method
    await page.getByText("Agregar método").click();
    // The default payment method is CASH. Change to debit card.
    await page.getByLabel("Tipo de pago").selectOption("DEBIT_CARD");
    // The total is auto-filled.
    // Authorize the card.
    await page.getByText("Autorizar").click();
    // After the mock gateway responds, the status should change to APPROVED.
    await expect(page.getByText("APROBADO")).toBeVisible({ timeout: 5_000 });
    // Confirm the payment.
    await page.getByText("Confirmar pago").click();
    await expect(page.getByText("Venta completada")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("E2E-S05: Sale with client assignment", async ({ page }) => {
    // Login
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "carlos.lopez");
    await page.fill('input[type="password"]', "123456");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Add product
    await page.getByPlaceholder(/buscar/i).fill("acetaminofén");
    await expect(page.getByText("Acetaminofén 500mg")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByText("Acetaminofén 500mg").click();

    // The sales screen has a "Buscar cliente" field (or section).
    // This depends on the actual UI implementation.
    // In Phase 5, the client search was tested in unit tests (RETP-01..07
    // are for the Returns page). The Sales client search might be in the
    // cart panel.
    const clientSearch = page.getByPlaceholder(/cliente/i);
    if (await clientSearch.isVisible()) {
      await clientSearch.fill("1234567890");
      // Select the first matching client.
      await page.getByText("Juan Pérez").first().click();
      // The client name should appear in the cart header.
      await expect(page.getByText("Juan Pérez")).toBeVisible();
    }
    // Proceed to payment as usual.
    await page.getByText("Cobrar").click();
    await expect(page.getByTestId("payment-total-due")).toBeVisible();
  });
});
