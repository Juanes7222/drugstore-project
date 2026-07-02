import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SyncController } from './controllers/sync.controller';
import { SyncService } from './services/sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
