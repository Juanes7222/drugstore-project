/**
 * Tests for useSyncSchedulerService() and useServiceContext() — the two new
 * exports added to service-context.tsx.
 *
 * Follows the same mocking pattern as the existing service-context.test.tsx.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { type FC } from "react";

// ---------------------------------------------------------------------------
// Mock useServiceInit at module level (same strategy as service-context.test.tsx)
// ---------------------------------------------------------------------------

const mockUseServiceInit = vi.fn<
  [object?],
  | { status: "loading" }
  | { status: "ready"; services: Record<string, unknown> }
  | { status: "error"; error: Error }
>();

vi.mock("../../hooks/use-service-init", () => ({
  useServiceInit: (...args: unknown[]) => mockUseServiceInit(...args),
  initializeServices: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import {
  ServiceProvider,
  useServiceContext,
  useSyncSchedulerService,
} from "./service-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSyncScheduler = {
  updateAccessToken: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  syncNow: vi.fn(),
};

const mockServices: Record<string, unknown> = {
  returnsService: { createReturn: vi.fn() },
  inventoryAdjustmentsService: { createAdjustment: vi.fn() },
  prescriptionsService: { createPrescription: vi.fn() },
  backupService: { createBackup: vi.fn() },
  recoveryLogService: { log: vi.fn() },
  invoiceService: { generateInvoiceForSale: vi.fn() },
  contingencyService: { isInContingency: vi.fn() },
  fiscalNumberingService: { nextNumber: vi.fn() },
  fiscalScheduler: { start: vi.fn() },
  printerConfigService: { listAll: vi.fn() },
  printQueueService: { enqueueJob: vi.fn() },
  printRouter: { print: vi.fn() },
  printerHealthService: { start: vi.fn() },
  configExportService: { exportConfig: vi.fn() },
  printingMetricsService: { getHealthLine: vi.fn() },
  cashDrawerService: { openDrawer: vi.fn() },
  customerDisplayService: { showWelcome: vi.fn() },
  updateService: { checkForUpdates: vi.fn() },
  syncScheduler: mockSyncScheduler,
};

/** Helper component that renders a hook's return value as text for assertions. */
const ValueDisplay: FC<{ hook: () => unknown; testId: string }> = ({
  hook: useHook,
  testId,
}) => {
  const value = useHook();
  return <div data-testid={testId}>{value === mockSyncScheduler ? "syncScheduler" : "other"}</div>;
};

const NopChild: FC = () => <div data-testid="child">child</div>;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useServiceContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("inside ServiceProvider", () => {
    beforeEach(() => {
      mockUseServiceInit.mockReturnValue({
        status: "ready",
        services: mockServices,
      });
    });

    it("returns the full Services object", () => {
      let returned: unknown = null;
      const Reader: FC = () => {
        returned = useServiceContext();
        return null;
      };

      render(
        <ServiceProvider>
          <Reader />
        </ServiceProvider>,
      );

      expect(returned).toBe(mockServices);
    });
  });

  describe("outside ServiceProvider", () => {
    it("throws a descriptive error", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        render(<ValueDisplay hook={useServiceContext as any} testId="x" />),
      ).toThrow("useServiceContext() must be used inside a <ServiceProvider>.");

      consoleSpy.mockRestore();
    });
  });
});

describe("useSyncSchedulerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("inside ServiceProvider", () => {
    beforeEach(() => {
      mockUseServiceInit.mockReturnValue({
        status: "ready",
        services: mockServices,
      });
    });

    it("returns the syncScheduler instance from context", () => {
      render(
        <ServiceProvider>
          <ValueDisplay hook={useSyncSchedulerService} testId="scheduler" />
        </ServiceProvider>,
      );

      expect(screen.getByTestId("scheduler")).toHaveTextContent("syncScheduler");
    });
  });

  describe("outside ServiceProvider", () => {
    it("throws a descriptive error", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        render(<ValueDisplay hook={useSyncSchedulerService} testId="x" />),
      ).toThrow("useServiceContext() must be used inside a <ServiceProvider>.");

      consoleSpy.mockRestore();
    });
  });
});
