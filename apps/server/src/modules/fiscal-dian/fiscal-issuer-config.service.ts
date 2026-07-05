import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { FISCAL_ISSUER_CONFIG_ID } from './constants/fiscal-singleton-ids';
import { UpsertFiscalIssuerConfigDto } from './dto/upsert-fiscal-issuer-config.dto';
import { FiscalIssuerConfigNotSetException } from './exceptions/fiscal-issuer-config-not-set.exception';

@Injectable()
export class FiscalIssuerConfigService {
  constructor(private prisma: PrismaService) {}

  /** Returns the singleton FiscalIssuerConfig, or throws if never set. */
  async find(): Promise<any> {
    const config = await (this.prisma.fiscalIssuerConfig as any).findUnique({
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
    return (this.prisma.fiscalIssuerConfig as any).upsert({
      where: { id: FISCAL_ISSUER_CONFIG_ID },
      create: {
        id: FISCAL_ISSUER_CONFIG_ID,
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
