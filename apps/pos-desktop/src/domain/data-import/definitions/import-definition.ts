/**
 * Local ImportDefinition contract — mirrors the server's ImportDefinition
 * so each importable entity declares how raw file rows map to canonical
 * fields, how they validate, and how they are written through the owning
 * domain service. The row schemas and column metadata live in
 * @pharmacy/shared-validation and are never duplicated here.
 */

import type {
  ImportColumnMeta,
  ImportIssue,
} from "@pharmacy/shared-validation";
import type { ImportEntityKey } from "../import.types";

export interface ImportRowWithNumber<T> {
  rowNumber: number;
  data: T;
}

export type ParseRowOutcome<T> = { data: T } | { issues: ImportIssue[] };

export interface ImportDefinition<TInput, TCreated> {
  readonly entityKey: ImportEntityKey;
  readonly entityLabel: string;
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
   * Writes one row through the owning domain service. The service performs
   * its own transactional write and sync-queue insert; per-row business
   * failures throw ImportRowRejectedException so the run can continue.
   */
  createOne(input: TInput): Promise<TCreated>;
  /**
   * Detects rows that would violate existing uniqueness constraints
   * (product by internalCode; client by identificationType +
   * identificationNumber), including duplicates inside the file itself,
   * so the preview can report them before execute.
   */
  findConflicts(
    rows: Array<ImportRowWithNumber<TInput>>,
  ): Promise<Map<number, ImportIssue[]>>;
}
