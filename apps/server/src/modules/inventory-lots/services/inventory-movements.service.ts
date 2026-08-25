import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, MovementType } from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

// Only relations declared on the model. There is no createdByUser relation on
// InventoryMovement (createdById is a bare scalar) — an earlier version
// included it and would have failed Prisma's runtime validation.
const MOVEMENT_LIST_INCLUDE = {
  lot: {
    select: {
      id: true,
      batchNumber: true,
      productId: true,
      currentStock: true,
      state: true,
    },
  },
} satisfies Prisma.InventoryMovementInclude;

/**
 * Lists inventory movements (the immutable stock-change ledger).
 * Movements are read-only after creation — no update/delete endpoints exist.
 */
@Injectable()
export class InventoryMovementsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cursor mode walks (createdAt desc, id desc) so deep pages stay cheap on
   * the append-only ledger; the legacy offset path is kept for clients that
   * still send page/pageSize.
   */
  async findAll(query: QueryInventoryMovementDto): Promise<any> {
    const where = this.buildWhere(query);

    if (query.cursor) {
      const page = await paginateWithCursor<
        unknown,
        Prisma.InventoryMovementWhereInput,
        Prisma.InventoryMovementOrderByWithRelationInput,
        Prisma.InventoryMovementInclude
      >({
        model: this.prisma.inventoryMovement,
        baseWhere: where,
        limit: query.pageSize,
        cursor: query.cursor,
        timeField: 'createdAt',
        direction: 'desc',
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: MOVEMENT_LIST_INCLUDE,
      });
      return {
        data: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize: query.pageSize,
      };
    }

    const [movements, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: MOVEMENT_LIST_INCLUDE,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return {
      data: movements,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  private buildWhere(
    query: QueryInventoryMovementDto,
  ): Prisma.InventoryMovementWhereInput {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (query.lotId) where.lotId = query.lotId;
    if (query.movementType)
      where.movementType = query.movementType as MovementType;
    if (query.createdAtFrom || query.createdAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.createdAtFrom) dateFilter.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) dateFilter.lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }
    return where;
  }
}
