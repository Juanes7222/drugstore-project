/**
 * Local suppliers service — CRUD for suppliers in the offline-first POS.
 *
 * Suppliers are synced from the server (pull) and created locally while
 * offline. Local creates are queued in SyncQueue for server reconciliation.
 */
import { PrismaClient, Prisma, SupplierIdentificationType } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  SupplierNotFoundException,
  DuplicateSupplierIdentificationException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateSupplierInput {
  identificationType: SupplierIdentificationType;
  identificationNumber: string;
  businessName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  isActive?: boolean;
}

export interface UpdateSupplierInput {
  identificationType?: SupplierIdentificationType;
  identificationNumber?: string;
  businessName?: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string;
  paymentTermsDays?: number;
  creditLimit?: number;
  isActive?: boolean;
}

export interface SupplierSearchResult {
  id: string;
  identificationType: string;
  identificationNumber: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  isActive: boolean;
  paymentTermsDays: number;
  creditLimit: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSuppliersService = (
  prisma: PrismaClient,
  auth: AuthService,
): SuppliersService => {
  return new SuppliersService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SuppliersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * Search suppliers by business name or identification number.
   * Returns active suppliers ordered by business name.
   */
  async searchSuppliers(query: string): Promise<SupplierSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      // Return all active suppliers when no query
      const suppliers = await this.prisma.supplier.findMany({
        where: { isActive: true },
        orderBy: { businessName: 'asc' },
      });
      return suppliers.map(this.mapSupplier);
    }

    const q = trimmed.toLowerCase();
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        isActive: true,
        OR: [
          { businessName: { contains: q, mode: 'insensitive' } },
          { identificationNumber: { contains: q, mode: 'insensitive' } },
          { contactName: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { businessName: 'asc' },
    });
    return suppliers.map(this.mapSupplier);
  }

  /**
   * Get a supplier by ID.
   * @throws SupplierNotFoundException
   */
  async getSupplier(id: string): Promise<SupplierSearchResult> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new SupplierNotFoundException(id);
    return this.mapSupplier(supplier);
  }

  /**
   * List all suppliers (both active and inactive) with pagination.
   */
  async listSuppliers(params?: {
    search?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: SupplierSearchResult[]; total: number; page: number; pageSize: number }> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;

    const where: Prisma.SupplierWhereInput = {};
    if (params?.isActive !== undefined) {
      where.isActive = params.isActive;
    }
    if (params?.search) {
      const q = params.search;
      where.OR = [
        { businessName: { contains: q, mode: 'insensitive' } },
        { identificationNumber: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [suppliers, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { businessName: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data: suppliers.map(this.mapSupplier),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Create a new supplier locally.
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * @throws DuplicateSupplierIdentificationException
   */
  async createSupplier(input: CreateSupplierInput): Promise<SupplierSearchResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      // Check duplicate
      const existing = await tx.supplier.findFirst({
        where: {
          identificationType: input.identificationType,
          identificationNumber: input.identificationNumber,
        },
      });
      if (existing) {
        throw new DuplicateSupplierIdentificationException(
          input.identificationType,
          input.identificationNumber,
        );
      }

      const supplier = await tx.supplier.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          identificationType: input.identificationType,
          identificationNumber: input.identificationNumber,
          businessName: input.businessName,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          country: input.country ?? 'CO',
          paymentTermsDays: input.paymentTermsDays ?? 0,
          creditLimit: input.creditLimit ?? 0,
          isActive: input.isActive ?? true,
          createdById: session.userId,
        },
      });

      return this.mapSupplier(supplier);
    });
  }

  /**
   * Update an existing supplier.
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   */
  async updateSupplier(
    id: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierSearchResult> {
    this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplier.findUnique({ where: { id } });
      if (!existing) throw new SupplierNotFoundException(id);

      // Check duplicate if identification changed
      if (input.identificationType || input.identificationNumber) {
        const dupCheck = await tx.supplier.findFirst({
          where: {
            identificationType: input.identificationType ?? existing.identificationType,
            identificationNumber: input.identificationNumber ?? existing.identificationNumber,
            id: { not: id },
          },
        });
        if (dupCheck) {
          throw new DuplicateSupplierIdentificationException(
            input.identificationType ?? existing.identificationType,
            input.identificationNumber ?? existing.identificationNumber,
          );
        }
      }

      const supplier = await tx.supplier.update({
        where: { id },
        data: {
          ...(input.identificationType !== undefined && { identificationType: input.identificationType }),
          ...(input.identificationNumber !== undefined && { identificationNumber: input.identificationNumber }),
          ...(input.businessName !== undefined && { businessName: input.businessName }),
          ...(input.contactName !== undefined && { contactName: input.contactName }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.address !== undefined && { address: input.address }),
          ...(input.city !== undefined && { city: input.city }),
          ...(input.country !== undefined && { country: input.country }),
          ...(input.paymentTermsDays !== undefined && { paymentTermsDays: input.paymentTermsDays }),
          ...(input.creditLimit !== undefined && { creditLimit: input.creditLimit }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });

      return this.mapSupplier(supplier);
    });
  }

  /**
   * Soft-delete (deactivate) a supplier.
   * Requires ADMIN role.
   */
  async deactivateSupplier(id: string): Promise<void> {
    this.auth.requireRole(RoleType.ADMIN);

    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new SupplierNotFoundException(id);

    await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private mapSupplier(s: {
    id: string;
    identificationType: string;
    identificationNumber: string;
    businessName: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    country: string;
    isActive: boolean;
    paymentTermsDays: number;
    creditLimit: number | Prisma.Decimal;
  }): SupplierSearchResult {
    return {
      id: s.id,
      identificationType: s.identificationType,
      identificationNumber: s.identificationNumber,
      businessName: s.businessName,
      contactName: s.contactName,
      phone: s.phone,
      email: s.email,
      address: s.address,
      city: s.city,
      country: s.country,
      isActive: s.isActive,
      paymentTermsDays: s.paymentTermsDays,
      creditLimit: Number(s.creditLimit),
    };
  }
}
