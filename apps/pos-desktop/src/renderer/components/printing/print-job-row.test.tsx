/**
 * Component tests for PrintJobRow.
 *
 * Covers: document info rendering, status badge, timestamps, cancel/retry actions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintJobRow } from "./print-job-row";
import {
  PrintJobStatus,
  PrintJobType,
  PrintPayloadType,
} from "../../../domain/printing/printing-types";
import type { PrintJobRecord } from "../../../domain/printing";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const baseJob = (
  overrides: Partial<PrintJobRecord> = {},
): PrintJobRecord => ({
  id: "job-1",
  jobType: PrintJobType.SALE_RECEIPT,
  printerConfigId: "printer-1",
  payloadPath: "/tmp/receipt-123.pdf",
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

const defaultProps = {
  job: baseJob(),
  onRetry: vi.fn<(_: string) => Promise<void>>(),
  onDiscard: vi.fn<(_: string) => Promise<void>>(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrintJobRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the job type label", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(screen.getByText("Recibo de venta")).toBeInTheDocument();
  });

  it("renders the attempt counter", () => {
    render(<PrintJobRow {...defaultProps} job={baseJob({ attempts: 3 })} />);

    expect(screen.getByText(/Intento 3/)).toBeInTheDocument();
  });

  it("renders the created timestamp", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(screen.getByText(/Creado:/)).toBeInTheDocument();
  });

  it("renders the completed timestamp when job is completed", () => {
    const completedJob = baseJob({
      status: PrintJobStatus.COMPLETED,
      completedAt: new Date("2026-07-13T09:35:00Z"),
    });

    render(<PrintJobRow {...defaultProps} job={completedJob} />);

    expect(screen.getByText(/Completado:/)).toBeInTheDocument();
  });

  it("does not render completed timestamp when job has no completedAt", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(screen.queryByText(/Completado:/)).not.toBeInTheDocument();
  });

  it("shows the status badge for PENDING status", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(screen.getByText("Pendiente")).toBeInTheDocument();
  });

  it("shows the status badge for FAILED status", () => {
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    render(<PrintJobRow {...defaultProps} job={failedJob} />);

    expect(screen.getByText("Fallido")).toBeInTheDocument();
  });

  it("shows the status badge for COMPLETED status", () => {
    const completedJob = baseJob({ status: PrintJobStatus.COMPLETED });

    render(<PrintJobRow {...defaultProps} job={completedJob} />);

    expect(screen.getByText("Completado")).toBeInTheDocument();
  });

  it("shows the status badge for DISCARDED status", () => {
    const discardedJob = baseJob({ status: PrintJobStatus.DISCARDED });

    render(<PrintJobRow {...defaultProps} job={discardedJob} />);

    expect(screen.getByText("Descartado")).toBeInTheDocument();
  });

  it("shows the status badge for PRINTING status", () => {
    const printingJob = baseJob({ status: PrintJobStatus.PRINTING });

    render(<PrintJobRow {...defaultProps} job={printingJob} />);

    expect(screen.getByText("Imprimiendo")).toBeInTheDocument();
  });

  it("shows the status badge for RETRYING status", () => {
    const retryingJob = baseJob({ status: PrintJobStatus.RETRYING });

    render(<PrintJobRow {...defaultProps} job={retryingJob} />);

    expect(screen.getByText("Reintentando")).toBeInTheDocument();
  });

  it("shows retry button for failed jobs", () => {
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    render(<PrintJobRow {...defaultProps} job={failedJob} />);

    expect(
      screen.getByRole("button", { name: /Reintentar impresión/ }),
    ).toBeInTheDocument();
  });

  it("does not show retry button for completed jobs", () => {
    const completedJob = baseJob({ status: PrintJobStatus.COMPLETED });

    render(<PrintJobRow {...defaultProps} job={completedJob} />);

    expect(
      screen.queryByRole("button", { name: /Reintentar impresión/ }),
    ).not.toBeInTheDocument();
  });

  it("does not show retry button for discarded jobs", () => {
    const discardedJob = baseJob({ status: PrintJobStatus.DISCARDED });

    render(<PrintJobRow {...defaultProps} job={discardedJob} />);

    expect(
      screen.queryByRole("button", { name: /Reintentar impresión/ }),
    ).not.toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    render(
      <PrintJobRow {...defaultProps} job={failedJob} onRetry={onRetry} />,
    );

    const retryButton = screen.getByRole("button", {
      name: /Reintentar impresión/,
    });
    await userEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledWith("job-1");
  });

  it("shows discard button for pending jobs", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: /Descartar trabajo/ }),
    ).toBeInTheDocument();
  });

  it("shows discard button for failed jobs", () => {
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    render(<PrintJobRow {...defaultProps} job={failedJob} />);

    expect(
      screen.getByRole("button", { name: /Descartar trabajo/ }),
    ).toBeInTheDocument();
  });

  it("does not show discard button for completed jobs", () => {
    const completedJob = baseJob({ status: PrintJobStatus.COMPLETED });

    render(<PrintJobRow {...defaultProps} job={completedJob} />);

    expect(
      screen.queryByRole("button", { name: /Descartar trabajo/ }),
    ).not.toBeInTheDocument();
  });

  it("shows last error message when present", () => {
    const failedJob = baseJob({
      status: PrintJobStatus.FAILED,
      lastError: "Error de conexión con la impresora",
    });

    render(<PrintJobRow {...defaultProps} job={failedJob} />);

    expect(
      screen.getByText("Error de conexión con la impresora"),
    ).toBeInTheDocument();
  });

  it("opens discard confirmation dialog", async () => {
    render(<PrintJobRow {...defaultProps} />);

    const discardButton = screen.getByRole("button", {
      name: /Descartar trabajo/,
    });
    await userEvent.click(discardButton);

    expect(
      screen.getByText(/¿Está seguro de descartar este trabajo/),
    ).toBeInTheDocument();
  });

  it("calls onDiscard when discard is confirmed", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    render(
      <PrintJobRow {...defaultProps} onDiscard={onDiscard} />,
    );

    const discardButton = screen.getByRole("button", {
      name: /Descartar trabajo/,
    });
    await userEvent.click(discardButton);

    const confirmButton = screen.getByRole("button", {
      name: /Descartar/,
    });
    await userEvent.click(confirmButton);

    expect(onDiscard).toHaveBeenCalledWith("job-1");
  });

  it("renders routing log toggle when routingLog is present", () => {
    const jobWithLog = baseJob({ routingLog: "Routed to printer-1" });

    render(<PrintJobRow {...defaultProps} job={jobWithLog} />);

    expect(
      screen.getByText("Bitácora de enrutamiento"),
    ).toBeInTheDocument();
  });

  it("does not render routing log toggle when routingLog is null", () => {
    render(<PrintJobRow {...defaultProps} />);

    expect(
      screen.queryByText("Bitácora de enrutamiento"),
    ).not.toBeInTheDocument();
  });

  it("has a red left border for FAILED jobs", () => {
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    const { container } = render(
      <PrintJobRow {...defaultProps} job={failedJob} />,
    );

    const row = container.querySelector('[class*="border-l-red"]');
    expect(row).toBeInTheDocument();
  });

  it("shows retrying indicator while retrying", async () => {
    const onRetry = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => resolve(), 500),
          ),
      );
    const failedJob = baseJob({ status: PrintJobStatus.FAILED });

    render(
      <PrintJobRow
        {...defaultProps}
        job={failedJob}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", {
      name: /Reintentar impresión/,
    });
    fireEvent.click(retryButton);

    expect(screen.getByText("...")).toBeInTheDocument();
  });
});
