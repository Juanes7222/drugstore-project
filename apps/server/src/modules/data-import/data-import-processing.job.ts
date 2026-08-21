import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Processor } from '@nestjs/bullmq';
import { DataImportService } from './data-import.service';
import {
  IMPORT_JOB_NAME,
  IMPORTS_QUEUE,
  DataImportJobData,
} from './data-import-job';

/**
 * Consumes the imports queue in-process. Concurrency 1 keeps one import per
 * worker; the service commits per-chunk transactions and records per-row
 * results, so the worker itself stays thin. The handler method must be named
 * `process` — @nestjs/bullmq 11 selects it by convention (no @Process
 * decorator in this version).
 */
@Processor(IMPORTS_QUEUE, { concurrency: 1 })
@Injectable()
export class DataImportProcessingJob {
  private readonly logger = new Logger(DataImportProcessingJob.name);

  constructor(private readonly dataImportService: DataImportService) {}

  async process(job: Job<DataImportJobData>): Promise<void> {
    try {
      await this.dataImportService.processImportJob(job.data, job);
    } catch (error) {
      // The service already marks the import FAILED with a reason; rethrow
      // so BullMQ applies its retry/backoff policy. On retry the service
      // resumes from the last committed chunk.
      await this.dataImportService.markImportFailed(
        job.data.importId,
        job.data.subscriptionId,
        (error as Error).message,
      );
      throw error;
    }
  }
}
