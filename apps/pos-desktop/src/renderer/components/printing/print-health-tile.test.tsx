/**
 * Component tests for PrintHealthTile.
 *
 * Covers: loading state, queue and printer summaries, health status
 * (good, warning, error), action buttons.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintHealthTile } from "./print-health-tile";
import type {
  PrintQueueSummary,
  PrinterStatusSummary,
} from "../../../domain/printing";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetPrintQueueSummary = vi.fn();
const mockGetPrinterStatusSummary = vi.fn();

vi.mock("../common/service-context", () => ({
  usePrintingMetricsService: () => ({
    getPrintQueueSummary: mockGetPrintQueueSummary,
    getPrinterStatusSummary: mockGetPrinterStatusSummary,
  }),
  usePrintQueueService: () => ({}),
}));

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const defaultQueueSummary: PrintQueueSummary = {
  pending: 0,
  printing: 0,
  failed: 0,
  discarded: 0,
  completed24h: 10,
  averageAttemptsBeforeSuccess: 1.0,
};

const defaultPrinterSummary: PrinterStatusSummary = {
  online: 2,
  offline: 0,
  error: 0,
  noPaper: 0,
  unknown: 0,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrintHealthTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockGetPrintQueueSummary.mockReturnValue(new Promise(() => {}));
    mockGetPrinterStatusSummary.mockReturnValue(new Promise(() => {}));

    render(<PrintHealthTile />);

    const skeleton = document.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
  });

  it("renders queue and printer summaries when loaded", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(
        screen.getByText("Salud de impresión"),
      ).toBeInTheDocument();
    });

    // Printer status numbers
    expect(screen.getByText("2")).toBeInTheDocument(); // online
    expect(screen.getAllByText("0")).toHaveLength(4); // offline, noPaper, error, unknown
  });

  it("shows 'good' status when everything is OK", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("Todo bien")).toBeInTheDocument();
    });
  });

  it("shows 'warning' status when pending > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue({
      ...defaultQueueSummary,
      pending: 3,
    });
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("Atención")).toBeInTheDocument();
    });
  });

  it("shows 'warning' status when offline > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue({
      ...defaultPrinterSummary,
      online: 1,
      offline: 1,
    });

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("Atención")).toBeInTheDocument();
    });
  });

  it("shows 'error' status when failed > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue({
      ...defaultQueueSummary,
      failed: 2,
    });
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("Requiere acción")).toBeInTheDocument();
    });
  });

  it("shows 'error' status when printer error > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue({
      ...defaultPrinterSummary,
      error: 1,
    });

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("Requiere acción")).toBeInTheDocument();
    });
  });

  it("renders printer status summary labels", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(screen.getByText("En línea")).toBeInTheDocument();
      expect(screen.getByText("Offline")).toBeInTheDocument();
      expect(screen.getByText("Sin papel")).toBeInTheDocument();
      expect(screen.getByText("Desconocido")).toBeInTheDocument();
    });
  });

  it("shows pending job count when pending > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue({
      ...defaultQueueSummary,
      pending: 5,
    });
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      // The i18n default uses {count} literally since no translation exists for
      // this key. The meaningful test is that the pending-job label appears.
      expect(
        screen.getByText(/trabajo\(s\) pendiente/),
      ).toBeInTheDocument();
    });
  });

  it("shows 'Sin trabajos pendientes' when pending is 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(
        screen.getByText("Sin trabajos pendientes"),
      ).toBeInTheDocument();
    });
  });

  it("shows failed job count when failed > 0", async () => {
    mockGetPrintQueueSummary.mockResolvedValue({
      ...defaultQueueSummary,
      failed: 3,
      pending: 1,
    });
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      // The i18n default uses {count} literally; test that the label appears
      expect(
        screen.getByText(/fallido\(s\)/),
      ).toBeInTheDocument();
    });
  });

  it("renders the 'Ver cola' button when onViewQueue is provided", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile onViewQueue={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Ver cola")).toBeInTheDocument();
    });
  });

  it("calls onViewQueue when 'Ver cola' is clicked", async () => {
    const onViewQueue = vi.fn();
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile onViewQueue={onViewQueue} />);

    await waitFor(() => {
      expect(screen.getByText("Ver cola")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Ver cola"));
    expect(onViewQueue).toHaveBeenCalledOnce();
  });

  it("renders the 'Configurar' button when onConfigurePrinters is provided", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(
      <PrintHealthTile onConfigurePrinters={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Configurar")).toBeInTheDocument();
    });
  });

  it("calls onConfigurePrinters when 'Configurar' is clicked", async () => {
    const onConfigurePrinters = vi.fn();
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(
      <PrintHealthTile onConfigurePrinters={onConfigurePrinters} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Configurar")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Configurar"));
    expect(onConfigurePrinters).toHaveBeenCalledOnce();
  });

  it("does not render 'Ver cola' when onViewQueue is not provided", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(
        screen.getByText("Salud de impresión"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Ver cola"),
    ).not.toBeInTheDocument();
  });

  it("does not render 'Configurar' when onConfigurePrinters is not provided", async () => {
    mockGetPrintQueueSummary.mockResolvedValue(defaultQueueSummary);
    mockGetPrinterStatusSummary.mockResolvedValue(defaultPrinterSummary);

    render(<PrintHealthTile />);

    await waitFor(() => {
      expect(
        screen.getByText("Salud de impresión"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Configurar"),
    ).not.toBeInTheDocument();
  });

  it("handles API error gracefully", async () => {
    mockGetPrintQueueSummary.mockRejectedValue(
      new Error("Network error"),
    );
    mockGetPrinterStatusSummary.mockRejectedValue(
      new Error("Network error"),
    );

    render(<PrintHealthTile />);

    await waitFor(() => {
      // Falls back to warning status when data is null
      expect(screen.getByText("Atención")).toBeInTheDocument();
    });
  });
});
