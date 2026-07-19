/**
 * Print Module
 *
 * Handles server-side print job processing. Currently provides a fallback
 * endpoint for POS workstations when local printing fails. Future versions
 * will include server-attached printer management, BullMQ-based job queuing,
 * and central print spooling.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { PrintController } from './controllers/print.controller';
import { PrintService } from './services/print.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrintController],
  providers: [PrintService],
  exports: [PrintService],
})
export class PrintModule {}
