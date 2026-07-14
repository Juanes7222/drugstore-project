/**
 * Component tests for PrintQueuePage.
 *
 * Covers: summary bar rendering, job list, loading state, empty state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PrintQueuePage } from "./print-queue.page";
import type { PrintJobRecord, PrintQueueSummary } from "../../../domain/printing";
import {
  PrintJobStatus,
  PrintJobType,
  PrintPayloadType,
} from "../../../domain/printing/printing-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockListJobs = vi.fn();
const mockGetPrintQueueSummary = vi.fn();
const mockRetryJob = vi.fn();
const mockDiscardJob = vi.fn();
const mockProcessAllPending = vi.fn();

vi.mock("../common/service-context", () => ({
  usePrintQueueService: () => ({
    listJobs: mockListJobs,
    retryJob: mockRetryJob,
    discardJob: mockDiscardJob,
    processAllPending: mockProcessAllPending,
  }),
  usePrintingMetricsService: () => ({
    getPrintQueueSummary: mockGetPrintQueueSummary,
  }),
}));

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const baseJob = (overrides: Partial<PrintJobRecord> = {}): PrintJobRecord => ({
  id: "job-1",
  jobType: PrintJobType.SALE_RECEIPT,
  printerConfigId: "printer-1",
  payloadPath: "/tmp/receipt.pdf",
  payloadType: PrintPayloadType.PDF,
  templateVariables: null,
  status: PrintJobStatus.PENDING,
  attempts: 1,
  lastError: null,
  nextRetryAt: null,
  createdAt: new Date("2026-07-13T09:30:00Z"),
  completedAt: null,
  createdBySaleId: "sale-1",
  createdByUserId: "user-1",
  routingLog: null,
  ...overrides,
});

const defaultSummary: PrintQueueSummary = {
  pending: 3,
  printing: 1,
  failed: 2,
  discarded: 0,
  completed24h: 15,
  averageAttemptsBeforeSuccess: 1.2,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrintQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    // Never resolve the promises so it stays in loading state
    mockListJobs.mockReturnValue(new Promise(() => {}));
    mockGetPrintQueueSummary.mockReturnValue(new Promise(() => {}));

    render(<PrintQueuePage />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders the summary bar with summary data", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Cola de impresión")).toBeInTheDocument();
    });

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("renders job list with items", async () => {
    const jobs = [
      baseJob({ id: "job-1", status: PrintJobStatus.PENDING }),
      baseJob({
        id: "job-2",
        status: PrintJobStatus.COMPLETED,
        jobType: PrintJobType.ELECTRONIC_INVOICE,
      }),
    ];
    mockListJobs.mockResolvedValue({ items: jobs });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Recibo de venta")).toBeInTheDocument();
    });

    expect(screen.getByText("Factura electrónica")).toBeInTheDocument();
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
  });

  it("shows empty state when there are no jobs", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(
        screen.getByText("No hay trabajos en la cola"),
      ).toBeInTheDocument();
    });
  });

  it("renders filter buttons", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Todos")).toBeInTheDocument();
    });

    // Filter labels use the raw filter name as default i18n value
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Discarded")).toBeInTheDocument();
  });

  it("renders the refresh button", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Actualizar")).toBeInTheDocument();
    });
  });

  it("renders the retry all button", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Reintentar todos")).toBeInTheDocument();
    });
  });

  it("calls processAllPending when retry all is clicked", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);
    mockProcessAllPending.mockResolvedValue(undefined);

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Reintentar todos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Reintentar todos"));

    expect(mockProcessAllPending).toHaveBeenCalled();
  });

  it("shows 'Procesando...' while processing all", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);
    mockProcessAllPending.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(() => resolve(), 500)),
    );

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(screen.getByText("Reintentar todos")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Reintentar todos"));

    expect(screen.getByText("Procesando...")).toBeInTheDocument();
  });

  it("renders with a section aria-label", async () => {
    mockListJobs.mockResolvedValue({ items: [] });
    mockGetPrintQueueSummary.mockResolvedValue(defaultSummary);

    render(<PrintQueuePage />);

    await waitFor(() => {
      const section = screen.getByLabelText("Cola de impresión");
      expect(section).toBeInTheDocument();
    });
  });

  it("handles API error gracefully", async () => {
    mockListJobs.mockRejectedValue(new Error("Network error"));
    mockGetPrintQueueSummary.mockRejectedValue(new Error("Network error"));

    render(<PrintQueuePage />);

    await waitFor(() => {
      expect(
        screen.getByText("No hay trabajos en la cola"),
      ).toBeInTheDocument();
    });
  });
});
