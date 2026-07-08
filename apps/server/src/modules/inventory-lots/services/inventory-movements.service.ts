import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, MovementType } from '@pharmacy/database';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

/**
 * Lists inventory movements (the immutable stock-change ledger).
 * Movements are read-only after creation — no update/delete endpoints exist.
 */
@Injectable()
export class InventoryMovementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryInventoryMovementDto): Promise<any> {
    const where: Prisma.InventoryMovementWhereInput = {};
    if (query.lotId) where.lotId = query.lotId;
    if (query.movementType) where.movementType = query.movementType as MovementType;
    if (query.createdAtFrom) where.createdAt = { gte: new Date(query.createdAtFrom) };
    if (query.createdAtTo) {
      const dateFilter = where.createdAt as Prisma.DateTimeFilter || {};
      (dateFilter as Prisma.DateTimeFilter).lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }

    const [movements, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          lot: {
            select: { id: true, batchNumber: true, productId: true, currentStock: true, state: true },
          },
          createdByUser: {
            select: { id: true, fullName: true, username: true },
          },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return { data: movements, total, page: query.page, pageSize: query.pageSize };
  }
}
