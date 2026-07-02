import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryLotDto } from '../dto/query-lot.dto';

@Injectable()
export class LotsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryLotDto): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'findById');
  }

  async block(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'block');
  }

  async unblock(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('inventory-lots', 'unblock');
  }
}
