// Cross-app contract for the DIAN numbering-range sync flow.
//
// apps/server enqueues a job on the `fiscal-dian-queries` BullMQ queue and
// apps/fiscal-engine consumes it. The two applications do not import each
// other's code, so both sides import this module from @pharmacy/shared-types
// instead — same pattern as the Wompi and local-sync contracts above.

/** BullMQ queue shared by server (producer) and fiscal-engine (consumer). */
export const FISCAL_DIAN_QUERIES_QUEUE = 'fiscal-dian-queries';

/** Job name for the GetNumberingRange standalone query. */
export const FETCH_NUMBERING_RANGES_JOB = 'fetch-numbering-ranges';

/**
 * One numbering range as returned by DIAN's GetNumberingRange web service
 * (Technical Annex §7.15). Dates stay as raw strings ("2017-10-02" or
 * "2017-10-02T00:00:00Z"); only the consumer that turns them into
 * FiscalResolution rows parses them.
 */
export interface DianNumberingRange {
  resolutionNumber: string;
  prefix: string;
  fromNumber: number;
  toNumber: number;
  validFrom: string;
  validTo: string;
  technicalKey: string;
}

export interface FetchNumberingRangesJobData {
  subscriptionId: string;
  /** User who triggered the sync; reused as the allocation's allocatedByUserId. */
  requestedByUserId: string | null;
  /** When set, an allocation covering the full range is created for this workstation. */
  workstationId: string | null;
}

/**
 * Stable error codes carried in the job's return value so the server can map
 * them to typed exceptions without string-matching messages. The worker never
 * throws for expected outcomes — a thrown job would lose the structured code
 * on serialization.
 */
export type NumberingRangeSyncErrorCode =
  | 'ISSUER_CONFIG_MISSING'
  | 'TECH_PROVIDER_CONFIG_MISSING'
  | 'CERTIFICATE_UNUSABLE'
  | 'NOT_HABILITATED'
  | 'SOFTWARE_MISMATCH'
  | 'NOT_AUTHORIZED'
  | 'DIAN_UNAVAILABLE'
  | 'UNEXPECTED';

export interface NumberingRangeSyncFailure {
  ok: false;
  errorCode: NumberingRangeSyncErrorCode;
  message: string;
}

export interface NumberingRangeSyncSuccess {
  ok: true;
  ranges: DianNumberingRange[];
}

export type NumberingRangeSyncResult =
  | NumberingRangeSyncSuccess
  | NumberingRangeSyncFailure;

/**
 * Maps a DIAN GetNumberingRange OperationCode (Annex §7.15.3) to a stable
 * error code. Exported so both the worker (producer of failures) and any
 * tooling re-deriving codes stay consistent.
 *
 *   100 = OK, 301 = no ranges for NIT (contributor not habilitated),
 *   302/303 = software-code mismatch, 401 = not authorized, 500 = service error.
 */
export function dianOperationCodeToErrorCode(
  operationCode: string,
): NumberingRangeSyncErrorCode {
  switch (operationCode) {
    case '301':
      return 'NOT_HABILITATED';
    case '302':
    case '303':
      return 'SOFTWARE_MISMATCH';
    case '401':
      return 'NOT_AUTHORIZED';
    case '500':
      return 'DIAN_UNAVAILABLE';
    default:
      return 'UNEXPECTED';
  }
}
