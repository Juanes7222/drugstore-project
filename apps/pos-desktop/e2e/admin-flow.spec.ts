/**
 * E2E: Admin flows — sync health monitoring and retry.
 *
 * ## Infrastructure dependencies
 *
 * See `sales-flow.spec.ts` header for the dev-mode PrismaClient limitation.
 * The SyncHealthPage depends on SyncMetricsService and SyncRecoveryService
 * from the ServiceProvider — requiring the full PGlite + Prisma stack.
 *
 * The admin flow also requires login with ADMIN or MANAGER role to access
 * the sync health page.  The mock login in `setup.ts` returns CASHIER role
 * by default; for admin-specific tests we override the role to ADMIN.
 */
import { test, expect, mockLoginApi } from "./setup";

test.describe("Admin and sync health flow", () => {
  test.beforeEach(async ({ page }) => {
    // Override mock login to return an ADMIN user.
    await page.route("**/api/v1/auth/login", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          accessToken: "e2e-mock-token-admin",
          refreshToken: "e2e-mock-refresh",
          user: {
            id: "owner-1",
            fullName: "Juan Pérez",
            role: "ADMIN",
            username: "juan.perez",
          },
          workstationId: "e2e-workstation-1",
          requiresTwoFactor: false,
        }),
      });
    });

    // Mock the sync status endpoint.
    await page.route("**/api/v1/sync/status", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          online: true,
          lastSyncAt: new Date().toISOString(),
          queueCounts: {
            pending: 5,
            stalePending: 2,
            failed: 3,
            permanentFailure: 1,
            completed24h: 48,
            completedTotal: 1250,
          },
          failureBreakdown: [
            { category: "NETWORK", count: 2, mostRecent: "2026-07-13T10:00:00Z" },
            { category: "VALIDATION", count: 1, mostRecent: "2026-07-13T09:30:00Z" },
          ],
        }),
      });
    });

    // Mock the retry endpoint.
    await page.route("**/api/v1/sync/retry/**", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            entryId: "entry-001",
            newState: "PENDING",
            retryCount: 0,
            payloadResnapshotted: false,
          }),
        });
      }
    });

    // Mock the discard endpoint.
    await page.route("**/api/v1/sync/discard/**", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            entryId: "entry-001",
            state: "DISCARDED",
          }),
        });
      }
    });
  });

  test("E2E-A01: Admin views sync health KPIs and runs sync now", async ({
    page,
  }) => {
    // Login
    await page.goto("/");
    // Login as ADMIN via password (Juan Pérez is OWNER role, needs password).
    await page.getByText("Juan Pérez").click();
    await page.fill('input[type="password"]', "admin123");
    await page.getByText("Ingresar").click();

    // Wait for the sales screen to appear.
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to Sync Health via sidebar.
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();

    // The sidebar should show a "Sync Health" entry (or "Estado de
    // sincronización").
    await page.getByText(/sync health|sincronizaci|estado de sync/i).click();

    // The sync health page should show KPIs.
    await expect(page.getByText("5")).toBeVisible(); // pending count
    await expect(page.getByText("3")).toBeVisible(); // failed count
    await expect(page.getByText("1")).toBeVisible(); // permanent failure
    await expect(page.getByText("48")).toBeVisible(); // completed 24h

    // The "Run Sync Now" button should be visible and clickable.
    const runSyncButton = page.getByText(/run sync|sync now|sincronizar ahora/i);
    await expect(runSyncButton).toBeVisible();
    await runSyncButton.click();

    // A toast or feedback should indicate the sync was triggered.
    await expect(
      page.getByText(/sincronizaci.*iniciada|sync.*started/i),
    ).toBeVisible({ timeout: 5_000 });

    // Connection test button should be visible.
    const connectionTestButton = page.getByText(/probar conexi|test connection|connection test/i);
    if (await connectionTestButton.isVisible()) {
      await connectionTestButton.click();
    }

    // Export buttons should be visible.
    await expect(page.getByText(/CSV/)).toBeVisible();
    await expect(page.getByText(/JSON/)).toBeVisible();
  });

  test("E2E-A02: Retry a permanently failed entry", async ({ page }) => {
    // Login as ADMIN
    await page.goto("/");
    await page.getByText("Otra cuenta").click();
    await page.fill('input[type="text"]', "juan.perez");
    await page.fill('input[type="password"]', "admin123");
    await page.getByText("Ingresar").click();
    await expect(page.getByText("Buscar producto")).toBeVisible({
      timeout: 10_000,
    });

    // Navigate to Sync Health.
    const sidebarToggle = page.locator('[class*="sidebar"]').first();
    await sidebarToggle.hover();
    await page.getByText(/sync health|sincronizaci/i).click();

    // Find a permanently failed entry (the KPI shows count of 1).
    // There should be a list or section showing failed entries.
    const permanentFailureSection = page.getByText(/fallo permanente|permanent failure/i);
    await expect(permanentFailureSection).toBeVisible();

    // Click on the entry to expand details.
    await permanentFailureSection.click();

    // The retry button should be visible for the entry.
    const retryButton = page.getByText(/reintentar|retry/i).first();
    await expect(retryButton).toBeVisible({ timeout: 5_000 });
    await retryButton.click();

    // After retry, the entry should move to pending state.
    await expect(
      page.getByText(/reintento exitoso|retry successful|movido a pendiente/i),
    ).toBeVisible({ timeout: 5_000 });
  });
});
