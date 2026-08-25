import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  FISCAL_DIAN_QUERIES_QUEUE,
  type FetchNumberingRangesJobData,
  type NumberingRangeSyncErrorCode,
  type NumberingRangeSyncResult,
  type DianNumberingRange,
} from '@pharmacy/shared-types';
import {
  FISCAL_TRANSMISSION_PORT,
  SECRET_READER_PORT,
} from './ports';
import type {
  FiscalTransmissionPort,
  SecretReaderPort,
} from './ports';
import { TransmissionRouteResolver } from './transmission-route.resolver';
import { DianNumberingRangeOperationException } from './exceptions/dian-numbering-range-operation.exception';
import { DomainException } from '../../common/exceptions/domain.exception';

/**
 * Consumes the standalone DIAN numbering-range query requested by the
 * server's "sync resolutions from DIAN" admin flow.
 *
 * Transport and credential resolution only: the worker fetches the ranges
 * and returns them as the job's return value. Turning them into
 * FiscalResolution rows (overlap rules, allocations) is domain logic that
 * stays in apps/server's fiscal-dian module.
 *
 * Expected failures are RETURNED ({ok:false,...}), never thrown: a thrown
 * BullMQ failure would collapse the structured error code into a plain
 * failedReason string and trigger pointless retries for non-retryable
 * conditions like "contributor not habilitated".
 */
@Processor(FISCAL_DIAN_QUERIES_QUEUE)
export class NumberingRangeProcessor extends WorkerHost {
  private readonly logger = new Logger(NumberingRangeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FISCAL_TRANSMISSION_PORT)
    private readonly transmission: FiscalTransmissionPort,
    @Inject(SECRET_READER_PORT)
    private readonly secrets: SecretReaderPort,
    private readonly routeResolver: TransmissionRouteResolver,
  ) {
    super();
  }

  async process(
    job: Job<FetchNumberingRangesJobData>,
  ): Promise<NumberingRangeSyncResult> {
    const { subscriptionId } = job.data;
    this.logger.log(`Fetching numbering ranges for subscription ${subscriptionId}`);

    try {
      const ranges = await this.fetchRanges(subscriptionId);
      this.logger.log(
        `DIAN returned ${ranges.length} numbering range(s) for subscription ${subscriptionId}`,
      );
      return { ok: true, ranges };
    } catch (error: unknown) {
      const failure = this.toFailure(error);
      this.logger.warn(
        `Numbering-range sync failed for subscription ${subscriptionId}: ` +
          `[${failure.errorCode}] ${failure.message}`,
      );
      return failure;
    }
  }

  /**
   * Resolves issuer config, environment, and certificate material, then
   * queries DIAN. accountCodeT carries the software-owner NIT, which equals
   * the tenant NIT under own-software mode (Annex §7.15 example sends both
   * equal); a provider-owned-software mode would need the provider NIT here.
   */
  private async fetchRanges(subscriptionId: string): Promise<DianNumberingRange[]> {
    const issuerConfig = await this.prisma.fiscalIssuerConfig.findFirst({
      where: { subscriptionId },
    });
    if (!issuerConfig) {
      throw new MissingConfigurationDomainException(
        'ISSUER_CONFIG_MISSING',
        `No FiscalIssuerConfig found for subscription ${subscriptionId}`,
      );
    }

    const techConfig = await this.prisma.techProviderConfig.findFirst({
      where: { subscriptionId },
    });
    if (!techConfig) {
      throw new MissingConfigurationDomainException(
        'TECH_PROVIDER_CONFIG_MISSING',
        `No TechProviderConfig found for subscription ${subscriptionId}`,
      );
    }

    const route = await this.routeResolver.resolve(subscriptionId);
    const secretReference =
      route === 'PROVIDER' ? techConfig.credentialReference ?? '' : '';

    const secretData = await this.secrets.readSecret(subscriptionId, secretReference);

    return this.transmission.fetchNumberingRanges(
      secretData.certificate,
      secretData.password,
      techConfig.environment,
      // Both request fields are the NIT without verification digit.
      issuerConfig.nit,
      issuerConfig.nit,
    );
  }

  /** Translates any thrown error into the structured cross-app failure shape. */
  private toFailure(error: unknown): { ok: false; errorCode: NumberingRangeSyncErrorCode; message: string } {
    if (error instanceof DianNumberingRangeOperationException) {
      return { ok: false, errorCode: this.mapDianCode(error.operationCode), message: error.message };
    }
    if (
      error instanceof DomainException &&
      error.errorCode.startsWith('FISCAL_CERTIFICATE')
    ) {
      return { ok: false, errorCode: 'CERTIFICATE_UNUSABLE', message: error.message };
    }
    if (error instanceof DomainException) {
      const code = error.errorCode as NumberingRangeSyncErrorCode;
      return { ok: false, errorCode: code, message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    const errorCode: NumberingRangeSyncErrorCode =
      /DIAN HTTP|fetch failed|network/i.test(message) ? 'DIAN_UNAVAILABLE' : 'UNEXPECTED';
    return { ok: false, errorCode, message };
  }

  private mapDianCode(operationCode: string): NumberingRangeSyncErrorCode {
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
}

/**
 * Worker-side precondition failure carrying a stable cross-app error code.
 * Uses the engine's duplicated DomainException base so classification stays
 * instanceof-based rather than string-matching messages.
 */
class MissingConfigurationDomainException extends DomainException {
  constructor(errorCode: string, message: string) {
    super(errorCode, message);
  }
}
