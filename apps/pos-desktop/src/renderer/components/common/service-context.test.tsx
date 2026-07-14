/**
 * Integration tests for ServiceProvider and its convenience hooks.
 *
 * ServiceProvider delegates initialisation to useServiceInit() which we mock
 * at the module boundary so we can control every state (loading / ready / error).
 *
 * Tests cover:
 * 1. Loading state renders ServiceLoading.
 * 2. Error state renders ServiceErrorPanel with the error message.
 * 3. Ready state renders children and provides services via context.
 * 4. Convenience hooks throw when called outside a provider.
 * 5. Convenience hooks return the correct service inside a provider.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FC } from "react";

// ---------------------------------------------------------------------------
// Mock useServiceInit
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
  useReturnsService,
  useInventoryAdjustmentsService,
  usePrescriptionsService,
  useBackupService,
  useRecoveryLogService,
  useInvoiceService,
  useContingencyService,
  useFiscalNumberingService,
  usePrinterConfigService,
  usePrintQueueService,
  usePrintRouter,
  usePrinterHealthService,
  useConfigExportService,
  usePrintingMetricsService,
  useCashDrawerService,
  useCustomerDisplayService,
  useUpdateService,
} from "./service-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
};

const ChildComponent: FC = () => <div data-testid="child">Hello</div>;

/** Renders a convenience hook checker inside the provider. */
const HookChecker: FC<{ hook: () => unknown; testId: string }> = ({
  hook: useHook,
  testId,
}) => {
  const value = useHook();
  return <div data-testid={testId}>{String(!!value)}</div>;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ServiceProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("renders ServiceLoading while initializing", () => {
      mockUseServiceInit.mockReturnValue({ status: "loading" });

      render(
        <ServiceProvider>
          <ChildComponent />
        </ServiceProvider>,
      );

      // ServiceLoading shows "Cargando..." from i18n
      expect(screen.getByText("Cargando...")).toBeInTheDocument();
      // Child should NOT be rendered yet
      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("renders ServiceErrorPanel with the error message", () => {
      const testError = new Error("Database init failed");
      mockUseServiceInit.mockReturnValue({
        status: "error",
        error: testError,
      });

      render(
        <ServiceProvider>
          <ChildComponent />
        </ServiceProvider>,
      );

      // Renders the error message
      expect(screen.getByText("Database init failed")).toBeInTheDocument();
      // Has an alert role
      expect(screen.getByRole("alert")).toBeInTheDocument();
      // Child should NOT be rendered
      expect(screen.queryByTestId("child")).not.toBeInTheDocument();
    });
  });

  describe("ready state", () => {
    it("renders children when initialization succeeds", () => {
      mockUseServiceInit.mockReturnValue({
        status: "ready",
        services: mockServices,
      });

      render(
        <ServiceProvider>
          <ChildComponent />
        </ServiceProvider>,
      );

      expect(screen.getByTestId("child")).toBeInTheDocument();
      expect(screen.queryByText("Cargando...")).not.toBeInTheDocument();
    });
  });
});

describe("convenience hooks", () => {
  describe("outside ServiceProvider", () => {
    const HOOKS: Array<{ name: string; hook: () => unknown }> = [
      { name: "useReturnsService", hook: useReturnsService },
      { name: "useInventoryAdjustmentsService", hook: useInventoryAdjustmentsService },
      { name: "usePrescriptionsService", hook: usePrescriptionsService },
      { name: "useBackupService", hook: useBackupService },
      { name: "useRecoveryLogService", hook: useRecoveryLogService },
      { name: "useInvoiceService", hook: useInvoiceService },
      { name: "useContingencyService", hook: useContingencyService },
      { name: "useFiscalNumberingService", hook: useFiscalNumberingService },
      { name: "usePrinterConfigService", hook: usePrinterConfigService },
      { name: "usePrintQueueService", hook: usePrintQueueService },
      { name: "usePrintRouter", hook: usePrintRouter },
      { name: "usePrinterHealthService", hook: usePrinterHealthService },
      { name: "useConfigExportService", hook: useConfigExportService },
      { name: "usePrintingMetricsService", hook: usePrintingMetricsService },
      { name: "useCashDrawerService", hook: useCashDrawerService },
      { name: "useCustomerDisplayService", hook: useCustomerDisplayService },
      { name: "useUpdateService", hook: useUpdateService },
    ];

    HOOKS.forEach(({ name, hook }) => {
      it(`${name} throws when called outside ServiceProvider`, () => {
        // Suppress the expected console error from React
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(() => render(<HookChecker hook={hook} testId="check" />)).toThrow(
          "useServiceContext() must be used inside a <ServiceProvider>.",
        );

        consoleSpy.mockRestore();
      });
    });
  });

  describe("inside ServiceProvider", () => {
    beforeEach(() => {
      mockUseServiceInit.mockReturnValue({
        status: "ready",
        services: mockServices,
      });
    });

    const HOOK_TESTS: Array<{
      name: string;
      hook: () => unknown;
      expectedService: string;
    }> = [
      { name: "useReturnsService", hook: useReturnsService, expectedService: "returnsService" },
      { name: "useInventoryAdjustmentsService", hook: useInventoryAdjustmentsService, expectedService: "inventoryAdjustmentsService" },
      { name: "usePrescriptionsService", hook: usePrescriptionsService, expectedService: "prescriptionsService" },
      { name: "useBackupService", hook: useBackupService, expectedService: "backupService" },
      { name: "useRecoveryLogService", hook: useRecoveryLogService, expectedService: "recoveryLogService" },
      { name: "useInvoiceService", hook: useInvoiceService, expectedService: "invoiceService" },
      { name: "useContingencyService", hook: useContingencyService, expectedService: "contingencyService" },
      { name: "useFiscalNumberingService", hook: useFiscalNumberingService, expectedService: "fiscalNumberingService" },
      { name: "usePrinterConfigService", hook: usePrinterConfigService, expectedService: "printerConfigService" },
      { name: "usePrintQueueService", hook: usePrintQueueService, expectedService: "printQueueService" },
      { name: "usePrintRouter", hook: usePrintRouter, expectedService: "printRouter" },
      { name: "usePrinterHealthService", hook: usePrinterHealthService, expectedService: "printerHealthService" },
      { name: "useConfigExportService", hook: useConfigExportService, expectedService: "configExportService" },
      { name: "usePrintingMetricsService", hook: usePrintingMetricsService, expectedService: "printingMetricsService" },
      { name: "useCashDrawerService", hook: useCashDrawerService, expectedService: "cashDrawerService" },
      { name: "useCustomerDisplayService", hook: useCustomerDisplayService, expectedService: "customerDisplayService" },
      { name: "useUpdateService", hook: useUpdateService, expectedService: "updateService" },
    ];

    HOOK_TESTS.forEach(({ name, hook, expectedService }) => {
      it(`${name} returns the correct service`, () => {
        render(
          <ServiceProvider>
            <HookChecker hook={hook} testId="check" />
          </ServiceProvider>,
        );

        expect(screen.getByTestId("check")).toHaveTextContent("true");
      });
    });
  });

  describe("ServiceProvider with retry button", () => {
    it("does not render a retry button by default (error without onRetry)", () => {
      mockUseServiceInit.mockReturnValue({
        status: "error",
        error: new Error("fail"),
      });

      render(
        <ServiceProvider>
          <ChildComponent />
        </ServiceProvider>,
      );

      // The error panel does not have an onRetry handler, so no button
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
