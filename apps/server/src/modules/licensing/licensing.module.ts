import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
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
import { WompiConfigService } from './payments/wompi-config.service';
import { WompiService } from './payments/wompi.service';
import { WompiWebhookController } from './payments/wompi-webhook.controller';
import { CheckoutController } from './payments/checkout.controller';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), HttpModule],
  controllers: [
    PlansController,
    SubscriptionsController,
    LocationsController,
    ActivationsController,
    CheckInsController,
    FraudAlertsController,
    WompiWebhookController,
    CheckoutController,
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
    WompiConfigService,
    WompiService,
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
    WompiConfigService,
    WompiService,
  ],
})
export class LicensingModule {}
