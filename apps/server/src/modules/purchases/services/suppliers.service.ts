import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';
import { QuerySupplierDto } from '../dto/query-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QuerySupplierDto): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'findById');
  }

  async create(createDto: CreateSupplierDto): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'create');
  }

  async update(id: string, updateDto: UpdateSupplierDto): Promise<any> {
    throw new NotImplementedForPhaseException('purchases', 'update');
  }
}
