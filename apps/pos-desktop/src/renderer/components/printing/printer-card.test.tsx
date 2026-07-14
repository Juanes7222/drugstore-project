/**
 * Component tests for PrinterCard.
 *
 * Covers: printer info display, badges, job-type chips, pending count,
 * test/delete/edit actions, delete confirmation dialog, test result feedback.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrinterCard } from "./printer-card";
import {
  PrinterStatusCode,
  PrinterType,
  PrinterConnection,
  PaperSize,
} from "../../../domain/printing/printing-types";
import type { PrinterConfigRecord } from "../../../domain/printing";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const basePrinter: PrinterConfigRecord = {
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
  assignedJobs: ["SALE_RECEIPT", "CONTINGENCY_RECEIPT"],
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
};

const defaultProps = {
  printer: basePrinter,
  pendingCount: 0,
  onTest: vi.fn<(_: string) => Promise<{ success: boolean; errorMessage?: string }>>(),
  onDelete: vi.fn<(_: string) => Promise<void>>(),
  onEdit: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PrinterCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the printer friendly name and system name", () => {
    render(<PrinterCard {...defaultProps} />);

    expect(screen.getByText("Impresora Principal")).toBeInTheDocument();
    expect(screen.getByText("EPSON-TM-T20")).toBeInTheDocument();
  });

  it("renders the printer status badge", () => {
    render(<PrinterCard {...defaultProps} />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName(/En línea/);
  });

  it("renders type, connection and paper size badges", () => {
    render(<PrinterCard {...defaultProps} />);

    expect(screen.getByText("THERMAL_RECEIPT")).toBeInTheDocument();
    expect(screen.getByText("USB")).toBeInTheDocument();
    expect(screen.getByText("RECEIPT_80MM")).toBeInTheDocument();
  });

  it("renders Color badge when printer supports color", () => {
    const colorPrinter = {
      ...basePrinter,
      supportsColor: true,
    };

    render(<PrinterCard {...defaultProps} printer={colorPrinter} />);

    expect(screen.getByText("Color")).toBeInTheDocument();
  });

  it("does not render Color badge when printer does not support color", () => {
    render(<PrinterCard {...defaultProps} />);

    expect(screen.queryByText("Color")).not.toBeInTheDocument();
  });

  it("renders assigned job types as chips", () => {
    render(<PrinterCard {...defaultProps} />);

    expect(screen.getByText("Recibo de venta")).toBeInTheDocument();
    expect(screen.getByText("Recibo contingencia")).toBeInTheDocument();
  });

  it("shows 'Sin trabajos asignados' when assignedJobs is empty", () => {
    const noJobsPrinter = {
      ...basePrinter,
      assignedJobs: [],
    };

    render(<PrinterCard {...defaultProps} printer={noJobsPrinter} />);

    expect(
      screen.getByText("Sin trabajos asignados"),
    ).toBeInTheDocument();
  });

  it("shows pending count when pendingCount > 0", () => {
    render(<PrinterCard {...defaultProps} pendingCount={5} />);

    expect(screen.getByText(/5.*pendiente/)).toBeInTheDocument();
  });

  it("does not show pending count when pendingCount is 0", () => {
    render(<PrinterCard {...defaultProps} pendingCount={0} />);

    expect(screen.queryByText(/pendiente/)).not.toBeInTheDocument();
  });

  it("calls onEdit when edit button is clicked", async () => {
    const onEdit = vi.fn();
    render(<PrinterCard {...defaultProps} onEdit={onEdit} />);

    const editButton = screen.getByRole("button", { name: /Editar/ });
    await userEvent.click(editButton);

    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("calls onTest and shows success result", async () => {
    const onTest = vi
      .fn()
      .mockResolvedValue({ success: true });
    render(<PrinterCard {...defaultProps} onTest={onTest} />);

    const testButton = screen.getByRole("button", {
      name: /Probar impresora/,
    });
    await userEvent.click(testButton);

    expect(onTest).toHaveBeenCalledWith("EPSON-TM-T20");
    await waitFor(() => {
      expect(screen.getByText(/Impresión exitosa/)).toBeInTheDocument();
    });
  });

  it("calls onTest and shows failure result", async () => {
    const onTest = vi
      .fn()
      .mockResolvedValue({ success: false, errorMessage: "Error" });
    render(<PrinterCard {...defaultProps} onTest={onTest} />);

    const testButton = screen.getByRole("button", {
      name: /Probar impresora/,
    });
    await userEvent.click(testButton);

    expect(onTest).toHaveBeenCalledWith("EPSON-TM-T20");
    await waitFor(() => {
      expect(screen.getByText(/Error al imprimir/)).toBeInTheDocument();
    });
  });

  it("shows 'Probando...' while testing", async () => {
    const onTest = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) =>
            setTimeout(() => resolve({ success: true }), 500),
          ),
      );
    render(<PrinterCard {...defaultProps} onTest={onTest} />);

    const testButton = screen.getByRole("button", {
      name: /Probar impresora/,
    });
    fireEvent.click(testButton);

    expect(screen.getByText("Probando...")).toBeInTheDocument();
  });

  it("disables test button while testing", async () => {
    const onTest = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) =>
            setTimeout(() => resolve({ success: true }), 500),
          ),
      );
    render(<PrinterCard {...defaultProps} onTest={onTest} />);

    const testButton = screen.getByRole("button", {
      name: /Probar impresora/,
    });
    fireEvent.click(testButton);
    vi.useFakeTimers();

    expect(testButton).toBeDisabled();
  });

  it("calls onTest and shows failure when the promise rejects", async () => {
    const onTest = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<PrinterCard {...defaultProps} onTest={onTest} />);

    const testButton = screen.getByRole("button", {
      name: /Probar impresora/,
    });
    await userEvent.click(testButton);

    await waitFor(() => {
      expect(screen.getByText(/Error al imprimir/)).toBeInTheDocument();
    });
  });

  it("opens delete confirmation dialog when delete button is clicked", async () => {
    render(<PrinterCard {...defaultProps} />);

    const deleteButton = screen.getByRole("button", {
      name: /Eliminar impresora/,
    });
    await userEvent.click(deleteButton);

    expect(
      screen.getByText(/¿Está seguro de eliminar/),
    ).toBeInTheDocument();
  });

  it("calls onDelete when confirm delete is clicked", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<PrinterCard {...defaultProps} onDelete={onDelete} />);

    const deleteButton = screen.getByRole("button", {
      name: /Eliminar impresora/,
    });
    await userEvent.click(deleteButton);

    const confirmButton = screen.getByRole("button", {
      name: /Eliminar/,
    });
    await userEvent.click(confirmButton);

    expect(onDelete).toHaveBeenCalledWith("printer-1");
  });

  it("shows error message when printer.lastErrorMessage exists", () => {
    const errorPrinter = {
      ...basePrinter,
      lastErrorMessage: "La impresora no responde",
    };

    render(<PrinterCard {...defaultProps} printer={errorPrinter} />);

    expect(
      screen.getByText("La impresora no responde"),
    ).toBeInTheDocument();
  });

  it("renders 'Eliminando...' while deleting", async () => {
    const onDelete = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => resolve(), 500),
          ),
      );
    render(<PrinterCard {...defaultProps} onDelete={onDelete} />);

    const deleteButton = screen.getByRole("button", {
      name: /Eliminar impresora/,
    });
    await userEvent.click(deleteButton);

    const confirmButton = screen.getByRole("button", {
      name: /Eliminar/,
    });
    fireEvent.click(confirmButton);

    expect(screen.getByText("Eliminando...")).toBeInTheDocument();
  });

  it("closes the dialog after successful delete", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<PrinterCard {...defaultProps} onDelete={onDelete} />);

    const deleteButton = screen.getByRole("button", {
      name: /Eliminar impresora/,
    });
    await userEvent.click(deleteButton);

    expect(
      screen.getByText(/¿Está seguro de eliminar/),
    ).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", {
      name: /Eliminar/,
    });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(
        screen.queryByText(/¿Está seguro de eliminar/),
      ).not.toBeInTheDocument();
    });
  });
});
