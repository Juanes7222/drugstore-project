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
        { genericName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.product.findMany({
      where,
      include: {
        category: true,
        pharmaceuticalForm: true,
        barcodes: { where: { isPrimary: true }, take: 1 },
        priceHistories: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
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
      currentTax: item.taxHistories[0] ?? null,
      priceHistories: undefined,
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
      currentTax: item.taxHistories[0] ?? null,
      priceHistories: undefined,
      taxHistories: undefined,
    };
  }

  async createProduct(
    userId: string,
    dto: CreateProductDto,
  ): Promise<any> {
    const priceDecimal = new Prisma.Decimal(dto.initialPrice);

    return this.prisma.$transaction(async (tx: any) => {
      const product = await tx.product.create({
        data: {
          id: this.generateId(),
          internalCode: dto.internalCode,
          commercialName: dto.commercialName,
          genericName: dto.genericName,
          activePrinciple: dto.activePrinciple,
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
          currentPriceId: null,
          currentTaxHistoryId: null,
          createdById: userId,
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

      return tx.product.update({
        where: { id: product.id },
        data: {
          currentPriceId: priceHistory.id,
          currentTaxHistoryId: taxHistory.id,
        },
      });
    });
  }

  async updateProduct(
    productId: string,
    dto: UpdateProductDto,
  ): Promise<any> {
    const updateData: any = {};

    if (dto.commercialName !== undefined) updateData.commercialName = dto.commercialName;
    if (dto.genericName !== undefined) updateData.genericName = dto.genericName;
    if (dto.activePrinciple !== undefined) updateData.activePrinciple = dto.activePrinciple;
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

    updateData.updatedAt = new Date();

    return this.prisma.product.update({
      where: { id: productId },
      data: updateData,
    });
  }

  async registerPrice(
    productId: string,
    userId: string,
    dto: RegisterProductPriceDto,
  ): Promise<any> {
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
