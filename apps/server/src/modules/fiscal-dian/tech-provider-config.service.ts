import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TECH_PROVIDER_CONFIG_ID } from './constants/fiscal-singleton-ids';
import { UpsertTechProviderConfigDto } from './dto/upsert-tech-provider-config.dto';
import { TechProviderConfigNotSetException } from './exceptions/tech-provider-config-not-set.exception';

@Injectable()
export class TechProviderConfigService {
  constructor(private prisma: PrismaService) {}

  /** Returns the singleton TechProviderConfig, or throws if never set. */
  async find(): Promise<any> {
    const config = await (this.prisma.techProviderConfig as any).findUnique({
      where: { id: TECH_PROVIDER_CONFIG_ID },
    });
    if (!config) {
      throw new TechProviderConfigNotSetException();
    }
    return config;
  }

  /** Creates or updates the singleton TechProviderConfig. */
  async upsert(
    dto: UpsertTechProviderConfigDto,
    updatedById: string,
  ): Promise<any> {
    return (this.prisma.techProviderConfig as any).upsert({
      where: { id: TECH_PROVIDER_CONFIG_ID },
      create: {
        id: TECH_PROVIDER_CONFIG_ID,
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
