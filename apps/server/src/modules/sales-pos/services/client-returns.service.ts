import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { Prisma, ClientReturnState, ShiftState, SaleOperationalState } from '@pharmacy/database';
import * as crypto from 'crypto';
import { CreateClientReturnDto } from '../dto/create-client-return.dto';
import { RejectClientReturnDto } from '../dto/reject-client-return.dto';
import { AnnulClientReturnDto } from '../dto/annul-client-return.dto';
import { ClientReturnNotFoundException } from '../exceptions/client-return-not-found.exception';
import { ClientReturnNotDraftException } from '../exceptions/client-return-not-draft.exception';
import { ClientReturnCannotBeAnnulledException } from '../exceptions/client-return-cannot-be-annulled.exception';
import { ReturnQuantityExceedsAvailableException } from '../exceptions/return-quantity-exceeds-available.exception';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';
import { SaleNotConfirmedException } from '../exceptions/sale-not-confirmed.exception';
import { CashShiftNotOpenForWorkstationException } from '../exceptions/cash-shift-not-open-for-workstation.exception';
import { ClientReturnCalculatorService } from './client-return-calculator.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

@Injectable()
export class ClientReturnsService {
  constructor(
    private prisma: PrismaService,
    private lotsService: LotsService,
    private calc: ClientReturnCalculatorService,
    private fiscalDocumentsService: FiscalDocumentsService,
  ) {}

  async findAll(query: { page?: number; pageSize?: number; state?: string }): Promise<any> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const where: Prisma.ClientReturnWhereInput = {};
    if (query.state) where.state = query.state as ClientReturnState;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.clientReturn.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, include: { sale: true, client: true, items: true } }),
      this.prisma.clientReturn.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string): Promise<any> {
    const ret = await this.prisma.clientReturn.findUnique({
      where: { id },
      include: { sale: true, client: true, items: { include: { lots: true } } },
    });
    if (!ret) throw new ClientReturnNotFoundException(id);

    // ClientReturnItemLot has lotId as a scalar with no Prisma-level relation.
    // Fetch lots separately.
    const lotIds = [...new Set(ret.items.flatMap((i: any) => i.lots.map((l: any) => l.lotId)))];
    const lots = lotIds.length > 0
      ? await this.prisma.lot.findMany({ where: { id: { in: lotIds } } })
      : [];
    const lotMap = new Map(lots.map((l) => [l.id, l]));
    ret.items = ret.items.map((item: any) => ({
      ...item,
      lots: item.lots.map((l: any) => ({ ...l, lot: lotMap.get(l.lotId) ?? null })),
    }));

    return ret;
  }

  async create(createDto: CreateClientReturnDto, userId: string, workstationId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const { sale, cashShift } = await this.validatePreconditions(tx, createDto, userId, workstationId);
      const refundMethodId = createDto.refundMethodId ?? (await this.calc.getDefaultRefundMethod(tx, sale.id));
      const itemsData = await Promise.all(
        createDto.items.map((item) => this.calc.prepareReturnItem(tx, sale.id, item)),
      );
      const subtotalReturned = itemsData.reduce((s, i) => s.plus(i.totalAmount.minus(i.taxAmount)), new Prisma.Decimal(0));
      const taxReturned = itemsData.reduce((s, i) => s.plus(i.taxAmount), new Prisma.Decimal(0));
      const refundAmount = subtotalReturned.plus(taxReturned);
      const sequentialNumber = await this.calc.getNextSequentialNumber(tx);
      return tx.clientReturn.create({
        data: {
          id: crypto.randomUUID(), sequentialNumber, saleId: sale.id, clientId: sale.clientId!,
          refundAmount, subtotalReturned, taxReturned, refundMethodId, reason: createDto.reason,
          cashShiftId: cashShift.id, workstationId: cashShift.workstationId, createdById: userId,
          items: { create: itemsData.map((item) => ({
            id: crypto.randomUUID(), saleItemId: item.saleItemId, quantity: item.quantity,
            unitPriceAtSale: item.unitPriceAtSale, unitPriceAtReturn: item.unitPriceAtReturn,
            taxAmount: item.taxAmount, totalAmount: item.totalAmount,
            lots: { create: item.lots.map((l) => ({ id: crypto.randomUUID(), lotId: l.lotId, quantity: l.quantity })) },
          })) },
        },
        include: { items: { include: { lots: true } } },
      });
    });
  }

  async markPendingPickup(id: string): Promise<any> {
    const ret = await this.prisma.clientReturn.findUnique({ where: { id } });
    if (!ret) throw new ClientReturnNotFoundException(id);
    if (ret.state !== ClientReturnState.DRAFT) throw new ClientReturnNotDraftException(id);
    return this.prisma.clientReturn.update({ where: { id }, data: { state: ClientReturnState.PENDING_PICKUP } });
  }

  async confirm(id: string, _userId: string): Promise<any> {
    let fiscalDocumentId: string | null = null;

    const result = await this.prisma.$transaction(async (tx) => {
      const ret = await this.requireReturn(tx, id);
      if (ret.state !== ClientReturnState.DRAFT && ret.state !== ClientReturnState.PENDING_PICKUP) {
        throw new ClientReturnNotDraftException(id);
      }
      for (const item of ret.items) {
        const alreadyReturned = await this.calc.getAlreadyReturnedQuantity(tx, item.saleItemId);
        const saleItem = await tx.saleItem.findUnique({ where: { id: item.saleItemId } });
        const available = (saleItem?.quantity || 0) - alreadyReturned;
        if (item.quantity > available) throw new ReturnQuantityExceedsAvailableException(item.saleItemId, item.quantity, available);
      }
      for (const item of ret.items) {
        for (const lot of item.lots) {
          await this.lotsService.receiveStockFromClientReturn({ lotId: lot.lotId, quantity: lot.quantity, clientReturnId: ret.id, tx });
        }
      }

      const updatedReturn = await tx.clientReturn.update({
        where: { id },
        data: { state: ClientReturnState.CONFIRMED },
      });

      // Create a CREDIT_NOTE referencing the sale's validated INVOICE.
      // Every sale always produces an INVOICE (using final-consumer identity
      // when no client is registered), so the credit note always has a valid
      // invoice to reference. Runs inside the same transaction so a fiscal
      // failure rolls back the entire confirm.
      const fiscalDoc =
        await this.fiscalDocumentsService.createPendingDocumentForClientReturn({
          clientReturnId: id,
          tx,
        });
      fiscalDocumentId = fiscalDoc.id;

      return updatedReturn;
    });

    // Enqueue only after the transaction has committed successfully
    if (fiscalDocumentId) {
      await this.fiscalDocumentsService.enqueueGenerationJob(fiscalDocumentId);
    }

    return result;
  }

  async reject(id: string, dto: RejectClientReturnDto): Promise<any> {
    const ret = await this.prisma.clientReturn.findUnique({ where: { id } });
    if (!ret) throw new ClientReturnNotFoundException(id);
    if (ret.state !== ClientReturnState.DRAFT && ret.state !== ClientReturnState.PENDING_PICKUP) throw new ClientReturnNotDraftException(id);
    return this.prisma.clientReturn.update({ where: { id }, data: { state: ClientReturnState.REJECTED, reason: dto.reason } });
  }

  async annul(id: string, userId: string, dto: AnnulClientReturnDto): Promise<any> {
    const ret = await this.prisma.clientReturn.findUnique({ where: { id } });
    if (!ret) throw new ClientReturnNotFoundException(id);
    if (ret.state === ClientReturnState.CONFIRMED) throw new ClientReturnCannotBeAnnulledException(id);
    return this.prisma.clientReturn.update({
      where: { id },
      data: { state: ClientReturnState.ANNULLED, annulledAt: new Date(), annulledById: userId, annulmentReason: dto.annulmentReason },
    });
  }

  private async validatePreconditions(tx: Prisma.TransactionClient, dto: CreateClientReturnDto, userId: string, workstationId: string): Promise<{ sale: any; cashShift: any }> {
    const sale = await tx.sale.findUnique({ where: { id: dto.saleId } });
    if (!sale) throw new SaleNotFoundException(dto.saleId);
    if (sale.operationalState !== SaleOperationalState.CONFIRMED) throw new SaleNotConfirmedException(dto.saleId);
    const cashShift = await tx.cashShift.findFirst({ where: { userId, workstationId, state: ShiftState.OPEN } });
    if (!cashShift) throw new CashShiftNotOpenForWorkstationException(workstationId);
    return { sale, cashShift };
  }

  private async requireReturn(tx: Prisma.TransactionClient, id: string): Promise<any> {
    const ret = await tx.clientReturn.findUnique({ where: { id }, include: { items: { include: { lots: true } } } });
    if (!ret) throw new ClientReturnNotFoundException(id);
    return ret;
  }
}
