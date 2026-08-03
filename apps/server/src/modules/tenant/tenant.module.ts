// Tenant boundary: per-request subscriptionId context and RLS wiring.
import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [TenantContextService, TenantContextInterceptor],
  exports: [TenantContextService],
})
export class TenantModule {}