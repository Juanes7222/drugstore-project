import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { QueryClientDto } from './dto/query-client.dto';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryClientDto): Promise<any> {
    throw new NotImplementedForPhaseException('clients', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('clients', 'findById');
  }

  async create(createDto: CreateClientDto): Promise<any> {
    throw new NotImplementedForPhaseException('clients', 'create');
  }

  async update(id: string, updateDto: UpdateClientDto): Promise<any> {
    throw new NotImplementedForPhaseException('clients', 'update');
  }

  async findAllClassifications(): Promise<any> {
    throw new NotImplementedForPhaseException('clients', 'findAllClassifications');
  }
}
