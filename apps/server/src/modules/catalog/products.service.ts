import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@pharmacy/database';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { RegisterProductPriceDto } from './dto/register-product-price.dto';
import { AssignProductTaxSchemeDto } from './dto/assign-product-tax-scheme.dto';
import { AddProductBarcodeDto } from './dto/add-product-barcode.dto';
import { DuplicateActiveTaxSchemeException } from './exceptions/duplicate-active-tax-scheme.exception';
import { DuplicateBarcodeException } from './exceptions/duplicate-barcode.exception';
import { ProductNotFoundException } from './exceptions/product-not-found.exception';
import * as crypto from 'crypto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  /**
   * List products with optional filtering and search.
   * Used by ProductsController (GET /products).
   */
  async findAll(
    filters: Record<string, unknown>,
    search?: string,
  ): Promise<unknown[]> {
    const where: Prisma.ProductWhereInput = { ...filters };

    if (search) {
      where.OR = [
        { commercialName: { contains: search, mode: 'insensitive' } },
        { internalCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
        pharmaceuticalForm: true,
        barcodes: { where: { isPrimary: true }, take: 1 },
        priceHistories: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        costHistories: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        taxHistories: {
          include: { taxScheme: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
      orderBy: { commercialName: 'asc' },
    });

    return items.map((item) => ({
      ...item,
      currentPrice: item.priceHistories[0] ?? null,
      currentCost: item.costHistories[0] ?? null,
      currentTax: item.taxHistories[0] ?? null,
      priceHistories: undefined,
      costHistories: undefined,
      taxHistories: undefined,
    }));
  }

  /**
   * Find a single product by ID.
   * Used by ProductsController (GET /products/:id).
   */
  async findById(id: string): Promise<unknown> {
    const item = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        pharmaceuticalForm: true,
        barcodes: { orderBy: { isPrimary: 'desc' } },
        priceHistories: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        costHistories: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
        taxHistories: {
          include: { taxScheme: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!item) return null;

    return {
      ...item,
      currentPrice: item.priceHistories[0] ?? null,
      currentCost: item.costHistories[0] ?? null,
      currentTax: item.taxHistories[0] ?? null,
      priceHistories: undefined,
      costHistories: undefined,
      taxHistories: undefined,
    };
  }

  async createProduct(
    userId: string,
    dto: CreateProductDto,
    sourceOperationUuid?: string,
    sourceProductId?: string | null,
  ): Promise<any> {
    const priceDecimal = new Prisma.Decimal(dto.initialPrice);

    return this.prisma.$transaction(async (tx: any) => {
      const product = await tx.product.create({
        data: {
          id: sourceProductId ?? this.generateId(),
          internalCode: dto.internalCode,
          commercialName: dto.commercialName,
          concentration: dto.concentration || null,
          concentrationUnit: dto.concentrationUnit || null,
          laboratory: dto.laboratory,
          saleType: dto.saleType,
          minimumStock: dto.minimumStock || 0,
          discontinuationReason: dto.discontinuationReason || null,
          invimaRegistry: dto.invimaRegistry || null,
          atcCode: dto.atcCode || null,
          therapeuticIndication: dto.therapeuticIndication || null,
          storageConditions: dto.storageConditions || null,
          internalNotes: dto.internalNotes || null,
          categoryId: dto.categoryId || null,
          pharmaceuticalFormId: dto.pharmaceuticalFormId || null,
          commissionType: dto.commissionType,
          commissionValue: new Prisma.Decimal(dto.commissionValue),
          commissionStartsAt: dto.commissionStartsAt ? new Date(dto.commissionStartsAt) : null,
          commissionEndsAt: dto.commissionEndsAt ? new Date(dto.commissionEndsAt) : null,
          currentPriceId: null,
          currentTaxHistoryId: null,
          createdById: userId,
          sourceOperationUuid: sourceOperationUuid ?? null,
          sourceProductId: sourceProductId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const priceHistory = await tx.productPriceHistory.create({
        data: {
          id: this.generateId(),
          productId: product.id,
          price: priceDecimal,
          effectiveFrom: new Date(),
          changedById: userId,
          changedAt: new Date(),
        },
      });

      const taxHistory = await tx.productTaxHistory.create({
        data: {
          id: this.generateId(),
          productId: product.id,
          taxSchemeId: dto.initialTaxSchemeId,
          effectiveFrom: new Date(),
          changedById: userId,
          changedAt: new Date(),
        },
      });

      const updateData: Record<string, unknown> = {
        currentPriceId: priceHistory.id,
        currentTaxHistoryId: taxHistory.id,
      };

      if (dto.initialCost) {
        const costHistory = await tx.productCostHistory.create({
          data: {
            id: this.generateId(),
            productId: product.id,
            cost: new Prisma.Decimal(dto.initialCost),
            effectiveFrom: new Date(),
            changedById: userId,
            changedAt: new Date(),
          },
        });
        updateData.currentCostId = costHistory.id;
      }

      return tx.product.update({
        where: { id: product.id },
        data: updateData,
      });
    });
  }

  async updateProduct(
    productId: string,
    dto: UpdateProductDto,
    userId?: string,
  ): Promise<any> {
    const existing = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!existing) {
      throw new ProductNotFoundException(productId);
    }

    const updateData: any = {};

    if (dto.commercialName !== undefined) updateData.commercialName = dto.commercialName;
    if (dto.concentration !== undefined) updateData.concentration = dto.concentration;
    if (dto.concentrationUnit !== undefined) updateData.concentrationUnit = dto.concentrationUnit;
    if (dto.laboratory !== undefined) updateData.laboratory = dto.laboratory;
    if (dto.saleType !== undefined) updateData.saleType = dto.saleType;
    if (dto.minimumStock !== undefined) updateData.minimumStock = dto.minimumStock;
    if (dto.discontinuationReason !== undefined) updateData.discontinuationReason = dto.discontinuationReason;
    if (dto.invimaRegistry !== undefined) updateData.invimaRegistry = dto.invimaRegistry;
    if (dto.atcCode !== undefined) updateData.atcCode = dto.atcCode;
    if (dto.therapeuticIndication !== undefined) updateData.therapeuticIndication = dto.therapeuticIndication;
    if (dto.storageConditions !== undefined) updateData.storageConditions = dto.storageConditions;
    if (dto.internalNotes !== undefined) updateData.internalNotes = dto.internalNotes;
    if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
    if (dto.pharmaceuticalFormId !== undefined) updateData.pharmaceuticalFormId = dto.pharmaceuticalFormId;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.commissionType !== undefined) updateData.commissionType = dto.commissionType;
    if (dto.commissionValue !== undefined) updateData.commissionValue = new Prisma.Decimal(dto.commissionValue);
    // Explicit null clears the window bound; undefined leaves it untouched.
    if (dto.commissionStartsAt !== undefined) updateData.commissionStartsAt = dto.commissionStartsAt === null ? null : new Date(dto.commissionStartsAt);
    if (dto.commissionEndsAt !== undefined) updateData.commissionEndsAt = dto.commissionEndsAt === null ? null : new Date(dto.commissionEndsAt);

    updateData.updatedAt = new Date();

    // Accept multiple field name variants for price/cost/tax to handle
    // both REST API and POS sync conventions.
    const rawPrice = dto.unitPrice ?? dto.initialPrice;
    const rawCost = dto.initialCost ?? dto.cost;
    const rawTaxSchemeId = dto.initialTaxSchemeId;
    const needsPriceUpdate = rawPrice !== undefined;
    const needsCostUpdate = rawCost !== undefined;
    const needsTaxUpdate = rawTaxSchemeId !== undefined;

    if (!needsPriceUpdate && !needsCostUpdate && !needsTaxUpdate) {
      return this.prisma.product.update({
        where: { id: productId },
        data: updateData,
      });
    }

    return this.prisma.$transaction(async (tx: any) => {
      const txUpdateData = { ...updateData };

      if (needsPriceUpdate) {
        await this.closeActivePriceHistory(tx, productId);

        const priceHistory = await tx.productPriceHistory.create({
          data: {
            id: this.generateId(),
            productId,
            price: new Prisma.Decimal(rawPrice!),
            effectiveFrom: new Date(),
            changedById: userId ?? 'unknown',
            changedAt: new Date(),
            changeReason: 'Updated via product edit',
          },
        });
        txUpdateData.currentPriceId = priceHistory.id;
      }

      if (needsCostUpdate) {
        await this.closeActiveCostHistory(tx, productId);

        const costHistory = await tx.productCostHistory.create({
          data: {
            id: this.generateId(),
            productId,
            cost: new Prisma.Decimal(rawCost!),
            effectiveFrom: new Date(),
            changedById: userId ?? 'unknown',
            changedAt: new Date(),
            changeReason: 'Updated via product edit',
          },
        });
        txUpdateData.currentCostId = costHistory.id;
      }

      if (needsTaxUpdate) {
        await this.closeActiveTaxHistory(tx, productId);

        const taxHistory = await tx.productTaxHistory.create({
          data: {
            id: this.generateId(),
            productId,
            taxSchemeId: rawTaxSchemeId!,
            effectiveFrom: new Date(),
            changedById: userId ?? 'unknown',
            changedAt: new Date(),
            changeReason: 'Updated via product edit',
          },
        });
        txUpdateData.currentTaxHistoryId = taxHistory.id;
      }

      return tx.product.update({
        where: { id: productId },
        data: txUpdateData,
      });
    });
  }

  async registerPrice(
    productId: string,
    userId: string,
    dto: RegisterProductPriceDto,
  ): Promise<any> {
    const existing = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!existing) {
      throw new ProductNotFoundException(productId);
    }

    const priceDecimal = new Prisma.Decimal(dto.price);
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.prisma.$transaction(async (tx: any) => {
      await this.closeActivePriceHistory(tx, productId);

      const newPriceHistory = await tx.productPriceHistory.create({
        data: {
          id: this.generateId(),
          productId,
          price: priceDecimal,
          effectiveFrom,
          changedById: userId,
          changedAt: new Date(),
          changeReason: dto.changeReason || null,
        },
      });

      await tx.product.update({
        where: { id: productId },
        data: { currentPriceId: newPriceHistory.id },
      });

      return newPriceHistory;
    });
  }

  async assignTaxScheme(
    productId: string,
    userId: string,
    dto: AssignProductTaxSchemeDto,
  ): Promise<any> {
    const existing = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!existing) {
      throw new ProductNotFoundException(productId);
    }

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.prisma.$transaction(async (tx: any) => {
      await this.closeActiveTaxHistory(tx, productId);

      const newTaxHistory = await tx.productTaxHistory.create({
        data: {
          id: this.generateId(),
          productId,
          taxSchemeId: dto.taxSchemeId,
          effectiveFrom,
          changedById: userId,
          changedAt: new Date(),
          changeReason: dto.changeReason || null,
        },
      });

      await tx.product.update({
        where: { id: productId },
        data: { currentTaxHistoryId: newTaxHistory.id },
      });

      return newTaxHistory;
    });
  }

  async addBarcode(
    productId: string,
    dto: AddProductBarcodeDto,
  ): Promise<any> {
    if (dto.isPrimary) {
      return this.prisma.$transaction(async (tx: any) => {
        await this.unsetExistingPrimaryBarcode(tx, productId);

        return tx.productBarcode.create({
          data: {
            id: this.generateId(),
            productId,
            barcode: dto.barcode,
            barcodeType: dto.barcodeType,
            isPrimary: true,
            createdAt: new Date(),
          },
        });
      });
    }

    try {
      return await this.prisma.productBarcode.create({
        data: {
          id: this.generateId(),
          productId,
          barcode: dto.barcode,
          barcodeType: dto.barcodeType,
          isPrimary: false,
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new DuplicateBarcodeException(dto.barcode);
      }
      throw error;
    }
  }

  async setPrimaryBarcode(
    productId: string,
    barcodeId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx: any) => {
      await this.unsetExistingPrimaryBarcode(tx, productId);

      return tx.productBarcode.update({
        where: { id: barcodeId },
        data: { isPrimary: true },
      });
    });
  }

  private async closeActivePriceHistory(tx: any, productId: string): Promise<void> {
    const activePrice = await tx.productPriceHistory.findFirst({
      where: {
        productId,
        effectiveTo: null,
      },
    });

    if (activePrice) {
      await tx.productPriceHistory.update({
        where: { id: activePrice.id },
        data: { effectiveTo: new Date() },
      });
    }
  }

  private async closeActiveCostHistory(tx: any, productId: string): Promise<void> {
    const activeCost = await tx.productCostHistory.findFirst({
      where: {
        productId,
        effectiveTo: null,
      },
    });

    if (activeCost) {
      await tx.productCostHistory.update({
        where: { id: activeCost.id },
        data: { effectiveTo: new Date() },
      });
    }
  }

  private async closeActiveTaxHistory(tx: any, productId: string): Promise<void> {
    const activeTax = await tx.productTaxHistory.findFirst({
      where: {
        productId,
        effectiveTo: null,
      },
    });

    if (activeTax) {
      await tx.productTaxHistory.update({
        where: { id: activeTax.id },
        data: { effectiveTo: new Date() },
      });
    }
  }

  private async unsetExistingPrimaryBarcode(tx: any, productId: string): Promise<void> {
    const existingPrimary = await tx.productBarcode.findFirst({
      where: {
        productId,
        isPrimary: true,
      },
    });

    if (existingPrimary) {
      await tx.productBarcode.update({
        where: { id: existingPrimary.id },
        data: { isPrimary: false },
      });
    }
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
