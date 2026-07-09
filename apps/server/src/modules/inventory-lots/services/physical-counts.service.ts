import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { Prisma, PhysicalCountState, AdjustmentState, MovementType } from '@pharmacy/database';
import * as crypto from 'crypto';
import { StartPhysicalCountDto } from '../dto/start-physical-count.dto';
import { RegisterPhysicalCountLineDto } from '../dto/register-physical-count-line.dto';
import { PhysicalCountNotFoundException } from '../exceptions/physical-count-not-found.exception';
import { PhysicalCountNotOpenException } from '../exceptions/physical-count-not-open.exception';
import { PhysicalCountNotCountedException } from '../exceptions/physical-count-not-counted.exception';
import { PhysicalCountNotReviewedException } from '../exceptions/physical-count-not-reviewed.exception';
import { PhysicalCountNotApprovedException } from '../exceptions/physical-count-not-approved.exception';
import { PhysicalCountCannotBeAnnulledException } from '../exceptions/physical-count-cannot-be-annulled.exception';
import { LotNotFoundException } from '../exceptions/lot-not-found.exception';

@Injectable()
export class PhysicalCountsService {
  constructor(
    private prisma: PrismaService,
    private inventoryAdjustmentsService: InventoryAdjustmentsService,
  ) {}

  async findAll(query: { page?: number; pageSize?: number; state?: string }): Promise<any> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: Prisma.PhysicalCountWhereInput = {};
    if (query.state) where.state = query.state as PhysicalCountState;

    const [counts, total] = await this.prisma.$transaction([
      this.prisma.physicalCount.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.physicalCount.count({ where }),
    ]);
    return { data: counts, total, page, pageSize };
  }

  async findOne(id: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({
      where: { id },
      include: { adjustmentDocuments: true },
    });
    if (!count) throw new PhysicalCountNotFoundException(id);

    // Fetch adjustment movements separately: InventoryMovement has adjustmentDocumentId as a
    // scalar with no Prisma-level relation declared.
    const adjustmentDocIds = count.adjustmentDocuments.map((d: any) => d.id);
    const movements = adjustmentDocIds.length > 0
      ? await this.prisma.inventoryMovement.findMany({
          where: { adjustmentDocumentId: { in: adjustmentDocIds } },
          include: { lot: true },
        })
      : [];
    const movementsByDocId = new Map<string, any[]>();
    for (const m of movements) {
      const list = movementsByDocId.get(m.adjustmentDocumentId!) ?? [];
      list.push(m);
      movementsByDocId.set(m.adjustmentDocumentId!, list);
    }
    return {
      ...count,
      adjustmentDocuments: count.adjustmentDocuments.map((d: any) => ({
        ...d,
        movements: movementsByDocId.get(d.id) ?? [],
      })),
    };
  }

  async start(dto: StartPhysicalCountDto, userId: string): Promise<any> {
    const sequentialNumber = await this.getNextSequentialNumber();
    return this.prisma.physicalCount.create({
      data: {
        id: crypto.randomUUID(),
        sequentialNumber,
        startedAt: new Date(),
        startedByUserId: userId,
        notes: dto.notes,
      },
    });
  }

  async registerCount(id: string, dto: RegisterPhysicalCountLineDto, userId: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({ where: { id } });
    if (!count) throw new PhysicalCountNotFoundException(id);
    if (count.state !== PhysicalCountState.OPEN) throw new PhysicalCountNotOpenException(id);

    const lot = await this.prisma.lot.findUnique({ where: { id: dto.lotId } });
    if (!lot) throw new LotNotFoundException(dto.lotId);

    const expected = lot.currentStock;
    if (dto.countedQuantity === expected) return { matched: true };

    // Find and annul any existing DRAFT adjustment document for this lot
    // Fetch the movement separately: InventoryMovement has adjustmentDocumentId as a scalar
    // with no Prisma-level relation declared.
    const existingDoc = await this.prisma.inventoryAdjustmentDocument.findFirst({
      where: { physicalCountId: id, state: AdjustmentState.DRAFT },
    });
    const existingMovements = existingDoc
      ? await this.prisma.inventoryMovement.findMany({
          where: { adjustmentDocumentId: existingDoc.id, lotId: dto.lotId },
          take: 1,
        })
      : [];
    if (existingDoc && existingMovements.length > 0) {
      await this.inventoryAdjustmentsService.annul(existingDoc.id, userId, {
        annulmentReason: 'Superseded by recount',
      });
    }

    const diff = dto.countedQuantity - expected;
    const movementType = diff > 0 ? MovementType.POSITIVE_ADJUSTMENT : MovementType.NEGATIVE_ADJUSTMENT;

    return this.inventoryAdjustmentsService.create(
      {
        reason: 'Physical count adjustment',
        items: [{ lotId: dto.lotId, movementType, quantity: Math.abs(diff) }],
      },
      userId,
      id,
    );
  }

  async finish(id: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({ where: { id } });
    if (!count) throw new PhysicalCountNotFoundException(id);
    if (count.state !== PhysicalCountState.OPEN) throw new PhysicalCountNotOpenException(id);

    return this.prisma.physicalCount.update({
      where: { id },
      data: { state: PhysicalCountState.COUNTED, finishedAt: new Date() },
    });
  }

  async review(id: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({ where: { id } });
    if (!count) throw new PhysicalCountNotFoundException(id);
    if (count.state !== PhysicalCountState.COUNTED) throw new PhysicalCountNotCountedException(id);

    return this.prisma.physicalCount.update({
      where: { id },
      data: { state: PhysicalCountState.REVIEWED },
    });
  }

  async approve(id: string, userId: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({
      where: { id },
      include: { adjustmentDocuments: { where: { state: AdjustmentState.DRAFT } } },
    });
    if (!count) throw new PhysicalCountNotFoundException(id);
    if (count.state !== PhysicalCountState.REVIEWED) throw new PhysicalCountNotReviewedException(id);

    for (const adjDoc of count.adjustmentDocuments) {
      await this.inventoryAdjustmentsService.submit(adjDoc.id, userId);
      await this.inventoryAdjustmentsService.approve(adjDoc.id, userId, { approvalNotes: undefined });
    }

    return this.prisma.physicalCount.update({
      where: { id },
      data: { state: PhysicalCountState.APPROVED, approvedAt: new Date(), approvedByUserId: userId },
    });
  }

  async apply(id: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.physicalCount.findUnique({
        where: { id },
        include: { adjustmentDocuments: { where: { state: AdjustmentState.APPROVED } } },
      });
      if (!count) throw new PhysicalCountNotFoundException(id);
      if (count.state !== PhysicalCountState.APPROVED) throw new PhysicalCountNotApprovedException(id);

      for (const adjDoc of count.adjustmentDocuments) {
        // Pass the shared transaction so all applies succeed or fail atomically
        await this.inventoryAdjustmentsService.apply(adjDoc.id, userId, tx);
      }

      return tx.physicalCount.update({
        where: { id },
        data: { state: PhysicalCountState.APPLIED, appliedAt: new Date() },
      });
    });
  }

  async annul(id: string, userId: string): Promise<any> {
    const count = await this.prisma.physicalCount.findUnique({
      where: { id },
      include: { adjustmentDocuments: { where: { state: { not: AdjustmentState.ANNULLED } } } },
    });
    if (!count) throw new PhysicalCountNotFoundException(id);
    if (count.state === PhysicalCountState.APPLIED) throw new PhysicalCountCannotBeAnnulledException(id);

    for (const adjDoc of count.adjustmentDocuments) {
      await this.inventoryAdjustmentsService.annul(adjDoc.id, userId, {
        annulmentReason: `Annulled by physical count ${id}`,
      });
    }

    return this.prisma.physicalCount.update({
      where: { id },
      data: { state: PhysicalCountState.ANNULLED },
    });
  }

  private async getNextSequentialNumber(): Promise<number> {
    const latest = await this.prisma.physicalCount.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber || 0) + 1;
  }
}
