import { Injectable } from '@nestjs/common';
import { $Enums } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { RoleType, User } from '@pharmacy/shared-types';
import { SystemConfigValueSchema } from '../dto/system-config-value.schema';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';
import { UpdatePosSalesSettingsDto } from '../dto/update-pos-sales-settings.schema';
import { ConfigValueTypeMismatchException } from '../exceptions/config-value-type-mismatch.exception';
import { ImmutableConfigFieldException } from '../exceptions/immutable-config-field.exception';

/** `SystemConfig` keys backing the POS sales-settings tabs. */
export const POS_DISCOUNT_LIMITS_KEY = 'POS_DISCOUNT_LIMITS';
export const POS_SALES_CONFIG_KEY = 'POS_SALES_CONFIG';

@Injectable()
export class ConfigurationService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Returns all system configuration entries. For entries marked isSensitive,
   * the `value` is replaced with null unless the caller has the ADMIN role.
   */
  async findAll(user: User): Promise<any[]> {
    const configs = await this.prisma.systemConfig.findMany();
    return configs.map((config: any) => this.applySensitiveMask(config, user));
  }

  /**
   * Returns a single configuration entry by key. The same sensitive-value
   * masking rule applies as in findAll.
   */
  async findByKey(key: string, user: User): Promise<any> {
    const config = await this.prisma.systemConfig.findUnique({
      where: { subscriptionId_key: { subscriptionId: this.tenantContext.getSubscriptionId(), key } },
    });
    if (!config) {
      return null;
    }
    return this.applySensitiveMask(config, user);
  }

  /**
   * Creates or updates a configuration entry.
   *
   * - If the key exists, only `value` (inside configValue) and `description`
   *   may change; attempting to change `module` or `valueType` throws
   *   ImmutableConfigFieldException.
   * - If the key does not exist, all fields (including `module` and `valueType`)
   *   are required to create it.
   * - The incoming value is validated against the discriminated union schema
   *   keyed by valueType; a mismatch throws ConfigValueTypeMismatchException.
   */
  async upsertByKey(
    key: string,
    dto: UpsertSystemConfigDto,
    user: User,
  ): Promise<any> {
    this.assertValidValueType(key, dto.configValue.valueType, dto.configValue.value);

    const existing = await this.prisma.systemConfig.findUnique({
      where: { subscriptionId_key: { subscriptionId: this.tenantContext.getSubscriptionId(), key } },
    });

    if (existing) {
      this.assertIdentityFieldsUnchanged(key, existing, dto);
      return this.prisma.systemConfig.update({
        where: { subscriptionId_key: { subscriptionId: this.tenantContext.getSubscriptionId(), key } },
        data: {
          value: dto.configValue.value,
          description: dto.description ?? existing.description,
          updatedById: user.id,
        },
      });
    }

    return this.prisma.systemConfig.create({
      data: {
        subscriptionId: this.tenantContext.getSubscriptionId(),
        key,
        value: dto.configValue.value,
        valueType: dto.configValue.valueType,
        module: dto.module as $Enums.SystemModule,
        description: dto.description ?? null,
        isSensitive: dto.isSensitive,
        updatedById: user.id,
      },
    });
  }

  /**
   * Masks the `value` field to null when the entry is sensitive and the caller
   * is not an ADMIN. All other fields remain visible.
   */
  private applySensitiveMask(config: any, user: User): any {
    if (config.isSensitive && user.role !== RoleType.ADMIN) {
      return { ...config, value: null };
    }
    return config;
  }

  /**
   * Re-validates the value against the valueType via the Zod discriminated
   * union. This catches callers that bypass the controller-level pipe.
   */
  private assertValidValueType(
    key: string,
    valueType: string,
    value: unknown,
  ): void {
    const result = SystemConfigValueSchema.safeParse({ valueType, value });
    if (!result.success) {
      throw new ConfigValueTypeMismatchException(valueType, key);
    }
  }

  /**
   * Persist the POS sales-settings blocks so every workstation agrees on them.
   *
   * These two keys already existed and were already served by
   * `GET /configuration/pos-settings`; what was missing was any way to write
   * them. Until now the Ventas tab mutated only the local store, so a discount
   * limit or price floor set at one terminal was invisible to every other one
   * and was silently reverted by the next boot sync, which pulls these same
   * keys and overwrites the local block.
   *
   * Only the blocks present in the payload are written, so a caller fixing one
   * setting does not overwrite the other block with a partial view of it.
   * Routing through `upsertByKey` keeps the module/valueType immutability rules
   * and the `updatedById` attribution in one place instead of duplicating the
   * upsert here.
   */
  async updatePosSalesSettings(
    dto: UpdatePosSalesSettingsDto,
    user: User,
  ): Promise<UpdatePosSalesSettingsDto> {
    const writes: Array<[string, unknown]> = [];
    if (dto.discountLimits !== undefined) {
      writes.push([POS_DISCOUNT_LIMITS_KEY, dto.discountLimits]);
    }
    if (dto.salesConfig !== undefined) {
      writes.push([POS_SALES_CONFIG_KEY, dto.salesConfig]);
    }

    for (const [key, value] of writes) {
      await this.upsertByKey(
        key,
        {
          key,
          // `SALES_POS` is the Prisma `SystemModule` member that backs this
          // column. Note it is NOT shared-types' `SystemModule.SALES` — the two
          // enums share a name and differ, and this one is a type assertion
          // rather than a runtime lookup, exactly as `upsertByKey` itself does.
          module: 'SALES_POS' as $Enums.SystemModule,
          isSensitive: false,
          configValue: { valueType: 'OBJECT', value },
        } as UpsertSystemConfigDto,
        user,
      );
    }

    return dto;
  }

  /**
   * Ensures the identity fields (module and valueType) have not changed for an
   * existing entry. Throws ImmutableConfigFieldException on the first mismatch.
   */
  private assertIdentityFieldsUnchanged(
    key: string,
    existing: any,
    dto: UpsertSystemConfigDto,
  ): void {
    if (dto.module !== existing.module) {
      throw new ImmutableConfigFieldException('module', key);
    }
    if (dto.configValue.valueType !== existing.valueType) {
      throw new ImmutableConfigFieldException('valueType', key);
    }
  }
}
