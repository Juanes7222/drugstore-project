import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { FiscalDocumentType } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';
import { InvalidResolutionRangeException } from '../exceptions/invalid-resolution-range.exception';
import { OverlappingActiveResolutionException } from '../exceptions/overlapping-active-resolution.exception';
import {
  DianRangeConflictException,
  type DianRangeConflict,
} from '../exceptions/dian-range-conflict.exception';
import type {
  ApplyDianRangesOptions,
  DianRangeApplyResult,
  DianRangeInput,
} from './dian-range-apply-result.type';

@Injectable()
export class FiscalResolutionsService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Paginated list of fiscal resolutions, optionally filtered by state. */
  async findAll(query: QueryFiscalResolutionsDto): Promise<any> {
    const where: any = {};
    if (query.state) where.state = query.state;

    const [data, total] = await Promise.all([
      this.prisma.fiscalResolution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fiscalResolution.count({ where }),
    ]);
    return { data, total, page: query.page, pageSize: query.pageSize };
  }

  /** Returns a single resolution by id. */
  async findById(id: string): Promise<any> {
    return this.prisma.fiscalResolution.findUnique({
      where: { id },
    });
  }

  /**
   * Creates a new FiscalResolution after validating range order and
   * checking for overlapping ACTIVE resolutions on the same
   * (workstationId, documentType, prefix) tuple, including null-null match.
   */
  async create(dto: CreateFiscalResolutionDto): Promise<any> {
    if (dto.rangeFrom > dto.rangeTo) {
      throw new InvalidResolutionRangeException();
    }

    await this.assertNoOverlap(dto.documentType, dto.prefix, dto.workstationId ?? null);

    return this.prisma.fiscalResolution.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: this.tenantContext.getSubscriptionId(),
        resolutionNumber: dto.resolutionNumber,
        documentType: dto.documentType,
        prefix: dto.prefix,
        rangeFrom: dto.rangeFrom,
        rangeTo: dto.rangeTo,
        validFrom: new Date(dto.validFrom),
        validTo: new Date(dto.validTo),
        workstationId: dto.workstationId ?? null,
        state: 'ACTIVE',
        currentConsecutive: 0,
      },
    });
  }

  /**
   * Applies the ranges fetched from DIAN's GetNumberingRange to the local
   * catalog — the write half of the "sync resolutions from DIAN" flow.
   *
   * Per range (all-or-nothing inside the ambient request transaction):
   *   - identical ACTIVE row already present  → skipped (idempotent re-sync)
   *   - validity window already over          → skipped EXPIRED
   *   - same resolution number, other data    → conflict
   *   - new range on a taken active tuple     → conflict
   *   - otherwise                             → created (state ACTIVE)
   *
   * Any conflict throws DianRangeConflictException and rolls everything
   * back; the admin fixes the catalog manually and retries. Runs against the
   * request-scoped transaction via the tenant-aware proxy — do NOT open a
   * nested $transaction here.
   */
  async applyDianRanges(
    ranges: DianRangeInput[],
    options: ApplyDianRangesOptions = {},
  ): Promise<DianRangeApplyResult> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    const conflicts: DianRangeConflict[] = [];
    const created: DianRangeApplyResult['created'] = [];
    const skipped: DianRangeApplyResult['skipped'] = [];

    for (const range of ranges) {
      const validFrom = new Date(range.validFrom);
      const validTo = new Date(range.validTo);

      if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) {
        conflicts.push({
          resolutionNumber: range.resolutionNumber,
          prefix: range.prefix,
          reason: 'DIAN returned an unparseable validity date',
        });
        continue;
      }

      // Conservative cutoff: a window ending before now is not worth creating.
      // A range that ends today stays eligible so same-day renewals sync.
      if (validTo.getTime() < Date.now()) {
        skipped.push({
          resolutionNumber: range.resolutionNumber,
          prefix: range.prefix,
          reason: 'EXPIRED',
        });
        continue;
      }

      const documentType = this.mapPrefixToDocumentType(range.prefix);

      const existing = await this.prisma.fiscalResolution.findFirst({
        where: { subscriptionId, resolutionNumber: range.resolutionNumber },
      });

      if (existing) {
        const identical =
          existing.prefix === range.prefix &&
          existing.documentType === documentType &&
          existing.rangeFrom === range.fromNumber &&
          existing.rangeTo === range.toNumber &&
          existing.validFrom.getTime() === validFrom.getTime() &&
          existing.validTo.getTime() === validTo.getTime();

        if (identical && existing.state === 'ACTIVE') {
          skipped.push({
            resolutionNumber: range.resolutionNumber,
            prefix: range.prefix,
            reason: 'IDENTICAL_EXISTS',
          });
        } else {
          conflicts.push({
            resolutionNumber: range.resolutionNumber,
            prefix: range.prefix,
            reason: identical
              ? `Identical DIAN data but local state is ${existing.state}`
              : 'Same resolution number exists with different data',
          });
        }
        continue;
      }

      try {
        await this.assertNoOverlap(documentType, range.prefix, null);
      } catch {
        conflicts.push({
          resolutionNumber: range.resolutionNumber,
          prefix: range.prefix,
          reason:
            'A different ACTIVE resolution already occupies this (documentType, prefix) tuple',
        });
        continue;
      }

      const row = await this.prisma.fiscalResolution.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId,
          resolutionNumber: range.resolutionNumber,
          documentType,
          prefix: range.prefix,
          rangeFrom: range.fromNumber,
          rangeTo: range.toNumber,
          validFrom,
          validTo,
          // Master resolutions are workstation-agnostic; allocations slice
          // them per workstation afterwards.
          workstationId: null,
          state: 'ACTIVE',
          currentConsecutive: 0,
        },
      });
      created.push({
        resolutionId: row.id,
        resolutionNumber: range.resolutionNumber,
        prefix: range.prefix,
        documentType,
        rangeFrom: range.fromNumber,
        rangeTo: range.toNumber,
      });
    }

    if (conflicts.length > 0) {
      throw new DianRangeConflictException(conflicts);
    }

    return { created, skipped, conflicts };
  }

  /**
   * Maps a DIAN numbering-range prefix to a FiscalDocumentType by Colombian
   * invoicing convention (NS = POS ticket, NC/ND = credit/debit note, FV and
   * everything else = electronic invoice). DIAN's service does not expose
   * the document type explicitly; promote to stored config if real-world
   * prefixes break this heuristic.
   */
  private mapPrefixToDocumentType(prefix: string): FiscalDocumentType {
    const normalized = prefix.trim().toUpperCase();
    if (normalized.startsWith('NS')) return 'POS_TICKET';
    if (normalized.startsWith('NC')) return 'CREDIT_NOTE';
    if (normalized.startsWith('ND')) return 'DEBIT_NOTE';
    return 'INVOICE';
  }

  /** Throws if an ACTIVE resolution overlaps on (workstationId, documentType, prefix). */
  private async assertNoOverlap(
    documentType: FiscalDocumentType,
    prefix: string,
    workstationId: string | null,
  ): Promise<void> {
    const existing = await this.prisma.fiscalResolution.findFirst({
      where: {
        state: 'ACTIVE',
        documentType,
        prefix,
        workstationId,
      },
    });

    if (existing) {
      throw new OverlappingActiveResolutionException(documentType, prefix);
    }
  }
}
