import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateSaleDto } from '../dto/create-sale.dto';
import { QuerySaleDto } from '../dto/query-sale.dto';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QuerySaleDto): Promise<any> {
    throw new NotImplementedForPhaseException('sales-pos', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('sales-pos', 'findById');
  }

  async create(createDto: CreateSaleDto): Promise<any> {
    throw new NotImplementedForPhaseException('sales-pos', 'create');
  }

  async confirm(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('sales-pos', 'confirm');
  }

  async annul(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('sales-pos', 'annul');
  }
}
