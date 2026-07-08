import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@pharmacy/database';
import { CreateTaxSchemeDto } from './dto/create-tax-scheme.dto';
import { DuplicateActiveTaxSchemeException } from './exceptions/duplicate-active-tax-scheme.exception';
import * as crypto from 'crypto';

@Injectable()
export class TaxSchemesService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<any> {
    return this.prisma.taxScheme.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<any> {
    return this.prisma.taxScheme.findUnique({
      where: { id },
    });
  }

  async create(userId: string, dto: CreateTaxSchemeDto): Promise<any> {
    const rateDecimal = new Prisma.Decimal(dto.rate);

    const existingActive = await this.prisma.taxScheme.findFirst({
      where: {
        code: dto.code,
        rate: rateDecimal,
        effectiveTo: null,
      },
    });

    if (existingActive) {
      throw new DuplicateActiveTaxSchemeException(dto.code, dto.rate);
    }

    return this.prisma.taxScheme.create({
      data: {
        id: this.generateId(),
        code: dto.code,
        name: dto.name,
        taxType: dto.taxType,
        rate: rateDecimal,
        effectiveFrom: new Date(dto.effectiveFrom),
        isActive: true,
        createdById: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async deactivate(id: string): Promise<any> {
    return this.prisma.taxScheme.update({
      where: { id },
      data: {
        effectiveTo: new Date(),
        isActive: false,
        updatedAt: new Date(),
      },
    });
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
