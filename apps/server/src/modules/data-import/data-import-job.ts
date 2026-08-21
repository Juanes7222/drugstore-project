// Job contract for the async import queue: enqueue payload and processing
// knobs. Files ride in the job as base64 (capped at 5MB by the upload layer)
// so the worker re-parses at execution time — the source of truth stays the
// uploaded bytes, not a pre-validated snapshot.

import { ImportSourceFormat } from '@pharmacy/database';
import { IMPORT_JOB_NAME, IMPORTS_QUEUE } from './constants/import.constants';

export { IMPORT_JOB_NAME, IMPORTS_QUEUE };

export interface DataImportJobData {
  importId: string;
  entityKey: string;
  format: ImportSourceFormat;
  fileName: string;
  subscriptionId: string;
  userId: string;
  userRole: string | null;
  fileBase64: string;
}

export interface ImportJobProgress {
  processed: number;
  total: number;
}
