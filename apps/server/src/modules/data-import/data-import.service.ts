// Orchestrates the import pipeline: parse → validate → preview (sync) and
// execute (async via the imports BullMQ queue). Executing enqueues a job and
// returns 202 immediately; the worker processes the file in committed chunks
// of IMPORT_CHUNK_SIZE rows, so large files neither block the HTTP request
// nor risk the request-transaction timeout. A chunk that fails unexpectedly
// aborts only that chunk — earlier chunks stay committed — and the job
// retries from the last recorded row (idempotent resume).

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import {
  AuditAction as PrismaAuditAction,
  DataImportRowStatus,
  DataImportStatus,
  ImportSourceFormat,
  Prisma,
  SystemModule as PrismaSystemModule,
} from '@pharmacy/database';
import type { ImportIssue } from '@pharmacy/shared-validation';
import { ImportDefinition } from './import-definition';
import { ImportDefinitionRegistry } from './import-definition-registry';
import { CsvSourceAdapter } from './csv-source.adapter';
import { ExcelSourceAdapter } from './excel-source.adapter';
import { JsonSourceAdapter } from './json-source.adapter';
import {
  ImportSourceAdapter,
  detectImportFormat,
} from './import-source.adapter';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import { ImportValidationException } from './exceptions/import-validation.exception';
import { ImportExecutionFailedException } from './exceptions/import-execution-failed.exception';
import { ImportRowRejectedException } from './exceptions/import-row-rejected.exception';
import { ImportNotFoundException } from './exceptions/import-not-found.exception';
import { ImportParseCache } from './import-parse-cache';
import { missingRequiredHeaders } from './import-definition';
import { ImportRequestDto } from './dto/import-request.dto';
import { QueryImportsDto } from './dto/query-imports.dto';
import {
  EXECUTE_ERROR_PAYLOAD_LIMIT,
  IMPORT_CHUNK_SIZE,
  IMPORT_JOB_NAME,
  IMPORTS_QUEUE,
  MAX_IMPORT_ROWS,
  PREVIEW_SAMPLE_LIMIT,
} from './constants/import.constants';
import type { DataImport, DataImportRow } from './entities/data-import.entity';
import type { DataImportJobData } from './data-import-job';

export interface ImportRowError {
  rowNumber: number;
  issues: ImportIssue[];
}

export interface ImportPreviewResult {
  entityKey: string;
  entityLabel: string;
  fileName: string;
  format: ImportSourceFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  validSample: Array<{ rowNumber: number; data: unknown }>;
  unmatchedHeaders: string[];
  warnings: string[];
}

/** 202 response of execute: the job was validated and queued, not finished. */
export interface ImportExecutionResult {
  importId: string;
  status: DataImportStatus;
  entityKey: string;
  entityLabel: string;
  fileName: string;
  format: ImportSourceFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
}

interface RowOutcome {
  rowNumber: number;
  entityId?: string;
  issues?: ImportIssue[];
}

interface ChunkContext {
  importId: string;
  subscriptionId: string;
  userId: string;
  rawByRowNumber: Map<number, Record<string, unknown>>;
}

@Injectable()
export class DataImportService {
  private readonly logger = new Logger(DataImportService.name);
  private readonly adaptersByFormat: Record<
    ImportSourceFormat,
    ImportSourceAdapter
  >;

  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly registry: ImportDefinitionRegistry,
    @InjectQueue(IMPORTS_QUEUE) private readonly importsQueue: Queue,
    private readonly parseCache: ImportParseCache,
    csvAdapter: CsvSourceAdapter,
    excelAdapter: ExcelSourceAdapter,
    jsonAdapter: JsonSourceAdapter,
  ) {
    this.adaptersByFormat = {
      [ImportSourceFormat.CSV]: csvAdapter,
      [ImportSourceFormat.XLSX]: excelAdapter,
      [ImportSourceFormat.JSON]: jsonAdapter,
    };
  }

  /**
   * Parses and validates the uploaded file without writing anything. The
   * response lets the user fix per-row errors before executing.
   */
  async preview(
    dto: ImportRequestDto,
    buffer: Buffer,
    fileName: string,
  ): Promise<ImportPreviewResult> {
    const { definition, format, table } = await this.parseUpload(
      dto,
      buffer,
      fileName,
    );
    const { valid, errors } = this.validateRows(definition, table);

    const conflicts = await definition.findConflicts(
      { subscriptionId: this.tenantContext.getSubscriptionId() },
      valid,
    );
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
      fileName,
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
   * Validates the whole file first; any invalid row aborts with 422 before
   * anything is enqueued. Valid files get a PROCESSING import record and a
   * job on the imports queue; the response is 202 with the importId, and
   * progress is observable through GET /imports/:id.
   */
  async execute(
    dto: ImportRequestDto,
    buffer: Buffer,
    fileName: string,
    userId: string,
    userRole: string | null,
  ): Promise<ImportExecutionResult> {
    const { definition, format, table } = await this.parseUpload(
      dto,
      buffer,
      fileName,
    );
    const { valid, errors } = this.validateRows(definition, table);

    if (errors.length > 0) {
      // No import record is persisted on validation failure: the
      // request-scoped tenant transaction rolls back when this throws, so
      // any record written here would silently disappear. The preview
      // endpoint already surfaced these errors before execute.
      throw new ImportValidationException({
        totalRows: table.rows.length,
        validRows: valid.length,
        errorRows: errors.length,
        errors,
      });
    }

    const subscriptionId = this.tenantContext.getSubscriptionId();
    const importId = crypto.randomUUID();

    const importRecord = await this.prisma.dataImport.create({
      data: {
        id: importId,
        subscriptionId,
        entityKey: definition.entityKey,
        sourceFormat: format,
        fileName,
        totalRows: table.rows.length,
        validRows: 0,
        errorRows: 0,
        status: DataImportStatus.PROCESSING,
        createdById: userId,
      },
    });

    const jobData: DataImportJobData = {
      importId,
      entityKey: definition.entityKey,
      format,
      fileName,
      subscriptionId,
      userId,
      userRole,
      fileBase64: buffer.toString('base64'),
    };

    try {
      await this.importsQueue.add(IMPORT_JOB_NAME, jobData, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      });
    } catch (error) {
      // The job never reached Redis; leaving a PROCESSING record behind
      // would look like a stuck import. Remove it best-effort and surface
      // the enqueue failure.
      await this.prisma.dataImport
        .delete({ where: { id: importId } })
        .catch(() => undefined);
      throw new ImportExecutionFailedException(
        `Failed to enqueue import job: ${(error as Error).message}`,
      );
    }

    return {
      importId,
      status: DataImportStatus.PROCESSING,
      entityKey: definition.entityKey,
      entityLabel: definition.entityLabel,
      fileName,
      format,
      totalRows: table.rows.length,
      validRows: valid.length,
      errorRows: 0,
      errors: [],
    };
  }

  /**
   * Worker entry (DataImportProcessingJob): parses and validates the file
   * (or reuses the TTL parse cache from a previous attempt), then commits
   * rows in IMPORT_CHUNK_SIZE transactions. Per-row errors are recorded and
   * the rest continues; an unexpected chunk failure marks the import FAILED
   * and rethrows so BullMQ retries — the resume logic skips rows whose
   * records already exist, making retries idempotent, and the cached parse
   * result spares the retry the whole parse+validate pass.
   */
  async processImportJob(data: DataImportJobData, job: Job): Promise<void> {
    const parsed = await this.loadParsedFile(data);
    const { definition, valid, errors, rawByRowNumber, totalRows } = parsed;

    await this.prisma.withTenant(data.subscriptionId, async () => {
      const record = await this.prisma.dataImport.findUnique({
        where: { id: data.importId },
        select: { id: true, status: true },
      });
      if (!record) {
        throw new ImportExecutionFailedException(
          `Import record ${data.importId} no longer exists`,
        );
      }
      if (record.status === DataImportStatus.COMPLETED) {
        // A previous attempt finished but the job was retried anyway.
        return;
      }

      if (errors.length > 0) {
        await this.persistValidationFailure(
          data,
          definition,
          totalRows,
          errors,
          rawByRowNumber,
        );
        await this.parseCache.del(data.importId);
        return;
      }

      // Resume support: rows whose records already exist were committed by
      // an earlier attempt that died before finalizing.
      const { _max: maxRowNumber } = await this.prisma.dataImportRow.aggregate({
        where: { importId: data.importId },
        _max: { rowNumber: true },
      });
      const pendingRows = maxRowNumber.rowNumber
        ? valid.filter(
            (row) => row.rowNumber > (maxRowNumber.rowNumber as number),
          )
        : valid;

      const context: ChunkContext = {
        importId: data.importId,
        subscriptionId: data.subscriptionId,
        userId: data.userId,
        rawByRowNumber,
      };

      let processed = valid.length - pendingRows.length;
      for (let i = 0; i < pendingRows.length; i += IMPORT_CHUNK_SIZE) {
        const chunk = pendingRows.slice(i, i + IMPORT_CHUNK_SIZE);
        await this.prisma.withTenant(data.subscriptionId, async (tx) => {
          await this.processChunkInTransaction(tx, definition, chunk, context);
        });
        processed += chunk.length;
        await job.updateProgress({ processed, total: valid.length });
      }

      await this.prisma.withTenant(data.subscriptionId, async (tx) => {
        await this.finalizeImport(tx, data, definition, valid.length);
      });
      await this.parseCache.del(data.importId);
    });
  }

  /**
   * Returns the parsed+validated file, preferring the TTL cache written by
   * an earlier attempt of the same job. Cache misses or failures re-parse —
   * the cache never becomes a correctness dependency.
   */
  private async loadParsedFile(data: DataImportJobData): Promise<{
    definition: ImportDefinition<unknown, unknown>;
    valid: Array<{ rowNumber: number; data: unknown }>;
    errors: ImportRowError[];
    rawByRowNumber: Map<number, Record<string, unknown>>;
    totalRows: number;
  }> {
    const cached = await this.parseCache.get(data.importId);
    if (cached) {
      return {
        definition: this.registry.get<unknown, unknown>(data.entityKey),
        valid: cached.valid,
        errors: cached.errors,
        rawByRowNumber: new Map(cached.rawRows),
        totalRows: cached.totalRows,
      };
    }

    const { definition, table } = await this.parseUpload(
      { entityKey: data.entityKey, format: data.format },
      Buffer.from(data.fileBase64, 'base64'),
      data.fileName,
    );
    const { valid, errors } = this.validateRows(definition, table);

    const rawByRowNumber = new Map<number, Record<string, unknown>>();
    table.rows.forEach((record, index) =>
      rawByRowNumber.set(index + 2, record),
    );

    await this.parseCache.set(data.importId, {
      totalRows: table.rows.length,
      valid,
      errors,
      rawRows: [...rawByRowNumber.entries()],
    });

    return {
      definition,
      valid,
      errors,
      rawByRowNumber,
      totalRows: table.rows.length,
    };
  }

  /**
   * Commits one chunk: batched conflict detection + batched reference
   * resolution, then per-row writes. All rows of the chunk (valid or error)
   * get DataImportRow records in the same transaction.
   */
  private async processChunkInTransaction(
    tx: Prisma.TransactionClient,
    definition: ImportDefinition<unknown, unknown>,
    chunk: Array<{ rowNumber: number; data: unknown }>,
    context: ChunkContext,
  ): Promise<void> {
    const conflicts = await definition.findConflicts(
      { subscriptionId: context.subscriptionId },
      chunk,
    );
    const prepared = definition.prepare
      ? await definition.prepare({ userId: context.userId }, chunk)
      : undefined;

    const outcomes: RowOutcome[] = [];
    for (const row of chunk) {
      const rowConflicts = conflicts.get(row.rowNumber);
      if (rowConflicts) {
        outcomes.push({ rowNumber: row.rowNumber, issues: rowConflicts });
        continue;
      }
      try {
        const entity = await definition.createOne(
          { userId: context.userId },
          row.data,
          prepared?.get(row.rowNumber),
        );
        outcomes.push({
          rowNumber: row.rowNumber,
          entityId: (entity as { id: string }).id,
        });
      } catch (error) {
        if (error instanceof ImportRowRejectedException) {
          outcomes.push({
            rowNumber: row.rowNumber,
            issues: [{ path: 'row', message: error.message }],
          });
          continue;
        }
        // A duplicate that raced the batch conflict check (P2002) only
        // fails that row; the rest of the chunk still commits.
        if ((error as { code?: string }).code === 'P2002') {
          outcomes.push({
            rowNumber: row.rowNumber,
            issues: [
              {
                path: 'row',
                message:
                  'Ya existe un registro con los mismos datos (codigo o documento duplicado)',
              },
            ],
          });
          continue;
        }
        throw error;
      }
    }

    await tx.dataImportRow.createMany({
      data: outcomes.map((outcome) => ({
        id: crypto.randomUUID(),
        importId: context.importId,
        rowNumber: outcome.rowNumber,
        rawData: (context.rawByRowNumber.get(outcome.rowNumber) ??
          {}) as Prisma.InputJsonValue,
        status: outcome.entityId
          ? DataImportRowStatus.VALID
          : DataImportRowStatus.ERROR,
        issues: outcome.issues
          ? (outcome.issues as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        entityId: outcome.entityId ?? null,
      })),
    });
  }

  /** Marks the import FAILED with its validation errors, all rows as ERROR. */
  private async persistValidationFailure(
    data: DataImportJobData,
    definition: ImportDefinition<unknown, unknown>,
    totalRows: number,
    errors: ImportRowError[],
    rawByRowNumber: Map<number, Record<string, unknown>>,
  ): Promise<void> {
    await this.prisma.withTenant(data.subscriptionId, async (tx) => {
      await tx.dataImport.update({
        where: { id: data.importId },
        data: {
          status: DataImportStatus.FAILED,
          failureReason: `Validation failed: ${errors.length} of ${totalRows} rows contain errors`,
        },
      });
      await tx.dataImportRow.createMany({
        data: errors.map((error) => ({
          id: crypto.randomUUID(),
          importId: data.importId,
          rowNumber: error.rowNumber,
          rawData: (rawByRowNumber.get(error.rowNumber) ??
            {}) as Prisma.InputJsonValue,
          status: DataImportRowStatus.ERROR,
          issues: error.issues as unknown as Prisma.InputJsonValue,
        })),
      });
    });
  }

  /** Recomputes counts from committed row records and stamps COMPLETED. */
  private async finalizeImport(
    tx: Prisma.TransactionClient,
    data: DataImportJobData,
    definition: ImportDefinition<unknown, unknown>,
    totalRows: number,
  ): Promise<void> {
    const [validCount, errorCount] = await Promise.all([
      tx.dataImportRow.count({
        where: { importId: data.importId, status: DataImportRowStatus.VALID },
      }),
      tx.dataImportRow.count({
        where: { importId: data.importId, status: DataImportRowStatus.ERROR },
      }),
    ]);

    await tx.dataImport.update({
      where: { id: data.importId },
      data: {
        status: DataImportStatus.COMPLETED,
        validRows: validCount,
        errorRows: errorCount,
        failureReason: null,
      },
    });

    await this.writeAuditRow(
      tx,
      definition,
      data.importId,
      data.userId,
      data.userRole,
      validCount,
      errorCount,
    );
  }

  /** Marks the import FAILED after an unexpected chunk error. */
  async markImportFailed(
    importId: string,
    subscriptionId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma
      .withTenant(subscriptionId, async (tx) => {
        await tx.dataImport.update({
          where: { id: importId },
          data: { status: DataImportStatus.FAILED, failureReason: reason },
        });
      })
      .catch((error) => {
        this.logger.error(
          `Failed to mark import ${importId} as FAILED: ${(error as Error).message}`,
        );
      });
  }

  async listImports(query: QueryImportsDto): Promise<{
    data: DataImport[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const where = query.entityKey ? { entityKey: query.entityKey } : {};
    const [items, total] = await Promise.all([
      this.prisma.dataImport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.dataImport.count({ where }),
    ]);
    return { data: items, total, page: query.page, pageSize: query.pageSize };
  }

  async getImport(
    importId: string,
  ): Promise<DataImport & { rows: DataImportRow[] }> {
    const record = await this.prisma.dataImport.findUnique({
      where: { id: importId },
      include: { rows: { orderBy: { rowNumber: 'asc' } } },
    });
    if (!record) {
      throw new ImportNotFoundException(importId);
    }
    return record;
  }

  private async parseUpload(
    dto: ImportRequestDto,
    buffer: Buffer,
    fileName: string,
  ): Promise<{
    definition: ImportDefinition<unknown, unknown>;
    format: ImportSourceFormat;
    table: {
      headers: string[];
      rows: Array<Record<string, unknown>>;
      warnings: string[];
    };
  }> {
    if (buffer.length === 0) {
      throw new ImportFileInvalidException('The uploaded file is empty');
    }
    const definition = this.registry.get<unknown, unknown>(dto.entityKey);
    const format = dto.format ?? detectImportFormat(fileName, buffer);
    const table = await this.adaptersByFormat[format].parse(buffer, fileName);

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
        `Missing required columns: ${missingHeaders.join(', ')}`,
      );
    }
    return { definition, format, table };
  }

  private validateRows(
    definition: ImportDefinition<unknown, unknown>,
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
      if ('issues' in outcome) {
        errors.push({ rowNumber, issues: outcome.issues });
      } else {
        valid.push({ rowNumber, data: outcome.data });
      }
    });
    return { valid, errors };
  }

  private findUnmatchedHeaders(
    definition: ImportDefinition<unknown, unknown>,
    headers: string[],
  ): string[] {
    const known = new Set(
      definition.columns.flatMap((column) => [column.key, ...column.aliases]),
    );
    const normalize = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ');
    return headers.filter((header) => !known.has(normalize(header)));
  }

  /**
   * Writes the import's audit row. @Auditable cannot be used on the execute
   * endpoint because the audit module depends on the imported entity
   * (CATALOG vs CLIENTS), which is only known per request — the decorator
   * takes static metadata. The row commits atomically with the finalize
   * transaction.
   */
  private async writeAuditRow(
    tx: Prisma.TransactionClient,
    definition: ImportDefinition<unknown, unknown>,
    entityId: string,
    userId: string,
    userRole: string | null,
    validRows: number,
    errorRows: number,
  ): Promise<void> {
    // The Prisma SystemModule enum is cast because its values mirror
    // shared-types (CATALOG/CLIENTS exist in both) but the types are
    // generated independently.
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(),
        action: PrismaAuditAction.IMPORT,
        module: definition.auditModule as unknown as PrismaSystemModule,
        entityType: 'DataImport',
        entityId,
        details: JSON.stringify({
          entityKey: definition.entityKey,
          validRows,
          errorRows,
        }),
        userId,
        userRole,
      },
    });
  }
}
