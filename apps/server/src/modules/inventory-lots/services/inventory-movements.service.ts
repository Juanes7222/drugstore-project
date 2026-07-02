import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

@Injectable()
export class InventoryMovementsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryInventoryMovementDto): Promise<any> {
    throw new NotImplementedForPhaseException(
      'inventory-lots',
      'findAll (movements)',
    );
  }
}
