/**
 * Dev-only module — exposes temporary endpoints for database inspection.
 * ONLY available when NODE_ENV=development.
 */

import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';

@Module({
  controllers: [DevController],
})
export class DevModule {}
