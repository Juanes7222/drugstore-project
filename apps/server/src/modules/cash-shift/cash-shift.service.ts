import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateCashShiftDto } from './dto/create-cash-shift.dto';
import { UpdateCashShiftDto } from './dto/update-cash-shift.dto';
import { QueryCashShiftDto } from './dto/query-cash-shift.dto';

@Injectable()
export class CashShiftService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryCashShiftDto): Promise<any> {
    throw new NotImplementedForPhaseException('cash-shift', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('cash-shift', 'findById');
  }

  async create(createDto: CreateCashShiftDto): Promise<any> {
    throw new NotImplementedForPhaseException('cash-shift', 'create');
  }

  async update(id: string, updateDto: UpdateCashShiftDto): Promise<any> {
    throw new NotImplementedForPhaseException('cash-shift', 'update');
  }

  async close(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('cash-shift', 'close');
  }
}
