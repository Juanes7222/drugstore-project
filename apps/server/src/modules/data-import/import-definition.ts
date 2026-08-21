// ImportDefinition contract: every importable entity declares how raw file
// rows map to canonical fields, how they validate, and how they are written.
// The definitions themselves stay in this module; the row schemas and column
// metadata live in @pharmacy/shared-validation so the POS desktop reuses the
// exact same contract for its local imports.

import type {
  ImportColumnMeta,
  ImportIssue,
} from '@pharmacy/shared-validation';
import type { SystemModule } from '@pharmacy/shared-types';
import { ZodError } from 'zod';

export interface ImportExecutionContext {
  userId: string;
}

export interface ImportRowWithNumber<T> {
  rowNumber: number;
  data: T;
}

export type ParseRowOutcome<T> = { data: T } | { issues: ImportIssue[] };

export interface ImportConflictContext {
  subscriptionId: string;
}

export interface ImportDefinition<TInput, TCreated, TRefs = unknown> {
  readonly entityKey: string;
  readonly entityLabel: string;
  /** Audit module stamped on the import's audit row. */
  readonly auditModule: SystemModule;
  readonly columns: ImportColumnMeta[];
  /**
   * Maps a raw header-keyed record to canonical field keys. Unmapped columns
   * are ignored; issues are returned when a value cannot be interpreted.
   */
  mapColumns(record: Record<string, unknown>): {
    data: Record<string, unknown>;
    issues: ImportIssue[];
  };
  validate(data: Record<string, unknown>): ParseRowOutcome<TInput>;
  /**
   * Batch-resolves cross-row references (e.g. category names → ids) with a
   * handful of queries instead of one per row. Called once before the write
   * loop; the per-row result is handed to createOne. Optional — definitions
   * without foreign references skip it.
   */
  prepare?(
    ctx: ImportExecutionContext,
    rows: Array<ImportRowWithNumber<TInput>>,
  ): Promise<Map<number, TRefs>>;
  /** Writes one row through the owning domain service. Must run inside a tenant transaction. */
  createOne(
    ctx: ImportExecutionContext,
    input: TInput,
    refs?: TRefs,
  ): Promise<TCreated>;
  /**
   * Detects rows that would violate existing uniqueness constraints (e.g.
   * duplicate internal codes). Batched: one query for the whole row set.
   */
  findConflicts(
    ctx: ImportConflictContext,
    rows: Array<ImportRowWithNumber<TInput>>,
  ): Promise<Map<number, ImportIssue[]>>;
}

const NORMALIZABLE_ALIAS = new Set(['', '-', 'n/a', 'null', 'undefined']);

/**
 * Builds the header → canonical-key lookup used by mapColumns. Aliases and
 * canonical keys are compared lowercased with whitespace collapsed, so
 * "Nombre Comercial" and "nombre_comercial" resolve to the same column.
 */
export function buildAliasMap(
  columns: ImportColumnMeta[],
): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const column of columns) {
    const normalizedKey = normalizeHeader(column.key);
    aliasMap.set(normalizedKey, column.key);
    for (const alias of column.aliases) {
      aliasMap.set(normalizeHeader(alias), column.key);
    }
  }
  return aliasMap;
}

export function normalizeHeader(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      // Fold accents so "Código" and "Concentración" match unaccented aliases.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
  );
}

/** Trims strings and maps placeholder/empty values to undefined. */
export function normalizeCellValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '' || NORMALIZABLE_ALIAS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

/** Converts a Zod error into the row-issue shape exposed by previews. */
export function zodIssuesToImportIssues(error: ZodError): ImportIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : 'row',
    message: issue.message,
  }));
}

/** Lists required columns whose headers are absent from the file. */
export function missingRequiredHeaders(
  columns: ImportColumnMeta[],
  headers: string[],
): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return columns
    .filter(
      (column) =>
        column.required &&
        ![column.key, ...column.aliases].some((alias) =>
          present.has(normalizeHeader(alias)),
        ),
    )
    .map((column) => column.label);
}
