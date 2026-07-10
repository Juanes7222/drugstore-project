import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import type { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findBySubscription(subscriptionId: string) {
    return this.prisma.location.findMany({
      where: { subscriptionId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    const location = await this.prisma.location.findUnique({
      where: { id },
      include: {
        workstationActivations: {
          include: { subscription: { select: { status: true } } },
          orderBy: { activatedAt: 'desc' },
        },
        activationCodes: {
          where: { status: 'UNUSED' },
        },
      },
    });
    if (!location) {
      throw new DomainException('LOCATION_NOT_FOUND', `Location with ID ${id} not found`, HttpStatus.NOT_FOUND);
    }
    return location;
  }

  async create(subscriptionId: string, dto: CreateLocationDto) {
    // Validate subscription exists
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, locations: { where: { isActive: true } } },
    });
    if (!subscription) {
      throw new DomainException('SUBSCRIPTION_NOT_FOUND', `Subscription with ID ${subscriptionId} not found`, HttpStatus.NOT_FOUND);
    }

    // Enforce maxLocations limit from the plan
    const activeLocationCount = subscription.locations?.length ?? 0;
    if (activeLocationCount >= subscription.plan.maxLocations) {
      throw new DomainException(
        'PLAN_LIMIT_EXCEEDED',
        `Plan ${subscription.plan.code} allows max ${subscription.plan.maxLocations} location(s). ` +
        `Cannot add another location. Current: ${activeLocationCount}, Limit: ${subscription.plan.maxLocations}`,
        HttpStatus.FORBIDDEN,
      );
    }

    return this.prisma.location.create({
      data: {
        id: crypto.randomUUID(),
        subscriptionId,
        name: dto.name,
        address: dto.address ?? null,
        city: dto.city ?? null,
        region: dto.region ?? null,
        country: dto.country ?? 'CO',
        taxId: dto.taxId ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        latitude: dto.latitude ? undefined : undefined,
        longitude: dto.longitude ? undefined : undefined,
        notes: dto.notes ?? null,
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
      },
    });
  }

  async update(id: string, dto: UpdateLocationDto) {
    await this.findById(id);

    return this.prisma.location.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.region !== undefined && { region: dto.region }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.taxId !== undefined && { taxId: dto.taxId }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
      },
    });
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.location.update({
      where: { id },
      data: { isActive: false },
      include: { workstationActivations: true },
    });
  }

  async getLocationLimitStatus(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, locations: { where: { isActive: true } } },
    });
    if (!subscription) {
      throw new DomainException('SUBSCRIPTION_NOT_FOUND', `Subscription with ID ${subscriptionId} not found`, HttpStatus.NOT_FOUND);
    }

    const activeLocations = subscription.locations?.length ?? 0;
    return {
      maxLocations: subscription.plan.maxLocations,
      activeLocations,
      canAddLocation: activeLocations < subscription.plan.maxLocations,
    };
  }
}
