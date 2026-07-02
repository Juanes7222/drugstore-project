import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { QueryFiscalDocumentsDto } from '../dto/query-fiscal-documents.dto';

@Injectable()
export class FiscalDocumentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryFiscalDocumentsDto): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'findAll');
  }

  async findById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'findById');
  }

  async getXmlPayload(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'getXmlPayload');
  }

  async retryDocument(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('fiscal-dian', 'retryDocument');
  }
}
