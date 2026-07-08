import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { SyncHealthController } from './controllers/sync-health.controller';

/**
 * Backoffice module — read-only administrative surfaces.
 *
 * Provides endpoints for admin dashboards. All mutating operations
 * are owned by their respective domain modules.
 */
@Module({
  imports: [PrismaModule, SyncModule],
  controllers: [SyncHealthController],
})
export class BackofficeModule {}