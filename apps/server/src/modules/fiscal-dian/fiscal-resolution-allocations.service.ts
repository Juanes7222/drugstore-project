import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import type { FiscalResolutionAllocation } from '@pharmacy/database';
import { CreateFiscalResolutionAllocationDto } from './dto/create-fiscal-resolution-allocation.dto';
import { AllocationRangeInvalidException } from './exceptions/allocation-range-invalid.exception';

@Injectable()
export class FiscalResolutionAllocationsService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Paginated list of all allocations. */
  async findAll(page = 1, pageSize = 20): Promise<any> {
    const [data, total] = await Promise.all([
      this.prisma.fiscalResolutionAllocation.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { allocatedAt: 'desc' },
      }),
      this.prisma.fiscalResolutionAllocation.count(),
    ]);
    return { data, total, page, pageSize };
  }

  /** Returns a single allocation by id. */
  async findById(id: string): Promise<any> {
    return this.prisma.fiscalResolutionAllocation.findUnique({
      where: { id },
    });
  }

  /** Returns the most recently allocated range of a resolution, or null. */
  async findLatestForResolution(
    resolutionId: string,
  ): Promise<FiscalResolutionAllocation | null> {
    return this.prisma.fiscalResolutionAllocation.findFirst({
      where: { resolutionId },
      orderBy: { allocatedAt: 'desc' },
    });
  }

  /**
   * Creates a new allocation after validating its range falls within the
   * parent resolution's bounds and does not overlap any existing allocation
   * from that resolution.
   */
  async create(
    dto: CreateFiscalResolutionAllocationDto,
    allocatedByUserId: string,
  ): Promise<any> {
    if (dto.rangeFrom > dto.rangeTo) {
      throw new AllocationRangeInvalidException(
        'Range start must not exceed range end',
      );
    }

    const resolution = await this.prisma.fiscalResolution.findUnique({
      where: { id: dto.resolutionId },
    });
    if (!resolution) {
      throw new AllocationRangeInvalidException('Resolution not found');
    }
    if (
      dto.rangeFrom < resolution.rangeFrom ||
      dto.rangeTo > resolution.rangeTo
    ) {
      throw new AllocationRangeInvalidException(
        'Allocation range must fall within the resolution range',
      );
    }

    await this.assertNoOverlappingAllocation(dto);

    return this.prisma.fiscalResolutionAllocation.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId: this.tenantContext.getSubscriptionId(),
        resolutionId: dto.resolutionId,
        workstationId: dto.workstationId,
        rangeFrom: dto.rangeFrom,
        rangeTo: dto.rangeTo,
        // Counter is a count of documents issued so far (0 = none). The
        // issued number is rangeFrom + currentConsecutive - 1, so seeding
        // rangeFrom - 1 here made the first document 2*rangeFrom - 1 for any
        // range starting above 1 — immediately exhausting real DIAN ranges
        // such as [100001..200000]. Zero keeps the first document at rangeFrom.
        currentConsecutive: 0,
        allocatedAt: new Date(),
        allocatedByUserId,
      },
    });
  }

  /** Throws if another allocation from the same resolution overlaps [rangeFrom, rangeTo]. */
  private async assertNoOverlappingAllocation(
    dto: CreateFiscalResolutionAllocationDto,
  ): Promise<void> {
    const overlapping = await this.prisma.fiscalResolutionAllocation.findFirst({
      where: {
        resolutionId: dto.resolutionId,
        rangeFrom: { lt: dto.rangeTo },
        rangeTo: { gt: dto.rangeFrom },
      },
    });

    if (overlapping) {
      throw new AllocationRangeInvalidException(
        'Allocation range overlaps an existing allocation from the same resolution',
      );
    }
  }
}
