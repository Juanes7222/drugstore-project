import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from '../dto/query-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryPurchaseOrderDto): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'findAll (orders)');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'findById (orders)');
  }

  async create(createDto: CreatePurchaseOrderDto): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'create (orders)');
  }

  async confirm(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'confirm (orders)');
  }
}
