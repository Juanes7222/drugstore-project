import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RoleType, User } from '@pharmacy/shared-types';
import { SystemConfigValueSchema } from '../dto/system-config-value.schema';
import { UpsertSystemConfigDto } from '../dto/upsert-system-config.dto';
import { ConfigValueTypeMismatchException } from '../exceptions/config-value-type-mismatch.exception';
import { ImmutableConfigFieldException } from '../exceptions/immutable-config-field.exception';

@Injectable()
export class ConfigurationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Returns all system configuration entries. For entries marked isSensitive,
   * the `value` is replaced with null unless the caller has the ADMIN role.
   */
  async findAll(user: User): Promise<any[]> {
    const configs = await (this.prisma.systemConfig as any).findMany();
    return configs.map((config: any) => this.applySensitiveMask(config, user));
  }

  /**
   * Returns a single configuration entry by key. The same sensitive-value
   * masking rule applies as in findAll.
   */
  async findByKey(key: string, user: User): Promise<any> {
    const config = await (this.prisma.systemConfig as any).findUnique({
      where: { key },
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

    const existing = await (this.prisma.systemConfig as any).findUnique({
      where: { key },
    });

    if (existing) {
      this.assertIdentityFieldsUnchanged(key, existing, dto);
      return (this.prisma.systemConfig as any).update({
        where: { key },
        data: {
          value: dto.configValue.value,
          description: dto.description ?? existing.description,
          updatedById: user.id,
        },
      });
    }

    return (this.prisma.systemConfig as any).create({
      data: {
        key,
        value: dto.configValue.value,
        valueType: dto.configValue.valueType,
        module: dto.module,
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
