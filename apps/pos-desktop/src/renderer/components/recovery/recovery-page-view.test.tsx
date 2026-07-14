/**
 * Component tests for RecoveryPageView.
 *
 * Covers: loading state, error state, backup list, empty backups,
 * select/restore flow, tabs, status banners, restore modal.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecoveryPageView } from "./recovery-page-view";
import type { BackupViewModel } from "./recovery-page-view";
import type { RecoveryLogEntry } from "../../../domain/backup/recovery-log.service";
import type { VerificationReport } from "../../../domain/backup/backup.service";
import "@/i18n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createBackup = (
  overrides: Partial<BackupViewModel> = {},
): BackupViewModel => ({
  id: "backup-1",
  createdAt: "2026-07-13T08:00:00.000Z",
  reason: "SHIFT_CLOSE",
  sizeBytes: 1048576,
  pendingCount: 3,
  failedCount: 0,
  status: "HEALTHY",
  ageText: "hace 2 h",
  isVerifying: false,
  ...overrides,
});

const createLogEntry = (
  overrides: Partial<RecoveryLogEntry> = {},
): RecoveryLogEntry =>
  ({
    id: "log-1",
    at: new Date("2026-07-13T10:00:00.000Z"),
    action: "BACKUP_CREATED",
    actorUserId: "user-001",
    backupId: "backup-1",
    ...overrides,
  }) as RecoveryLogEntry;

const defaultProps = {
  loading: false,
  error: null,
  healthStatus: "HEALTHY" as const,
  backupHealth: "HEALTHY" as const,
  backups: [
    createBackup(),
    createBackup({ id: "backup-2", reason: "MANUAL" }),
  ],
  logEntries: [
    createLogEntry(),
    createLogEntry({ id: "log-2", action: "BACKUP_VERIFIED" }),
  ],
  activeTab: "backups" as const,
  selectedBackup: null,
  verifyReport: null,
  restoreConfirmText: "",
  isRestoring: false,
  isCreatingBackup: false,
  gapHint: null,
  onRefresh: vi.fn(),
  onCreateBackup: vi.fn(),
  onVerify: vi.fn(),
  onSelectBackup: vi.fn(),
  onRestore: vi.fn(),
  onCancelRestore: vi.fn(),
  onConfirmTextChange: vi.fn(),
  onTabChange: vi.fn(),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("RecoveryPageView", () => {
  it("shows loading state when loading is true", () => {
    render(<RecoveryPageView {...defaultProps} loading />);

    expect(
      screen.getByText("Cargando datos de recuperación…"),
    ).toBeInTheDocument();
  });

  it("shows error state when error is provided", () => {
    render(
      <RecoveryPageView {...defaultProps} error="Error de conexión" />,
    );

    expect(screen.getByText("Error de conexión")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Reintentar/ }),
    ).toBeInTheDocument();
  });

  it("calls onRefresh when retry button clicked in error state", () => {
    const onRefresh = vi.fn();
    render(
      <RecoveryPageView
        {...defaultProps}
        error="Error"
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders the page title", () => {
    render(<RecoveryPageView {...defaultProps} />);

    expect(
      screen.getByText("Recuperación ante desastres"),
    ).toBeInTheDocument();
  });

  it("shows healthy status banner", () => {
    render(<RecoveryPageView {...defaultProps} healthStatus="HEALTHY" />);

    expect(
      screen.getByText("Base de datos saludable"),
    ).toBeInTheDocument();
  });

  it("shows unhealthy shutdown status banner", () => {
    render(
      <RecoveryPageView
        {...defaultProps}
        healthStatus="UNHEALTHY_SHUTDOWN"
      />,
    );

    expect(
      screen.getByText("Apagado incorrecto detectado - revise el estado"),
    ).toBeInTheDocument();
  });

  it("shows integrity failure status banner", () => {
    render(
      <RecoveryPageView
        {...defaultProps}
        healthStatus="INTEGRITY_FAILED"
      />,
    );

    expect(
      screen.getByText("Fallo de integridad - se requiere restauración"),
    ).toBeInTheDocument();
  });

  it("shows backup health critical banner", () => {
    render(
      <RecoveryPageView {...defaultProps} backupHealth="CRITICAL" />,
    );

    expect(
      screen.getByText("Respaldo requerido - contacte a un gerente"),
    ).toBeInTheDocument();
  });

  it("shows backup health stale banner", () => {
    render(
      <RecoveryPageView {...defaultProps} backupHealth="STALE" />,
    );

    expect(
      screen.getByText("El último respaldo tiene más de 24 horas"),
    ).toBeInTheDocument();
  });

  it("shows backup list with age text", () => {
    render(<RecoveryPageView {...defaultProps} />);

    // The age text is visible in each backup row (two rows in test data)
    const ageElements = screen.getAllByText("hace 2 h");
    expect(ageElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no backups exist", () => {
    render(<RecoveryPageView {...defaultProps} backups={[]} />);

    expect(
      screen.getByText("No se encontraron respaldos."),
    ).toBeInTheDocument();
  });

  it("renders tab buttons", () => {
    render(<RecoveryPageView {...defaultProps} />);

    expect(screen.getByText("Respaldos")).toBeInTheDocument();
    expect(
      screen.getByText("Registro de auditoría"),
    ).toBeInTheDocument();
  });

  it("calls onTabChange when log tab is clicked", () => {
    const onTabChange = vi.fn();
    render(
      <RecoveryPageView
        {...defaultProps}
        activeTab="backups"
        onTabChange={onTabChange}
      />,
    );

    fireEvent.click(screen.getByText("Registro de auditoría"));
    expect(onTabChange).toHaveBeenCalledWith("log");
  });

  it("switches to audit log tab and shows entries", () => {
    render(<RecoveryPageView {...defaultProps} activeTab="log" />);

    expect(screen.getByText("Respaldo creado")).toBeInTheDocument();
  });

  it("shows empty log state when no entries", () => {
    render(
      <RecoveryPageView
        {...defaultProps}
        activeTab="log"
        logEntries={[]}
      />,
    );

    expect(
      screen.getByText("No hay acciones de recuperación registradas."),
    ).toBeInTheDocument();
  });

  it("calls onVerify when verify button clicked", () => {
    const onVerify = vi.fn();
    render(
      <RecoveryPageView {...defaultProps} onVerify={onVerify} />,
    );

    const verifyButtons = screen.getAllByRole("button", { name: "Verificar" });
    fireEvent.click(verifyButtons[0]);
    expect(onVerify).toHaveBeenCalledWith("backup-1");
  });

  it("calls onSelectBackup when restore button clicked", () => {
    const onSelectBackup = vi.fn();
    render(
      <RecoveryPageView
        {...defaultProps}
        onSelectBackup={onSelectBackup}
      />,
    );

    const restoreButtons = screen.getAllByRole("button", { name: "Restaurar" });
    fireEvent.click(restoreButtons[0]);
    expect(onSelectBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "backup-1" }),
    );
  });

  it("shows restore modal when a backup is selected", () => {
    render(
      <RecoveryPageView
        {...defaultProps}
        selectedBackup={createBackup()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("calls onCancelRestore when cancel clicked in modal", () => {
    const onCancelRestore = vi.fn();
    render(
      <RecoveryPageView
        {...defaultProps}
        selectedBackup={createBackup()}
        onCancelRestore={onCancelRestore}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar" }),
    );
    expect(onCancelRestore).toHaveBeenCalledTimes(1);
  });

  it("calls onCreateBackup when create backup button clicked", () => {
    const onCreateBackup = vi.fn();
    render(
      <RecoveryPageView
        {...defaultProps}
        onCreateBackup={onCreateBackup}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Crear respaldo ahora" }),
    );
    expect(onCreateBackup).toHaveBeenCalledTimes(1);
  });

  it("shows creating state on backup button", () => {
    render(<RecoveryPageView {...defaultProps} isCreatingBackup />);

    expect(screen.getByText("Creando respaldo…")).toBeInTheDocument();
  });

  it("shows verification report in restore modal", () => {
    const verifyReport: VerificationReport = {
      passed: true,
      error: null,
    };
    render(
      <RecoveryPageView
        {...defaultProps}
        selectedBackup={createBackup()}
        verifyReport={verifyReport}
      />,
    );

    expect(screen.getByText("Exitosa")).toBeInTheDocument();
  });

  it("shows corrupt status badge for corrupt backups", () => {
    render(
      <RecoveryPageView
        {...defaultProps}
        backups={[createBackup({ status: "CORRUPT" })]}
      />,
    );

    // "Corrupto" appears twice per corrupt row (status badge + actions text)
    const corruptElements = screen.getAllByText("Corrupto");
    expect(corruptElements.length).toBeGreaterThanOrEqual(1);
  });
});
