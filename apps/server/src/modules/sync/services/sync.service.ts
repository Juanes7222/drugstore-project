import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { SyncBatchDto } from '../dto/sync-batch.dto';
import { QuerySyncQueueDto } from '../dto/query-sync-queue.dto';

@Injectable()
export class SyncService {
  constructor(private prisma: PrismaService) {}

  async submitBatch(batchDto: SyncBatchDto): Promise<any> {
    throw new NotImplementedForPhaseException('sync', 'submitBatch');
  }

  async getWorkstationStatus(): Promise<any> {
    throw new NotImplementedForPhaseException('sync', 'getWorkstationStatus');
  }

  async findAllQueue(query: QuerySyncQueueDto): Promise<any> {
    throw new NotImplementedForPhaseException('sync', 'findAllQueue');
  }

  async findQueueById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('sync', 'findQueueById');
  }

  async retryQueueEntry(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('sync', 'retryQueueEntry');
  }
}
