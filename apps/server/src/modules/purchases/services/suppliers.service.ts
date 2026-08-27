import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { searchIdsIgnoringAccents } from '@/common/text/accent-insensitive-search';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { Prisma, SupplierIdentificationType } from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import * as crypto from 'crypto';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { DuplicateSupplierIdentificationException } from '../exceptions/duplicate-supplier-identification.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import type { SupplierSyncData } from '@/modules/sync/dto/purchase-sync-payloads';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(query: any): Promise<any> {
    const where: Prisma.SupplierWhereInput = {};
    if (query.search) {
      // Accent-insensitive match; see searchIdsIgnoringAccents.
      const ids = await searchIdsIgnoringAccents(
        this.prisma,
        'Supplier',
        ['businessName', 'identificationNumber'],
        query.search,
      );
      where.id = { in: ids };
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const [suppliers, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { businessName: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return {
      data: suppliers,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findById(id: string): Promise<any> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new SupplierNotFoundException(id);
    }
    return supplier;
  }

  /**
   * Sync-pull suppliers with cursor-based pagination.
   *
   * Designed for POS hydration on a new device: incremental pulls via
   * `updatedSince` and resumable pulls via opaque `cursor`. Walks
   * (updatedAt asc, id asc) so the keyset stays consistent with the
   * cursor helper's OR condition.
   *
   * Shape: { data, nextCursor, hasMore } — POS handles both this shape
   * and the catalog variant { items, nextCursor, hasMore }.
   * Tenant isolation: explicit subscriptionId filter (RLS also applies).
   */
  async findSync(input: {
    updatedSince?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{
    data: unknown[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const baseWhere: Prisma.SupplierWhereInput = {
      subscriptionId: this.tenantContext.getSubscriptionId(),
    };
    if (input.updatedSince) {
      baseWhere.updatedAt = { gte: new Date(input.updatedSince) };
    }

    const page = await paginateWithCursor<
      unknown,
      Prisma.SupplierWhereInput,
      Prisma.SupplierOrderByWithRelationInput
    >({
      model: this.prisma.supplier,
      baseWhere,
      limit: input.limit ?? 200,
      cursor: input.cursor ?? null,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });

    return {
      data: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async create(createDto: CreateSupplierDto, userId: string): Promise<any> {
    try {
      return await this.prisma.supplier.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          ...createDto,
          createdById: userId,
        },
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        throw new DuplicateSupplierIdentificationException(
          createDto.identificationType,
          createDto.identificationNumber,
        );
      }
      throw error;
    }
  }

  async update(id: string, updateDto: UpdateSupplierDto): Promise<any> {
    await this.findById(id); // Check if supplier exists
    try {
      return await this.prisma.supplier.update({
        where: { id },
        data: updateDto,
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        throw new DuplicateSupplierIdentificationException(
          updateDto.identificationType || '',
          updateDto.identificationNumber || '',
        );
      }
      throw error;
    }
  }

  async remove(id: string): Promise<any> {
    await this.findById(id); // Check if supplier exists
    return this.prisma.supplier.delete({ where: { id } });
  }

  /**
   * Resolves a supplier reference during sync processing.
   *
   * 1. Looks up the supplier by ID.
   * 2. If found, returns it.
   * 3. If not found and `data` is provided, creates the supplier with the
   *    given ID using the provided fields (offline-first upsert by ID).
   * 4. If not found and no data, creates a minimal placeholder supplier so
   *    that legacy sync payloads (enqueued before the enriched format) can
   *    still succeed. The placeholder uses the supplierId as a human-readable
   *    marker and can be enriched via the REST API later.
   *
   * This ensures existing queued operations eventually resolve instead of
   * retrying forever.
   */
  async resolveSupplierForSync(
    tx: Prisma.TransactionClient,
    supplierId: string,
    data?: SupplierSyncData,
    userId?: string,
  ): Promise<{ id: string }> {
    const existing = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (existing) {
      return existing;
    }

    if (data) {
      return tx.supplier.create({
        data: {
          id: supplierId,
          subscriptionId: this.tenantContext.getSubscriptionId(),
          businessName: data.businessName,
          identificationType:
            data.identificationType as SupplierIdentificationType,
          identificationNumber: data.identificationNumber,
          contactName: data.contactName ?? null,
          phone: data.phone ?? null,
          email: data.email ?? null,
          address: data.address ?? null,
          city: data.city ?? null,
          country: data.country ?? 'CO',
          paymentTermsDays: data.paymentTermsDays ?? 0,
          creditLimit: new Prisma.Decimal(data.creditLimit ?? 0),
          isActive: true,
          createdById: userId ?? 'system',
        },
        select: { id: true },
      });
    }

    // Legacy payload fallback: create a minimal placeholder supplier.
    // The supplierId is used as the identification suffix to guarantee
    // uniqueness on the [identificationType, identificationNumber] constraint.
    const shortId = supplierId.replace(/-/g, '').slice(0, 16);
    return tx.supplier.create({
      data: {
        id: supplierId,
        subscriptionId: this.tenantContext.getSubscriptionId(),
        businessName: `Proveedor POS (${shortId})`,
        identificationType: SupplierIdentificationType.NIT,
        identificationNumber: `SYNC-${shortId}`,
        isActive: true,
        createdById: userId ?? 'system',
      },
      select: { id: true },
    });
  }
}
