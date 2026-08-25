import type { DianNumberingRange } from '@pharmacy/shared-types';
import type { DianRangeConflict } from '../exceptions/dian-range-conflict.exception';

/** A range that became a new ACTIVE FiscalResolution row. */
export interface CreatedResolutionSummary {
  resolutionId: string;
  resolutionNumber: string;
  prefix: string;
  documentType: string;
  /** Full DIAN window, used for a whole-range workstation allocation. */
  rangeFrom: number;
  rangeTo: number;
}

/** A range deliberately not turned into a row, with the reason why. */
export interface SkippedRangeSummary {
  resolutionNumber: string;
  prefix: string;
  reason: 'IDENTICAL_EXISTS' | 'EXPIRED';
}

/** Outcome of applying DIAN's ranges to the local resolution catalog. */
export interface DianRangeApplyResult {
  created: CreatedResolutionSummary[];
  skipped: SkippedRangeSummary[];
  /** Always empty on return — non-empty means DianRangeConflictException was thrown instead. */
  conflicts: DianRangeConflict[];
}

/**
 * The subset of DianNumberingRange the applier needs, kept structural so
 * callers can pass the worker's payload directly.
 */
export type DianRangeInput = Pick<
  DianNumberingRange,
  'resolutionNumber' | 'prefix' | 'fromNumber' | 'toNumber' | 'validFrom' | 'validTo'
>;

export interface ApplyDianRangesOptions {
  /**
   * When set, every newly created resolution gets one allocation covering
   * its full range for this workstation (single-workstation wizard flow).
   */
  workstationId?: string | null;
  /** Recorded as FiscalResolutionAllocation.allocatedByUserId. */
  allocatedByUserId?: string | null;
}
