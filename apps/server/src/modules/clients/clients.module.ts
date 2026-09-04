import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ClientsController],
  providers: [ClientsService, SyncAuthGuard],
  exports: [ClientsService],
})
export class ClientsModule {}
