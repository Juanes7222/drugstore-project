/**
 * Component tests for PrintersPage.
 *
 * Covers: printer card list, loading state, empty state, add printer button.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PrintersPage } from "./printers.page";
import type { PrinterConfigRecord } from "../../../domain/printing";
import {
  PrinterStatusCode,
  PrinterType,
  PrinterConnection,
  PaperSize,
} from "../../../domain/printing/printing-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListAll = vi.fn();
const mockCountPendingForPrinter = vi.fn();
const mockExportConfig = vi.fn();

vi.mock("../common/service-context", () => ({
  usePrinterConfigService: () => ({
    listAll: mockListAll,
  }),
  usePrintQueueService: () => ({
    countPendingForPrinter: mockCountPendingForPrinter,
  }),
  useConfigExportService: () => ({
    exportConfig: mockExportConfig,
  }),
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const basePrinter = (
  overrides: Partial<PrinterConfigRecord> = {},
): PrinterConfigRecord => ({
  id: "printer-1",
  friendlyName: "Impresora Principal",
  systemName: "EPSON-TM-T20",
  printerType: PrinterType.THERMAL_RECEIPT,
  connection: PrinterConnection.USB,
  paperSize: PaperSize.RECEIPT_80MM,
  customPaperWidthMm: null,
  customPaperHeightMm: null,
  supportsColor: false,
  supportsDuplex: false,
  assignedJobs: ["SALE_RECEIPT"],
  fallbackPrinterId: null,
  serverFallbackEnabled: false,
  cashDrawerConfig: null,
  customerDisplayConfig: null,
  receiptTemplateId: null,
  status: PrinterStatusCode.ONLINE,
  lastStatusCheck: new Date("2026-07-13T10:00:00Z"),
  lastErrorMessage: null,
  createdAt: new Date("2026-07-10T08:00:00Z"),
  updatedAt: new Date("2026-07-13T10:00:00Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrintersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockListAll.mockReturnValue(new Promise(() => {}));

    render(<PrintersPage />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders printer cards when printers are loaded", async () => {
    const printers = [
      basePrinter({ id: "p1", friendlyName: "Impresora Principal" }),
      basePrinter({
        id: "p2",
        friendlyName: "Impresora Secundaria",
        systemName: "EPSON-TM-T88",
      }),
    ];

    mockListAll.mockResolvedValue(printers);
    mockCountPendingForPrinter.mockResolvedValue(0);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Impresora Principal"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("EPSON-TM-T20")).toBeInTheDocument();
    expect(screen.getByText("Impresora Secundaria")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T88")).toBeInTheDocument();
  });

  it("shows empty state when no printers are configured", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No hay impresoras configuradas"),
      ).toBeInTheDocument();
    });
  });

  it("renders the add printer button", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Añadir impresora"),
      ).toBeInTheDocument();
    });
  });

  it("renders the export button", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(screen.getByText("Exportar")).toBeInTheDocument();
    });
  });

  it("renders the title", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Impresoras configuradas"),
      ).toBeInTheDocument();
    });
  });

  it("renders with a section aria-label", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      const section = screen.getByLabelText("Impresoras");
      expect(section).toBeInTheDocument();
    });
  });

  it("handles API error gracefully", async () => {
    mockListAll.mockRejectedValue(new Error("Network error"));

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("No hay impresoras configuradas"),
      ).toBeInTheDocument();
    });
  });

  it("renders the import label", async () => {
    mockListAll.mockResolvedValue([]);

    render(<PrintersPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Importar configuración"),
      ).toBeInTheDocument();
    });
  });

  it("renders status badges for each printer", async () => {
    const printers = [
      basePrinter({ id: "p1", status: PrinterStatusCode.ONLINE }),
      basePrinter({
        id: "p2",
        status: PrinterStatusCode.OFFLINE,
        friendlyName: "Offline Printer",
      }),
    ];

    mockListAll.mockResolvedValue(printers);
    mockCountPendingForPrinter.mockResolvedValue(0);

    render(<PrintersPage />);

    await waitFor(() => {
      const badges = screen.getAllByRole("status");
      expect(badges.length).toBe(2);
    });

    expect(screen.getByText("En línea")).toBeInTheDocument();
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
  });
});
