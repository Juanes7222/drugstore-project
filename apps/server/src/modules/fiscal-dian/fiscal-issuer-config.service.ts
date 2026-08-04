import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FISCAL_ISSUER_CONFIG_ID } from './constants/fiscal-singleton-ids';
import { UpsertFiscalIssuerConfigDto } from './dto/upsert-fiscal-issuer-config.dto';
import { FiscalIssuerConfigNotSetException } from './exceptions/fiscal-issuer-config-not-set.exception';

@Injectable()
export class FiscalIssuerConfigService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Returns the singleton FiscalIssuerConfig, or throws if never set. */
  async find(): Promise<any> {
    const config = await this.prisma.fiscalIssuerConfig.findUnique({
      where: { id: FISCAL_ISSUER_CONFIG_ID },
    });
    if (!config) {
      throw new FiscalIssuerConfigNotSetException();
    }
    return config;
  }

  /** Creates or updates the singleton FiscalIssuerConfig. */
  async upsert(
    dto: UpsertFiscalIssuerConfigDto,
    updatedById: string,
  ): Promise<any> {
    return this.prisma.fiscalIssuerConfig.upsert({
      where: { id: FISCAL_ISSUER_CONFIG_ID },
      create: {
        id: FISCAL_ISSUER_CONFIG_ID,
        subscriptionId: this.tenantContext.getSubscriptionId(),
        ...dto,
        updatedById,
      },
      update: {
        ...dto,
        updatedById,
      },
    });
  }
}
