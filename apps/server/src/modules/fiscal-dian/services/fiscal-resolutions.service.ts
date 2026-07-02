import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateFiscalResolutionDto } from '../dto/create-fiscal-resolution.dto';
import { QueryFiscalResolutionsDto } from '../dto/query-fiscal-resolutions.dto';

@Injectable()
export class FiscalResolutionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryFiscalResolutionsDto): Promise<any> {
    throw new NotImplementedForPhaseException(
      'fiscal-dian',
      'findAll (resolutions)',
    );
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException(
      'fiscal-dian',
      'findById (resolutions)',
    );
  }

  async create(createDto: CreateFiscalResolutionDto): Promise<any> {
    throw new NotImplementedForPhaseException(
      'fiscal-dian',
      'create (resolutions)',
    );
  }
}
