/**
 * Component tests for the generic import wizard (ImportDialog): the full
 * select → preview → execute → result flow, busy states, per-row error
 * rendering, DomainError → i18n mapping, display caps, close blocking during
 * execution, template downloads, and the canImportEntity role gate.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoleType } from "@pharmacy/shared-types";
import { ImportDialog, canImportEntity } from "./import-dialog";
import {
  ImportExecutionFailedException,
  ImportFileInvalidException,
  ImportRowRejectedException,
  ImportValidationFailedException,
} from "../../../domain/data-import/exceptions";
import {
  InsufficientRoleException,
  NoActiveSessionException,
} from "../../../domain/auth/exceptions";
import type {
  ImportExecutionResult,
  ImportPreviewResult,
} from "../../../domain/data-import/import.types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockImportService = {
  preview: vi.fn(),
  execute: vi.fn(),
  listHistory: vi.fn(),
  getHistory: vi.fn(),
  buildTemplate: vi.fn(),
};

vi.mock("@/components/common/service-context", () => ({
  useImportService: () => mockImportService,
}));

vi.mock("../../../common/native-save", () => ({
  saveFileWithDialog: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePreview = (
  overrides: Partial<ImportPreviewResult> = {},
): ImportPreviewResult => ({
  entityKey: "products",
  entityLabel: "Products",
  fileName: "productos.csv",
  format: "CSV",
  totalRows: 3,
  validRows: 2,
  errorRows: 1,
  errors: [
    {
      rowNumber: 3,
      issues: [{ path: "internalCode", message: "El codigo interno es obligatorio" }],
    },
  ],
  validSample: [
    {
      rowNumber: 2,
      data: { internalCode: "P001", commercialName: "Acetaminofen 500mg" },
    },
  ],
  unmatchedHeaders: ["Nota"],
  warnings: ["CSV parse issue: quoted field"],
  ...overrides,
});

const makeExecution = (
  overrides: Partial<ImportExecutionResult> = {},
): ImportExecutionResult => ({
  importId: "import-1",
  entityKey: "products",
  entityLabel: "Products",
  fileName: "productos.csv",
  format: "CSV",
  totalRows: 3,
  validRows: 2,
  errorRows: 1,
  errors: [
    {
      rowNumber: 3,
      issues: [{ path: "row", message: 'La categoria "X" no existe en el sistema' }],
    },
  ],
  ...overrides,
});

const makeDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const makeCsvFile = (): File =>
  new File(["codigo,nombre\nP001,A"], "productos.csv", { type: "text/csv" });

const renderDialog = (
  entityKey: "products" | "clients" = "products",
  onOpenChange = vi.fn(),
  onImported = vi.fn(),
) => {
  const user = userEvent.setup();
  render(
    <ImportDialog
      entityKey={entityKey}
      open={true}
      onOpenChange={onOpenChange}
      onImported={onImported}
    />,
  );
  return { user, onOpenChange, onImported };
};

const uploadFile = async (
  user: ReturnType<typeof userEvent.setup>,
  file: File = makeCsvFile(),
) => {
  const input = screen.getByLabelText("Archivo a importar");
  await user.upload(input, file);
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportService.listHistory.mockReturnValue([]);
  });

  describe("full flow", () => {
    it("runs select → preview → execute → result and reports back", async () => {
      mockImportService.preview.mockResolvedValue(makePreview());
      mockImportService.execute.mockResolvedValue(makeExecution());
      const onImported = vi.fn();
      const { user, onOpenChange } = renderDialog("products", vi.fn(), onImported);

      // Step 1 — select.
      expect(screen.getByText(/Paso 1 de 3/)).toBeInTheDocument();
      await uploadFile(user);

      // Step 2 — preview: totals, sample, per-row error, warnings, unmatched.
      expect(screen.getByText(/Paso 2 de 3/)).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument(); // total rows
      expect(screen.getByText("P001")).toBeInTheDocument();
      expect(screen.getByText("Acetaminofen 500mg")).toBeInTheDocument();
      const errorItem = screen.getByText("Fila 3");
      expect(
        within(errorItem.closest("li") as HTMLElement).getByText(/internalCode/),
      ).toBeInTheDocument();
      expect(
        screen.getByText("El codigo interno es obligatorio"),
      ).toBeInTheDocument();
      expect(screen.getByText("Nota")).toBeInTheDocument();
      expect(screen.getByText(/CSV parse issue/)).toBeInTheDocument();

      // Step 3 — execute and confirm the result.
      await user.click(
        screen.getByRole("button", { name: "Importar 2 filas válidas" }),
      );
      expect(await screen.findByText(/Paso 3 de 3/)).toBeInTheDocument();
      expect(screen.getByText("2 registros importados")).toBeInTheDocument();
      expect(screen.getByText(/ID de importación/)).toBeInTheDocument();
      expect(screen.getByText("import-1")).toBeInTheDocument();
      expect(
        screen.getByText('La categoria "X" no existe en el sistema'),
      ).toBeInTheDocument();

      expect(onImported).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("disables the import action when no rows are valid", async () => {
      mockImportService.preview.mockResolvedValue(
        makePreview({ validRows: 0, errorRows: 3, validSample: [] }),
      );
      const { user } = renderDialog();
      await uploadFile(user);

      const action = screen.getByRole("button", {
        name: "Importar 0 filas válidas",
      });
      expect(action).toBeDisabled();

      await user.click(action);
      expect(mockImportService.execute).not.toHaveBeenCalled();
    });

    it("shows the recent import history on the result step", async () => {
      mockImportService.preview.mockResolvedValue(
        makePreview({ validRows: 1, errorRows: 0, errors: [] }),
      );
      mockImportService.execute.mockResolvedValue(
        makeExecution({ validRows: 1, errorRows: 0, errors: [] }),
      );
      mockImportService.listHistory.mockReturnValue([
        {
          importId: "import-old",
          entityKey: "products",
          entityLabel: "Products",
          fileName: "antiguo.csv",
          format: "CSV",
          totalRows: 10,
          validRows: 9,
          errorRows: 1,
          createdAt: "2026-08-01T10:00:00.000Z",
          createdByUserId: "user-1",
          errors: [],
        },
      ]);
      const { user } = renderDialog();
      await uploadFile(user);
      await user.click(
        screen.getByRole("button", { name: "Importar 1 fila válida" }),
      );

      expect(await screen.findByText("antiguo.csv")).toBeInTheDocument();
      expect(screen.getByText(/9 válidas · 1 con error/)).toBeInTheDocument();
    });
  });

  describe("busy states", () => {
    it("shows the analyzing status while preview is pending", async () => {
      const deferred = makeDeferred<ImportPreviewResult>();
      mockImportService.preview.mockReturnValue(deferred.promise);
      const { user } = renderDialog();

      await uploadFile(user);

      const status = screen.getByRole("status");
      expect(
        within(status).getByText("Analizando archivo..."),
      ).toBeInTheDocument();

      deferred.resolve(makePreview());
      expect(await screen.findByText(/Paso 2 de 3/)).toBeInTheDocument();
    });

    it("shows the executing status and blocks the close button mid-execution", async () => {
      const previewDeferred = makeDeferred<ImportPreviewResult>();
      const executeDeferred = makeDeferred<ImportExecutionResult>();
      mockImportService.preview.mockReturnValue(previewDeferred.promise);
      mockImportService.execute.mockReturnValue(executeDeferred.promise);
      const onOpenChange = vi.fn();
      const { user } = renderDialog("products", onOpenChange);

      await uploadFile(user);
      previewDeferred.resolve(makePreview());
      await screen.findByText(/Paso 2 de 3/);

      await user.click(
        screen.getByRole("button", { name: "Importar 2 filas válidas" }),
      );

      // Executing notice + button label swap.
      expect(screen.getByRole("status")).toHaveTextContent(
        /Escribiendo 2 registros uno por uno/,
      );
      const executingButton = screen.getByRole("button", { name: /Importando/ });
      expect(executingButton).toBeDisabled();

      // The dialog close (X) is disabled while executing.
      const closeButton = screen.getByRole("button", { name: "Cerrar" });
      expect(closeButton).toBeDisabled();
      await user.click(closeButton);
      expect(onOpenChange).not.toHaveBeenCalled();

      executeDeferred.resolve(makeExecution());
      expect(await screen.findByText(/Paso 3 de 3/)).toBeInTheDocument();
    });
  });

  // PART2_CONTINUES

  describe("DomainError → i18n mapping", () => {
    it("maps IMPORT_FILE_INVALID from a failed preview", async () => {
      mockImportService.preview.mockRejectedValue(
        new ImportFileInvalidException("The CSV file is empty"),
      );
      const { user, onOpenChange } = renderDialog();
      await uploadFile(user);

      const alert = await screen.findByRole("alert");
      expect(
        within(alert).getByText("El archivo no se puede importar."),
      ).toBeInTheDocument();
      expect(within(alert).getByText("The CSV file is empty")).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it.each([
      {
        code: "IMPORT_VALIDATION_FAILED",
        error: new ImportValidationFailedException("1 row(s) failed"),
        title:
          "La validación falló. Corrija los errores en el archivo y vuelva a intentarlo.",
      },
      {
        code: "IMPORT_ROW_REJECTED",
        error: new ImportRowRejectedException("rejected row"),
        title: "Una fila fue rechazada por el sistema.",
      },
      {
        code: "IMPORT_EXECUTION_FAILED",
        error: new ImportExecutionFailedException("disk full"),
        title: "No se pudo completar la importación.",
      },
    ])("maps $code from a failed execute", async ({ error, title }) => {
      mockImportService.preview.mockResolvedValue(makePreview());
      mockImportService.execute.mockRejectedValue(error);
      const { user } = renderDialog();
      await uploadFile(user);
      await user.click(
        screen.getByRole("button", { name: "Importar 2 filas válidas" }),
      );

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText(title)).toBeInTheDocument();
      // Still on the preview step — the user can correct and retry.
      expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
    });

    it("maps NO_ACTIVE_SESSION to the session error copy", async () => {
      mockImportService.preview.mockRejectedValue(new NoActiveSessionException());
      const { user } = renderDialog();
      await uploadFile(user);

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText(/No hay sesión activa/)).toBeInTheDocument();
    });

    it("maps INSUFFICIENT_ROLE to the inventory-admin copy for products", async () => {
      mockImportService.preview.mockRejectedValue(
        new InsufficientRoleException(RoleType.INVENTORY_ASSISTANT),
      );
      const { user } = renderDialog("products");
      await uploadFile(user);

      const alert = await screen.findByRole("alert");
      expect(
        within(alert).getByText(/Asistente de Inventario o Administrador/),
      ).toBeInTheDocument();
    });

    it("maps INSUFFICIENT_ROLE to the cashier-admin copy for clients", async () => {
      mockImportService.preview.mockRejectedValue(
        new InsufficientRoleException(RoleType.CASHIER),
      );
      const { user } = renderDialog("clients");
      await uploadFile(user);

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText(/Cajero o Administrador/)).toBeInTheDocument();
    });
  });

  describe("error display cap", () => {
    it("renders at most 100 preview errors and shows the +N more line", async () => {
      const errors = Array.from({ length: 150 }, (_, index) => ({
        rowNumber: index + 2,
        issues: [{ path: "internalCode", message: "El codigo interno es obligatorio" }],
      }));
      mockImportService.preview.mockResolvedValue(
        makePreview({ validRows: 0, errorRows: 150, validSample: [], errors }),
      );
      const { user } = renderDialog();
      await uploadFile(user);

      expect(await screen.findByText("(150)")).toBeInTheDocument();
      expect(screen.getAllByText(/^Fila \d+$/)).toHaveLength(100);
      expect(screen.getByText(/50 errores más/)).toBeInTheDocument();
    });
  });

  describe("template downloads", () => {
    it("downloads the CSV and XLSX templates for the entity", async () => {
      const { saveFileWithDialog } = await import("../../../common/native-save");
      mockImportService.buildTemplate.mockResolvedValue("\uFEFFa,b");
      const { user } = renderDialog();

      await user.click(screen.getByRole("button", { name: "Plantilla CSV" }));
      expect(mockImportService.buildTemplate).toHaveBeenCalledWith("products", "CSV");
      expect(saveFileWithDialog).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "plantilla-productos.csv" }),
      );

      await user.click(screen.getByRole("button", { name: "Plantilla Excel" }));
      expect(mockImportService.buildTemplate).toHaveBeenCalledWith("products", "XLSX");
      expect(saveFileWithDialog).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "plantilla-productos.xlsx" }),
      );
    });

    it("uses the entity slug for client template filenames", async () => {
      const { saveFileWithDialog } = await import("../../../common/native-save");
      mockImportService.buildTemplate.mockResolvedValue("\uFEFFa,b");
      const { user } = renderDialog("clients");

      await user.click(screen.getByRole("button", { name: "Plantilla CSV" }));
      expect(saveFileWithDialog).toHaveBeenCalledWith(
        expect.objectContaining({ filename: "plantilla-clientes.csv" }),
      );
    });

    it("disables both template buttons while a download is pending", async () => {
      const deferred = makeDeferred<string>();
      mockImportService.buildTemplate.mockReturnValue(deferred.promise);
      const { user } = renderDialog();

      await user.click(screen.getByRole("button", { name: "Plantilla CSV" }));

      const csvButton = screen.getByRole("button", { name: "Plantilla CSV" });
      const xlsxButton = screen.getByRole("button", { name: "Plantilla Excel" });
      expect(csvButton).toBeDisabled();
      expect(xlsxButton).toBeDisabled();

      deferred.resolve("\uFEFFa,b");
      expect(await screen.findByRole("button", { name: "Plantilla Excel" })).not.toBeDisabled();
    });
  });
});

describe("canImportEntity", () => {
  it("allows inventory staff and admins for products", () => {
    expect(canImportEntity("products", RoleType.INVENTORY_ASSISTANT)).toBe(true);
    expect(canImportEntity("products", RoleType.ADMIN)).toBe(true);
    expect(canImportEntity("products", RoleType.OWNER)).toBe(true);
    expect(canImportEntity("products", RoleType.SAAS_ADMIN)).toBe(true);
  });

  it("rejects cashiers for products", () => {
    expect(canImportEntity("products", RoleType.CASHIER)).toBe(false);
    expect(canImportEntity("products", RoleType.MANAGER)).toBe(false);
  });

  it("allows cashiers and admins for clients", () => {
    expect(canImportEntity("clients", RoleType.CASHIER)).toBe(true);
    expect(canImportEntity("clients", RoleType.ADMIN)).toBe(true);
    expect(canImportEntity("clients", RoleType.OWNER)).toBe(true);
  });

  it("rejects inventory staff for clients", () => {
    expect(canImportEntity("clients", RoleType.INVENTORY_ASSISTANT)).toBe(false);
  });

  it("returns false without a session role", () => {
    expect(canImportEntity("products", undefined)).toBe(false);
    expect(canImportEntity("clients", undefined)).toBe(false);
  });
});