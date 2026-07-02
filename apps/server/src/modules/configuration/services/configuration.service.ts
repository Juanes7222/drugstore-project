import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';

@Injectable()
export class ConfigurationService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<any> {
    throw new NotImplementedForPhaseException('configuration', 'findAll');
  }

  async findByKey(key: string): Promise<any> {
    throw new NotImplementedForPhaseException('configuration', 'findByKey');
  }

  async upsertByKey(key: string, upsertDto: UpsertSystemConfigDto): Promise<any> {
    throw new NotImplementedForPhaseException('configuration', 'upsertByKey');
  }
}
