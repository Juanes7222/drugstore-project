// Mock @pharmacy/database before any imports that depend on it (the processor
// imports DataImportService, which pulls in @pharmacy/database at module load).
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    Decimal: class {},
    JsonNull: 'JSON_NULL',
    PrismaClientKnownRequestError: class extends Error {
      constructor(
        m: string,
        public code: string,
        public meta?: unknown,
      ) {
        super(m);
      }
    },
  },
  ImportSourceFormat: { CSV: 'CSV', XLSX: 'XLSX', JSON: 'JSON' },
  DataImportRowStatus: { VALID: 'VALID', ERROR: 'ERROR' },
  DataImportStatus: {
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  },
  AuditAction: { IMPORT: 'IMPORT' },
}));

import { DataImportProcessingJob } from './data-import-processing.job';

describe('DataImportProcessingJob', () => {
  let service: { processImportJob: jest.Mock; markImportFailed: jest.Mock };
  let processor: DataImportProcessingJob;

  beforeEach(() => {
    service = {
      processImportJob: jest.fn().mockResolvedValue(undefined),
      markImportFailed: jest.fn().mockResolvedValue(undefined),
    };
    processor = new DataImportProcessingJob(service as any);
  });

  it('delegates the job payload and job to the service', async () => {
    const job = { data: { importId: 'import-1', subscriptionId: 'sub-test' } };

    await processor.process(job as any);

    expect(service.processImportJob).toHaveBeenCalledTimes(1);
    expect(service.processImportJob).toHaveBeenCalledWith(job.data, job);
    expect(service.markImportFailed).not.toHaveBeenCalled();
  });

  it('marks the import failed with the error message and rethrows', async () => {
    const error = new Error('db exploded');
    service.processImportJob.mockRejectedValue(error);
    const job = { data: { importId: 'import-1', subscriptionId: 'sub-test' } };

    const promise = processor.process(job as any);

    await expect(promise).rejects.toThrow('db exploded');
    expect(service.markImportFailed).toHaveBeenCalledTimes(1);
    expect(service.markImportFailed).toHaveBeenCalledWith(
      'import-1',
      'sub-test',
      'db exploded',
    );
  });
});
