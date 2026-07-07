import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, SupplierIdentificationType } from '@prisma/client';
import * as crypto from 'crypto';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { DuplicateSupplierIdentificationException } from '../exceptions/duplicate-supplier-identification.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: any): Promise<any> {
    const where: Prisma.SupplierWhereInput = {};
    if (query.search) {
      where.OR = [
        { businessName: { contains: query.search, mode: 'insensitive' } },
        { identificationNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    const [suppliers, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { businessName: 'asc' },
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return { data: suppliers, total, page: query.page, pageSize: query.pageSize };
  }

  async findById(id: string): Promise<any> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new SupplierNotFoundException(id);
    }
    return supplier;
  }

  async create(createDto: CreateSupplierDto, userId: string): Promise<any> {
    try {
      return await this.prisma.supplier.create({
        data: {
          id: crypto.randomUUID(),
          ...createDto,
          createdById: userId,
        },
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        throw new DuplicateSupplierIdentificationException(createDto.identificationType, createDto.identificationNumber);
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
        throw new DuplicateSupplierIdentificationException(updateDto.identificationType || '', updateDto.identificationNumber || '');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<any> {
    await this.findById(id); // Check if supplier exists
    return this.prisma.supplier.delete({ where: { id } });
  }
}
