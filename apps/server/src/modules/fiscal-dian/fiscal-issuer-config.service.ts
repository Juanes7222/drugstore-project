import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FISCAL_ISSUER_CONFIG_ID } from './constants/fiscal-singleton-ids';
import { UpsertFiscalIssuerConfigDto } from './dto/upsert-fiscal-issuer-config.dto';
import { QueryFiscalResolutionsDto } from './dto/query-fiscal-resolutions.dto';
import { FiscalIssuerConfigNotSetException } from './exceptions/fiscal-issuer-config-not-set.exception';
import { FiscalResolutionsService } from './services/fiscal-resolutions.service';

@Injectable()
export class FiscalIssuerConfigService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly resolutionsService: FiscalResolutionsService,
  ) {}

  /**
   * Returns the singleton FiscalIssuerConfig plus the most recent ACTIVE
   * fiscal resolution (same criterion buildSellerInfo uses), or throws if
   * the config has never been set.
   */
  async find(): Promise<any> {
    const config = await this.prisma.fiscalIssuerConfig.findUnique({
      where: { id: FISCAL_ISSUER_CONFIG_ID },
    });
    if (!config) {
      throw new FiscalIssuerConfigNotSetException();
    }
    return { ...config, resolution: await this.findActiveResolution() };
  }

  /** Most recent ACTIVE resolution, or null when none exists. */
  private async findActiveResolution(): Promise<any> {
    const query = new QueryFiscalResolutionsDto();
    query.state = 'ACTIVE';
    query.pageSize = 1;
    const { data: activeResolutions } =
      await this.resolutionsService.findAll(query);
    return activeResolutions[0] ?? null;
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
