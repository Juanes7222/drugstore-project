import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { PlansService } from './plans/plans.service';
import { PlansController } from './plans/plans.controller';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { SubscriptionsController } from './subscriptions/subscriptions.controller';
import { LocationsService } from './locations/locations.service';
import { LocationsController } from './locations/locations.controller';
import { ActivationsService } from './activations/activations.service';
import { ActivationsController } from './activations/activations.controller';
import { CheckInsService } from './check-ins/check-ins.service';
import { CheckInsController } from './check-ins/check-ins.controller';
import { FraudDetectionService } from './fraud/fraud-detection.service';
import { FraudAlertsController } from './fraud/fraud-alerts.controller';
import { LicenseTokenService } from './tokens/license-token.service';
import { LicenseRequiredGuard } from './guards/license-required.guard';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [
    PlansController,
    SubscriptionsController,
    LocationsController,
    ActivationsController,
    CheckInsController,
    FraudAlertsController,
  ],
  providers: [
    PlansService,
    SubscriptionsService,
    LocationsService,
    ActivationsService,
    CheckInsService,
    FraudDetectionService,
    LicenseTokenService,
    LicenseRequiredGuard,
  ],
  exports: [
    PlansService,
    SubscriptionsService,
    LocationsService,
    ActivationsService,
    CheckInsService,
    FraudDetectionService,
    LicenseTokenService,
    LicenseRequiredGuard,
  ],
})
export class LicensingModule {}
