import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import {
  FISCAL_DIAN_QUERIES_QUEUE,
  FETCH_NUMBERING_RANGES_JOB,
  type FetchNumberingRangesJobData,
  type NumberingRangeSyncResult,
} from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FiscalIssuerConfigNotSetException } from '../exceptions/fiscal-issuer-config-not-set.exception';
import { FiscalActiveCertificateMissingException } from '../exceptions/fiscal-active-certificate-missing.exception';
import { DianSyncJobNotFoundException } from '../exceptions/dian-sync-job-not-found.exception';
import { DianRangeConflictException } from '../exceptions/dian-range-conflict.exception';
import { AllocationRangeInvalidException } from '../exceptions/allocation-range-invalid.exception';
import { FiscalResolutionsService } from './fiscal-resolutions.service';
import type { CreatedResolutionSummary } from './dian-range-apply-result.type';
import { FiscalResolutionAllocationsService } from '../fiscal-resolution-allocations.service';
import type { SyncResolutionsFromDianDto } from '../dto/sync-resolutions-from-dian.dto';

/** Response of POST /fiscal-dian/resolutions/sync-from-dian. */
export interface StartSyncResult {
  syncJobId: string;
}

/**
 * Status view of GET /fiscal-dian/resolutions/sync-from-dian/:jobId.
 *
 * The APPLIED transition happens lazily inside this endpoint: the worker
 * only fetches and returns ranges; domain rules (upserts, conflicts,
 * allocations) run here where they belong. Re-polling after APPLIED is safe
 * — identical resolutions are skipped idempotently.
 */
export type SyncStatusResult =
  | { status: 'PENDING' }
  | { status: 'FAILED'; errorCode: string; message: string }
  | {
      status: 'APPLIED';
      created: unknown[];
      skipped: unknown[];
      allocationsCreated: number;
      allocationWarnings: string[];
    };

/**
 * Orchestrates the standalone DIAN numbering-range sync:
 *   POST  → validates preconditions, enqueues a FetchNumberingRanges job
 *           (after commit, mirroring FiscalDocumentsService.enqueueGenerationJob).
 *   GET   → reports job state; on completion applies the fetched ranges via
 *           FiscalResolutionsService.applyDianRanges and optionally creates a
 *           full-range allocation for the requested workstation.
 */
@Injectable()
export class FiscalResolutionSyncService {
  private readonly logger = new Logger(FiscalResolutionSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @InjectQueue(FISCAL_DIAN_QUERIES_QUEUE)
    private readonly queue: Queue<FetchNumberingRangesJobData>,
    private readonly resolutionsService: FiscalResolutionsService,
    private readonly allocationsService: FiscalResolutionAllocationsService,
  ) {}

  /**
   * Kicks off a numbering-range sync for the calling tenant.
   * Precondition checks fail fast with typed errors before anything is
   * enqueued; deeper failures (no tech-provider config, certificate
   * unusable, contributor not habilitated) surface through GET's FAILED
   * status with the worker's stable error code.
   */
  async startSync(
    dto: SyncResolutionsFromDianDto,
    requestedByUserId: string | null,
  ): Promise<StartSyncResult> {
    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst();
    if (!issuerConfig) {
      throw new FiscalIssuerConfigNotSetException();
    }

    const certificate = await this.prisma.fiscalCertificate.findFirst({
      where: { status: 'ACTIVE' },
    });
    if (!certificate) {
      throw new FiscalActiveCertificateMissingException();
    }

    // The job id is generated up-front so the response can carry it even
    // though BullMQ only sees the job after the request transaction commits.
    const jobId = crypto.randomUUID();
    const jobData: FetchNumberingRangesJobData = {
      subscriptionId: this.tenantContext.getSubscriptionId(),
      requestedByUserId,
      workstationId: dto.workstationId ?? null,
    };

    const enqueue = () =>
      this.queue.add(FETCH_NUMBERING_RANGES_JOB, jobData, { jobId });

    if (this.tenantContext.hasTenant()) {
      this.tenantContext.registerAfterCommit(async () => {
        await enqueue();
      });
    } else {
      await enqueue();
    }

    return { syncJobId: jobId };
  }

  /**
   * Reports the state of a sync job, applying fetched ranges when the worker
   * has finished successfully. Throws DianRangeConflictException (409) when
   * any range conflicts with the local catalog — nothing is partially applied.
   */
  async getSyncStatus(jobId: string): Promise<SyncStatusResult> {
    const job: Job<FetchNumberingRangesJobData> | undefined =
      await this.queue.getJob(jobId);
    if (!job) {
      throw new DianSyncJobNotFoundException(jobId);
    }

    const state = await job.getState();

    if (state === 'completed') {
      return this.applyCompletedResult(job);
    }

    if (state === 'failed') {
      // Worker-level crash (as opposed to a structured {ok:false} result) —
      // usually transport/network against DIAN.
      return {
        status: 'FAILED',
        errorCode: 'DIAN_UNAVAILABLE',
        message: job.failedReason ?? 'Numbering-range query failed',
      };
    }

    return { status: 'PENDING' };
  }

  private async applyCompletedResult(
    job: Job<FetchNumberingRangesJobData>,
  ): Promise<SyncStatusResult> {
    const result = job.returnvalue as NumberingRangeSyncResult | undefined;

    if (!result || !result.ok) {
      return {
        status: 'FAILED',
        errorCode: result?.errorCode ?? 'UNEXPECTED',
        message: result && !result.ok ? result.message : 'Worker returned no payload',
      };
    }

    const applied = await this.resolutionsService.applyDianRanges(result.ranges);
    this.logger.log(
      `DIAN numbering-range sync ${job.id}: ` +
        `${applied.created.length} created, ${applied.skipped.length} skipped`,
    );

    const { allocationsCreated, allocationWarnings } = await this.allocateForCreated(
      applied.created,
      job.data,
    );

    return {
      status: 'APPLIED',
      created: applied.created,
      skipped: applied.skipped,
      allocationsCreated,
      allocationWarnings,
    };
  }

  /**
   * When the request named a workstation, every newly created resolution gets
   * one allocation covering its full range — the single-workstation wizard
   * flow. Multi-workstation tenants can re-slice manually; a failed
   * allocation never fails the sync, it degrades to a warning.
   */
  private async allocateForCreated(
    created: CreatedResolutionSummary[],
    jobData: FetchNumberingRangesJobData,
  ): Promise<{ allocationsCreated: number; allocationWarnings: string[] }> {
    const workstationId = jobData.workstationId;
    if (!workstationId || created.length === 0) {
      return { allocationsCreated: 0, allocationWarnings: [] };
    }

    let allocationsCreated = 0;
    const allocationWarnings: string[] = [];

    for (const resolution of created) {
      try {
        await this.allocationsService.create(
          {
            resolutionId: resolution.resolutionId,
            workstationId,
            // Full-range allocation: POS consumes consecutive numbers across
            // the entire DIAN window until exhausted.
            rangeFrom: resolution.rangeFrom,
            rangeTo: resolution.rangeTo,
          },
          jobData.requestedByUserId ?? '',
        );
        allocationsCreated += 1;
      } catch (error) {
        if (error instanceof AllocationRangeInvalidException) {
          allocationWarnings.push(
            `Resolution ${resolution.resolutionNumber}: ${error.message}`,
          );
          continue;
        }
        throw error;
      }
    }

    return { allocationsCreated, allocationWarnings };
  }
}
