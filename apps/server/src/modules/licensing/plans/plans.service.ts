import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import type { CreatePlanDto, UpdatePlanDto, PlanFilterDto } from './dto/plan.dto';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlanDto) {
    const existing = await this.prisma.plan.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new DomainException('PLAN_CODE_EXISTS', `Plan with code ${dto.code} already exists`, HttpStatus.CONFLICT);
    }

    return this.prisma.plan.create({
      data: {
        id: crypto.randomUUID(),
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        pricingModel: dto.pricingModel,
        basePriceCents: dto.basePriceCents,
        currency: dto.currency ?? 'COP',
        billingPeriod: dto.billingPeriod ?? 'MONTHLY',
        maxLocations: dto.maxLocations ?? 1,
        maxWorkstationsPerLocation: dto.maxWorkstationsPerLocation ?? 1,
        includedWorkstations: dto.includedWorkstations ?? 1,
        extraWorkstationPriceCents: dto.extraWorkstationPriceCents ?? null,
        features: dto.features ?? [],
        displayOrder: dto.displayOrder ?? 0,
        isActive: dto.isActive ?? true,
        isPublic: dto.isPublic ?? false,
      },
    });
  }

  async findAll(filter?: PlanFilterDto) {
    const where: Record<string, unknown> = {};
    
    if (filter?.isActive !== undefined) where.isActive = filter.isActive;
    if (filter?.isPublic !== undefined) where.isPublic = filter.isPublic;
    
    return this.prisma.plan.findMany({
      where,
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findPublic() {
    return this.prisma.plan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findById(id: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) {
      throw new DomainException('PLAN_NOT_FOUND', `Plan with ID ${id} not found`, HttpStatus.NOT_FOUND);
    }
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findById(id);
    
    return this.prisma.plan.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.pricingModel !== undefined && { pricingModel: dto.pricingModel }),
        ...(dto.basePriceCents !== undefined && { basePriceCents: dto.basePriceCents }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.billingPeriod !== undefined && { billingPeriod: dto.billingPeriod }),
        ...(dto.maxLocations !== undefined && { maxLocations: dto.maxLocations }),
        ...(dto.maxWorkstationsPerLocation !== undefined && { maxWorkstationsPerLocation: dto.maxWorkstationsPerLocation }),
        ...(dto.includedWorkstations !== undefined && { includedWorkstations: dto.includedWorkstations }),
        ...(dto.extraWorkstationPriceCents !== undefined && { extraWorkstationPriceCents: dto.extraWorkstationPriceCents }),
        ...(dto.features !== undefined && { features: dto.features }),
        ...(dto.displayOrder !== undefined && { displayOrder: dto.displayOrder }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
      },
    });
  }

  async softDelete(id: string) {
    await this.findById(id);
    return this.prisma.plan.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getPlanLimitDetails(id: string) {
    const plan = await this.findById(id);
    return {
      maxLocations: plan.maxLocations,
      maxWorkstationsPerLocation: plan.maxWorkstationsPerLocation,
      includedWorkstations: plan.includedWorkstations,
      extraWorkstationPriceCents: plan.extraWorkstationPriceCents,
    };
  }
}
