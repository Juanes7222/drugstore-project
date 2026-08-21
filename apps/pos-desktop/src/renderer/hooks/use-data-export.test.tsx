/**
 * Tests for the useDataExport hook — document assembly, service handoff,
 * error propagation, and the isExporting toggle.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SALES_HISTORY_EXPORT } from "../../domain/export";
import type { SaleHistoryListItem } from "../../domain/sales-pos/sales-history.service";
import { useDataExport } from "./use-data-export";

const {
  mockT,
  mockI18n,
  mockExportService,
  mockListConfirmedSales,
  mockSession,
} = vi.hoisted(() => ({
  mockT: vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  ),
  mockI18n: { language: "es" },
  mockExportService: { exportAndDownload: vi.fn() },
  mockListConfirmedSales: vi.fn(),
  mockSession: {
    session: { displayName: "Cashier One" } as { displayName: string } | null,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: mockI18n }),
}));

vi.mock("../components/common/service-context", () => ({
  useDataExportService: () => mockExportService,
  useServiceContext: () => ({
    salesHistoryService: { listConfirmedSales: mockListConfirmedSales },
  }),
}));

vi.mock("../../domain/auth/local-session.store", () => ({
  useLocalSessionStore: (
    selector: (state: { session: { displayName: string } | null }) => unknown,
  ) => selector({ session: mockSession.session }),
}));

function saleItem(
  overrides: Partial<SaleHistoryListItem> = {},
): SaleHistoryListItem {
  return {
    saleId: "sale-1",
    localNumber: "LN-0001",
    confirmedAt: "2026-08-21T10:00:00.000Z",
    totalAmount: "50000.00",
    clientName: "Ana Pérez",
    clientIdentificationNumber: "123456789",
    invoiceId: "inv-1",
    invoiceNumber: "INV-0001",
    invoiceStatus: "ISSUED",
    invoiceType: "POS",
    hasAdjustments: false,
    deliveryFeeCents: 2500,
    deliveryAddress: null,
    ...overrides,
  };
}

describe("useDataExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockI18n.language = "es";
    mockSession.session = { displayName: "Cashier One" };
    mockExportService.exportAndDownload.mockResolvedValue(
      "C:\\exports\\sales-history.csv",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the export document and hands it to the service with the definition key", async () => {
    mockListConfirmedSales.mockResolvedValue({
      items: [saleItem()],
      total: 1,
    });

    const { result } = renderHook(() =>
      useDataExport(SALES_HISTORY_EXPORT, { query: "ana" }),
    );

    await act(async () => {
      await result.current.exportTo("csv");
    });

    expect(mockListConfirmedSales).toHaveBeenCalledWith({
      limit: 500,
      offset: 0,
      query: "ana",
    });
    expect(mockExportService.exportAndDownload).toHaveBeenCalledWith({
      format: "csv",
      filenamePrefix: "sales-history",
      document: {
        titleKey: "export.screens.salesHistory.title",
        titleFallback: "Historial de ventas",
        columns: SALES_HISTORY_EXPORT.columns,
        rows: [
          {
            confirmedAt: "2026-08-21T10:00:00.000Z",
            localNumber: "LN-0001",
            clientName: "Ana Pérez",
            clientIdentificationNumber: "123456789",
            totalAmount: "50000.00",
            invoiceNumber: "INV-0001",
            invoiceStatus: "ISSUED",
            deliveryFee: 25,
          },
        ],
        t: mockT,
        locale: "es-CO",
        userDisplayName: "Cashier One",
        metadata: [["export.meta.search", "Búsqueda", "ana"]],
      },
    });
  });

  it("uses the en-US locale when the active language is English", async () => {
    mockI18n.language = "en";
    mockListConfirmedSales.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() =>
      useDataExport(SALES_HISTORY_EXPORT, {}),
    );

    await act(async () => {
      await result.current.exportTo("excel");
    });

    expect(mockExportService.exportAndDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ locale: "en-US" }),
      }),
    );
  });

  it("omits the user display name when there is no active session", async () => {
    mockSession.session = null;
    mockListConfirmedSales.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() =>
      useDataExport(SALES_HISTORY_EXPORT, {}),
    );

    await act(async () => {
      await result.current.exportTo("csv");
    });

    expect(mockExportService.exportAndDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ userDisplayName: undefined }),
      }),
    );
  });

  it("sets the error message when the dataset loader rejects", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockListConfirmedSales.mockRejectedValue(new Error("database unavailable"));

    const { result } = renderHook(() =>
      useDataExport(SALES_HISTORY_EXPORT, {}),
    );

    await act(async () => {
      await result.current.exportTo("csv");
    });

    expect(result.current.error).toBe("database unavailable");
    expect(mockExportService.exportAndDownload).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("toggles isExporting while the export is in flight", async () => {
    let resolveExport: ((path: string | null) => void) | undefined;
    mockExportService.exportAndDownload.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    mockListConfirmedSales.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() =>
      useDataExport(SALES_HISTORY_EXPORT, {}),
    );

    act(() => {
      void result.current.exportTo("pdf");
    });

    expect(result.current.isExporting).toBe(true);

    await waitFor(() => {
      expect(resolveExport).toBeDefined();
    });

    await act(async () => {
      resolveExport?.("C:\\exports\\sales-history.pdf");
    });

    expect(result.current.isExporting).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
