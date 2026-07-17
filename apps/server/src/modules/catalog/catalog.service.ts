import { Injectable } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { ProductsService } from './products.service';
import { CategoriesService } from './categories.service';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';
import { TaxSchemesService } from './tax-schemes.service';
import { ProductNotFoundException } from './exceptions/product-not-found.exception';

/**
 * Unified catalog facade that delegates to domain-specific services.
 * Provides a single entry point for product, category, pharmaceutical-form,
 * and tax-scheme operations under the /catalog prefix.
 */
@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
    private pharmaceuticalFormsService: PharmaceuticalFormsService,
    private taxSchemesService: TaxSchemesService,
  ) {}

  /**
   * List products with optional filtering, pagination, and search.
   */
  async findAllProducts(query: QueryProductDto): Promise<{
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const where: Prisma.ProductWhereInput = {};

    if (query.search) {
      where.OR = [
        { commercialName: { contains: query.search, mode: 'insensitive' } },
        { genericName: { contains: query.search, mode: 'insensitive' } },
        { internalCode: { contains: query.search, mode: 'insensitive' } },
        { activePrinciple: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    // The schema note: isFreeToSale is a convenience alias for saleType === 'FREE_SALE'.
    // A false value means "don't filter by sale type", not "exclude free sale items".
    if (query.isFreeToSale === true) {
      where.saleType = 'FREE_SALE' as any;
    }

    const page = Math.max(query.page || 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize || 20, 1), 100);
    const skip = (page - 1) * pageSize;

    const [rawItems, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          category: true,
          pharmaceuticalForm: true,
          barcodes: { where: { isPrimary: true }, take: 1 },
          priceHistories: {
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
          taxHistories: {
            include: { taxScheme: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
        orderBy: { commercialName: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Transform: expose currentPrice/currentTax as derived fields
    // matching the shape the frontend expects (currentPrice.price,
    // currentTax.taxScheme.rate). The price/tax history arrays are
    // replaced by the single active record, or null when none exists.
    const items = rawItems.map((item) => ({
      ...item,
      currentPrice: item.priceHistories[0] ?? null,
      currentTax: item.taxHistories[0] ?? null,
      priceHistories: undefined,
      taxHistories: undefined,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Find a single product by ID with full relations.
   */
  async findProductById(id: string): Promise<unknown> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        pharmaceuticalForm: true,
        barcodes: { orderBy: { isPrimary: 'desc' } },
        priceHistories: {
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        taxHistories: {
          include: { taxScheme: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!product) {
      throw new ProductNotFoundException(id);
    }

    // Transform to expose currentPrice/currentTax
    return {
      ...product,
      currentPrice: product.priceHistories[0] ?? null,
      currentTax: product.taxHistories[0] ?? null,
      priceHistories: undefined,
      taxHistories: undefined,
    };
  }

  /**
   * Create a product with initial price and tax history.
   * Requires a userId from the authenticated user.
   */
  async createProduct(userId: string, createDto: CreateProductDto): Promise<unknown> {
    return this.productsService.createProduct(userId, createDto);
  }

  /**
   * Update a product's mutable fields.
   * Throws if the product does not exist.
   */
  async updateProduct(id: string, updateDto: UpdateProductDto): Promise<unknown> {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new ProductNotFoundException(id);
    }

    return this.productsService.updateProduct(id, updateDto);
  }

  /**
   * List all categories ordered by sortOrder.
   */
  async findAllCategories(): Promise<unknown[]> {
    return this.categoriesService.findAll();
  }

  /**
   * List all pharmaceutical forms ordered by sortOrder.
   */
  async findAllPharmaceuticalForms(): Promise<unknown[]> {
    return this.pharmaceuticalFormsService.findAll();
  }

  /**
   * List all tax schemes ordered by creation date.
   */
  async findAllTaxSchemes(): Promise<unknown[]> {
    return this.taxSchemesService.findAll();
  }
}
