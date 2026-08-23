/**
 * Local data-import service — orchestrates the offline-first import
 * pipeline: parse → validate → preview (no writes) → execute (writes
 * through the owning domain services).
 *
 * ## Parity with the server module
 *
 * Mirrors the semantics of apps/server's DataImportService so a CSV column
 * means the same thing on every side of the sync boundary:
 *
 * - File-level failures (empty file, header problems, missing required
 *   columns, over row limit) abort before a single row is validated.
 * - Per-row schema validation follows the shared Zod schemas; their
 *   messages are Spanish on purpose (they surface to the operator).
 * - Execution aborts if any row fails schema validation (the preview
 *   already surfaced them), then writes the remaining rows one by one
 *   through the owning domain service. Business rejections (unknown
 *   category, duplicate code) are recorded as per-row ERROR and the run
 *   continues.
 * - Created rows flow into the sync engine through the services' own
 *   SyncQueue entries (PRODUCT_CREATION / CLIENT_CREATION) — nothing
 *   extra is needed on the POS side.
 *
 * ## Transaction model
 *
 * The server commits an entire execute run in one tenant transaction. The
 * local domain services own their own per-write transactions (they also
 * insert the SyncQueue row inside them), and PGlite exposes a single
 * connection, so nesting a run-level transaction around per-row service
 * calls would contend on the same connection. Each row write is therefore
 * atomic on its own; the whole run is serialized against background sync
 * via the write lock.
 */

import type { PrismaClient } from "@pharmacy/database/local";
import type { AuthService } from "../auth/auth.service";
import { RoleType } from "@pharmacy/shared-types";
import type { ProductService } from "../catalog/product.service";
import type { ClientsService } from "../clients/clients.service";
import { dbWriteLock } from "../../infrastructure/write-lock";
import { parseImportFile } from "./parsers";
import {
  EXECUTE_ERROR_PAYLOAD_LIMIT,
  MAX_IMPORT_ROWS,
  PREVIEW_SAMPLE_LIMIT,
  missingRequiredHeaders,
} from "./import-common";
import type { ImportSourceFormat } from "./import-common";
import type {
  ImportEntityKey,
  ImportExecutionResult,
  ImportFileInput,
  ImportHistoryEntry,
  ImportPreviewResult,
  ImportRowError,
} from "./import.types";
import type { ImportDefinition } from "./definitions/import-definition";
import { createImportDefinitions } from "./definitions";
import {
  ImportExecutionFailedException,
  ImportFileInvalidException,
  ImportRowRejectedException,
  ImportTemplateFailedException,
  ImportValidationFailedException,
} from "./exceptions";
import {
  getImportHistory,
  listImportHistory,
  recordImportHistory,
} from "./import-history.store";
import { buildImportTemplate, type ImportTemplateCatalogs } from "./template.service";

export interface ImportServiceDeps {
  prisma: PrismaClient;
  auth: AuthService;
  productService: ProductService;
  clientsService: ClientsService;
}

export interface ImportService {
  preview(
    entityKey: ImportEntityKey,
    file: ImportFileInput,
  ): Promise<ImportPreviewResult>;
  execute(
    entityKey: ImportEntityKey,
    file: ImportFileInput,
  ): Promise<ImportExecutionResult>;
  listHistory(): ImportHistoryEntry[];
  getHistory(importId: string): ImportHistoryEntry | null;
  buildTemplate(
    entityKey: ImportEntityKey,
    format: ImportSourceFormat,
  ): Promise<string | ArrayBuffer>;
}

export const createImportService = (deps: ImportServiceDeps): ImportService =>
  new ImportService(deps);

export class ImportService implements ImportService {
  private readonly definitions: Record<
    ImportEntityKey,
    ImportDefinition<unknown, { id: string }>
  >;

  constructor(private readonly deps: ImportServiceDeps) {
    this.definitions = createImportDefinitions(
      deps.prisma,
      deps.productService,
      deps.clientsService,
    );
  }

  /**
   * Parse and validate a file without writing anything. The operator can
   * review per-row errors and the sample of valid rows before confirming.
   */
  async preview(
    entityKey: ImportEntityKey,
    file: ImportFileInput,
  ): Promise<ImportPreviewResult> {
    this.assertRoleFor(entityKey);
    const definition = this.definitions[entityKey];
    const { format, table } = await this.parseAndCheckFile(definition, file);
    const { valid, errors } = this.validateRows(definition, table);

    const conflicts = await definition.findConflicts(valid);
    for (const [rowNumber, issues] of conflicts) {
      errors.push({ rowNumber, issues });
    }
    const conflictedRowNumbers = new Set(conflicts.keys());
    const cleanValid = valid.filter(
      (row) => !conflictedRowNumbers.has(row.rowNumber),
    );

    return {
      entityKey: definition.entityKey,
      entityLabel: definition.entityLabel,
      fileName: file.fileName,
      format,
      totalRows: table.rows.length,
      validRows: cleanValid.length,
      errorRows: errors.length,
      errors,
      validSample: cleanValid.slice(0, PREVIEW_SAMPLE_LIMIT).map((row) => ({
        rowNumber: row.rowNumber,
        data: row.data,
      })),
      unmatchedHeaders: this.findUnmatchedHeaders(definition, table.headers),
      warnings: table.warnings,
    };
  }

  /**
   * Execute an import: re-validate the file, then write each valid row
   * through the owning domain service. Per-row business failures are
   * recorded as ERROR and the run continues; schema-validation failures
   * abort the run (the preview surfaces them first).
   */
  async execute(
    entityKey: ImportEntityKey,
    file: ImportFileInput,
  ): Promise<ImportExecutionResult> {
    const session = this.assertRoleFor(entityKey);
    const definition = this.definitions[entityKey];
    const { format, table } = await this.parseAndCheckFile(definition, file);
    const { valid, errors } = this.validateRows(definition, table);

    if (errors.length > 0) {
      // Same contract as the server: rows with schema errors must be fixed
      // in the preview first — no import record is persisted.
      throw new ImportValidationFailedException(
        `${errors.length} row(s) failed validation; fix them in the preview before executing.`,
      );
    }

    await dbWriteLock.acquire("foreground");
    try {
      const rowOutcomes: Array<{
        rowNumber: number;
        entityId?: string;
        issues?: ImportRowError["issues"];
      }> = [];

      // Re-check conflicts at execution time — rows may have been created
      // locally between the preview and the confirm.
      const conflicts = await definition.findConflicts(valid);
      for (const row of valid) {
        const conflictIssues = conflicts.get(row.rowNumber);
        if (conflictIssues) {
          rowOutcomes.push({
            rowNumber: row.rowNumber,
            issues: conflictIssues,
          });
          continue;
        }
        try {
          const created = await definition.createOne(row.data);
          rowOutcomes.push({
            rowNumber: row.rowNumber,
            entityId: (created as { id: string }).id,
          });
        } catch (error) {
          if (error instanceof ImportRowRejectedException) {
            rowOutcomes.push({
              rowNumber: row.rowNumber,
              issues: [{ path: "row", message: error.message }],
            });
            continue;
          }
          throw error;
        }
      }

      const successRows = rowOutcomes.filter(
        (outcome) => outcome.entityId !== undefined,
      );
      const errorRows = rowOutcomes.filter(
        (outcome) => outcome.issues !== undefined,
      );
      const executionErrors: ImportRowError[] = errorRows.map((outcome) => ({
        rowNumber: outcome.rowNumber,
        issues: outcome.issues as ImportRowError["issues"],
      }));

      const importId = globalThis.crypto.randomUUID();
      recordImportHistory({
        importId,
        entityKey: definition.entityKey,
        entityLabel: definition.entityLabel,
        fileName: file.fileName,
        format,
        totalRows: table.rows.length,
        validRows: successRows.length,
        errorRows: errorRows.length,
        createdAt: new Date().toISOString(),
        createdByUserId: session.userId,
        errors: executionErrors.slice(0, EXECUTE_ERROR_PAYLOAD_LIMIT),
      });

      return {
        importId,
        entityKey: definition.entityKey,
        entityLabel: definition.entityLabel,
        fileName: file.fileName,
        format,
        totalRows: table.rows.length,
        validRows: successRows.length,
        errorRows: errorRows.length,
        errors: executionErrors.slice(0, EXECUTE_ERROR_PAYLOAD_LIMIT),
      };
    } catch (error) {
      if (
        error instanceof ImportFileInvalidException ||
        error instanceof ImportValidationFailedException ||
        error instanceof ImportRowRejectedException
      ) {
        throw error;
      }
      throw new ImportExecutionFailedException(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      dbWriteLock.release();
    }
  }

  /** List completed import runs, most recent first. */
  listHistory(): ImportHistoryEntry[] {
    return listImportHistory();
  }

  /** Get a single import run by id, or null. */
  getHistory(importId: string): ImportHistoryEntry | null {
    return getImportHistory(importId);
  }

  /** Build a downloadable CSV/XLSX template for the entity. */
  async buildTemplate(
    entityKey: ImportEntityKey,
    format: ImportSourceFormat,
  ): Promise<string | ArrayBuffer> {
    this.assertRoleFor(entityKey);
    try {
      const catalogs =
        format === "XLSX" && entityKey === "products"
          ? await this.loadProductCatalogs()
          : undefined;
      return await buildImportTemplate(entityKey, format, catalogs);
    } catch (error) {
      if (error instanceof ImportFileInvalidException) {
        throw error;
      }
      throw new ImportTemplateFailedException(
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load the active catalog names the XLSX template offers as dropdown
   * values for category / pharmaceutical form / tax scheme.
   */
  private async loadProductCatalogs(): Promise<ImportTemplateCatalogs> {
    const [categories, pharmaceuticalForms, taxSchemes] = await Promise.all([
      this.deps.prisma.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
      this.deps.prisma.pharmaceuticalForm.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
      this.deps.prisma.taxScheme.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { name: true },
      }),
    ]);

    return {
      categories: categories.map((row) => row.name),
      pharmaceuticalForms: pharmaceuticalForms.map((row) => row.name),
      taxSchemes: taxSchemes.map((row) => row.name),
    };
  }

  /** Role gate per entity — mirrors the write permission of the domain service. */
  private assertRoleFor(entityKey: ImportEntityKey) {
    return entityKey === "products"
      ? this.deps.auth.requireRole(RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
      : this.deps.auth.requireRole(RoleType.CASHIER, RoleType.ADMIN);
  }

  private async parseAndCheckFile(
    definition: ImportDefinition<unknown, { id: string }>,
    file: ImportFileInput,
  ): Promise<{
    format: ImportSourceFormat;
    table: {
      headers: string[];
      rows: Array<Record<string, unknown>>;
      warnings: string[];
    };
  }> {
    if (file.data.byteLength === 0) {
      throw new ImportFileInvalidException("The uploaded file is empty");
    }
    const { format, table } = await parseImportFile(file.fileName, file.data);

    if (table.rows.length > MAX_IMPORT_ROWS) {
      throw new ImportFileInvalidException(
        `The file contains ${table.rows.length} rows; the maximum allowed is ${MAX_IMPORT_ROWS}`,
      );
    }
    const missingHeaders = missingRequiredHeaders(
      definition.columns,
      table.headers,
    );
    if (missingHeaders.length > 0) {
      throw new ImportFileInvalidException(
        `Missing required columns: ${missingHeaders.join(", ")}`,
      );
    }
    return { format, table };
  }

  private validateRows(
    definition: ImportDefinition<unknown, { id: string }>,
    table: { rows: Array<Record<string, unknown>> },
  ): {
    valid: Array<{ rowNumber: number; data: unknown }>;
    errors: ImportRowError[];
  } {
    const valid: Array<{ rowNumber: number; data: unknown }> = [];
    const errors: ImportRowError[] = [];

    table.rows.forEach((record, index) => {
      const rowNumber = index + 2; // Row 1 is the header.
      const mapped = definition.mapColumns(record);
      if (mapped.issues.length > 0) {
        errors.push({ rowNumber, issues: mapped.issues });
        return;
      }
      const outcome = definition.validate(mapped.data);
      if ("issues" in outcome) {
        errors.push({ rowNumber, issues: outcome.issues });
      } else {
        valid.push({ rowNumber, data: outcome.data });
      }
    });
    return { valid, errors };
  }

  private findUnmatchedHeaders(
    definition: ImportDefinition<unknown, { id: string }>,
    headers: string[],
  ): string[] {
    const known = new Set(
      definition.columns.flatMap((column) => [column.key, ...column.aliases]),
    );
    const normalize = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
    return headers.filter((header) => !known.has(normalize(header)));
  }
}
