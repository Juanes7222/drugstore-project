import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';
import { InvalidResolutionRangeException } from '../exceptions/invalid-resolution-range.exception';
import { OverlappingActiveResolutionException } from '../exceptions/overlapping-active-resolution.exception';

@Injectable()
export class FiscalResolutionsService {
  constructor(private prisma: PrismaService) {}

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

    await this.assertNoOverlap(dto);

    return this.prisma.fiscalResolution.create({
      data: {
        id: crypto.randomUUID(),
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

  /** Throws if an ACTIVE resolution overlaps on (workstationId, documentType, prefix). */
  private async assertNoOverlap(dto: CreateFiscalResolutionDto): Promise<void> {
    const existing = await this.prisma.fiscalResolution.findFirst({
      where: {
        state: 'ACTIVE',
        documentType: dto.documentType,
        prefix: dto.prefix,
        workstationId: dto.workstationId ?? null,
      },
    });

    if (existing) {
      throw new OverlappingActiveResolutionException(
        dto.documentType,
        dto.prefix,
      );
    }
  }
}
