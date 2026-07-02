import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateInventoryAdjustmentDto } from '../dto/create-inventory-adjustment.dto';
import { QueryInventoryAdjustmentDto } from '../dto/query-inventory-adjustment.dto';

@Injectable()
export class InventoryAdjustmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryInventoryAdjustmentDto): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'findAll (adjustments)',
    );
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'findById (adjustments)',
    );
  }

  async create(createDto: CreateInventoryAdjustmentDto): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'create (adjustments)',
    );
  }

  async submit(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'submit (adjustments)',
    );
  }

  async approve(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'approve (adjustments)',
    );
  }

  async reject(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'reject (adjustments)',
    );
  }

  async apply(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'apply (adjustments)',
    );
  }

  async annul(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'annul (adjustments)',
    );
  }
}
