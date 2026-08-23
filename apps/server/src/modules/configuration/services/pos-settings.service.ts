/**
 * Service that assembles the POS settings payload.
 *
 * Gathers payment methods, discount limits from SystemConfig, static
 * alert/sync-defaults, the fiscal issuer identity, and the active fiscal
 * resolution into a single structured response for the
 * `GET /configuration/pos-settings` endpoint.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { FiscalIssuerConfigService } from '@/modules/fiscal-dian/fiscal-issuer-config.service';
import { FiscalResolutionsService } from '@/modules/fiscal-dian/services/fiscal-resolutions.service';
import { FiscalResolutionAllocationsService } from '@/modules/fiscal-dian/fiscal-resolution-allocations.service';
import { FiscalIssuerConfigNotSetException } from '@/modules/fiscal-dian/exceptions/fiscal-issuer-config-not-set.exception';
import { QueryFiscalResolutionsDto } from '@/modules/fiscal-dian/dto/query-fiscal-resolutions.dto';
import type { FiscalResolution } from '@pharmacy/database';
import type {
  PosSettingsResponse,
  SellerInfoPayload,
  PosResolutionPayload,
} from '../dto/pos-settings-response.dto';

@Injectable()
export class PosSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly issuerConfigService: FiscalIssuerConfigService,
    private readonly resolutionsService: FiscalResolutionsService,
    private readonly allocationsService: FiscalResolutionAllocationsService,
  ) {}

  /**
   * Build the full POS settings response.
   *
   * - Reads active payment methods from the database.
   * - Reads discount-limit and alert-threshold config keys from SystemConfig.
   * - Falls back to safe defaults for any key that is missing.
   */
  async getPosSettings(): Promise<PosSettingsResponse> {
    const [
      paymentMethods,
      discountLimitsConfig,
      alertThresholdsConfig,
      syncDefaultsConfig,
      salesConfigConfig,
      activeResolution,
    ] = await Promise.all([
      this.fetchPaymentMethods(),
      this.findConfigValue<DiscountLimits>('POS_DISCOUNT_LIMITS'),
      this.findConfigValue<AlertThresholds>('POS_ALERT_THRESHOLDS'),
      this.findConfigValue<SyncDefaults>('POS_SYNC_DEFAULTS'),
      this.findConfigValue<SalesConfig>('POS_SALES_CONFIG'),
      this.findMostRecentActiveResolution(),
    ]);

    return {
      paymentMethods,
      discountLimits: this.applyDiscountLimitsDefaults(discountLimitsConfig),
      alertThresholds: this.applyAlertThresholdsDefaults(alertThresholdsConfig),
      syncDefaults: {
        batchSize: syncDefaultsConfig?.batchSize ?? 10,
        maxRetryAttempts: syncDefaultsConfig?.maxRetryAttempts ?? 10,
        retryDelaysSeconds: syncDefaultsConfig?.retryDelaysSeconds ?? [
          30, 120, 300, 600, 1800,
        ],
      },
      salesConfig: this.applySalesConfigDefaults(salesConfigConfig),
      sellerInfo: await this.buildSellerInfo(activeResolution),
      resolution: await this.buildResolutionPayload(activeResolution),
    };
  }

  /**
   * Most recent ACTIVE resolution of the tenant, or undefined when no tenant
   * context is bound (JWT-free first boot). Shared by the seller-info and
   * resolution payloads so both reflect the same resolution in one query.
   */
  private async findMostRecentActiveResolution(): Promise<
    FiscalResolution | undefined
  > {
    if (!this.tenantContext.hasTenant()) {
      return undefined;
    }

    const query = new QueryFiscalResolutionsDto();
    query.state = 'ACTIVE';
    query.pageSize = 1;
    const { data } = await this.resolutionsService.findAll(query);
    return data[0];
  }

  /**
   * Builds the issuer identity for the POS from the tenant's fiscal issuer
   * config and the most recent ACTIVE resolution. Returns undefined when no
   * tenant context is bound (JWT-free first boot) or when the issuer config
   * has not been set up yet, so the payload stays compatible with POS builds
   * that predate the field.
   */
  private async buildSellerInfo(
    resolution: FiscalResolution | undefined,
  ): Promise<SellerInfoPayload | undefined> {
    if (!this.tenantContext.hasTenant()) {
      return undefined;
    }

    let issuer: any;
    try {
      issuer = await this.issuerConfigService.find();
    } catch (error) {
      if (error instanceof FiscalIssuerConfigNotSetException) {
        return undefined;
      }
      throw error;
    }

    return {
      nit: issuer.nit,
      name: issuer.businessName,
      address: issuer.address ?? null,
      phone: issuer.phone ?? null,
      resolutionNumber: resolution?.resolutionNumber ?? null,
      resolutionDate: resolution?.validFrom
        ? new Date(resolution.validFrom).toISOString()
        : null,
      // TenantInfo.resolutionPrefix is required on the POS side; 'FE' is the
      // same fallback the desktop store uses for an unconfigured seller.
      resolutionPrefix: resolution?.prefix ?? 'FE',
    };
  }

  /**
   * Builds the resolution payload for the POS counter initialization.
   * Absent without tenant context; null when the tenant has no ACTIVE
   * resolution; otherwise the resolution with the live consecutive counter
   * taken from its most recent allocation.
   */
  private async buildResolutionPayload(
    resolution: FiscalResolution | undefined,
  ): Promise<PosResolutionPayload | null | undefined> {
    if (!this.tenantContext.hasTenant()) {
      return undefined;
    }
    if (!resolution) {
      return null;
    }

    const allocation =
      await this.allocationsService.findLatestForResolution(resolution.id);

    return {
      resolutionNumber: resolution.resolutionNumber,
      documentType: resolution.documentType,
      prefix: resolution.prefix,
      rangeFrom: resolution.rangeFrom,
      rangeTo: resolution.rangeTo,
      validFrom: new Date(resolution.validFrom).toISOString(),
      validTo: new Date(resolution.validTo).toISOString(),
      // The allocation counter is the one the numbering pipeline increments;
      // the resolution-level column is never touched after creation.
      currentConsecutive:
        allocation?.currentConsecutive ?? resolution.currentConsecutive,
      state: resolution.state,
    };
  }

  /**
   * Fetch payment methods that are active, ordered by sortOrder ascending.
   */
  private async fetchPaymentMethods(): Promise<PosPaymentMethod[]> {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        internalCode: true,
        name: true,
        dianCode: true,
        category: true,
        isCash: true,
        sortOrder: true,
        isActive: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      internalCode: r.internalCode,
      name: r.name,
      dianCode: r.dianCode ?? undefined,
      category: r.category as string,
      isCash: r.isCash,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
    }));
  }

  /**
   * Read a single SystemConfig entry and parse its JSON value.
   * Returns `null` when the key does not exist.
   */
  private async findConfigValue<T>(key: string): Promise<T | null> {
    // The endpoint is deliberately JWT-free, so a request may arrive without
    // a tenant context. Fall back to defaults in that case — consistent with
    // RLS fail-closed behavior when the DB role cannot read tenant rows.
    if (!this.tenantContext.hasTenant()) {
      return null;
    }
    const row = await this.prisma.systemConfig.findUnique({
      where: {
        subscriptionId_key: {
          subscriptionId: this.tenantContext.getSubscriptionId(),
          key,
        },
      },
      select: { value: true },
    });
    if (!row) return null;

    // value is a Prisma Json value; it may be a raw value, an object, or an array.
    // For our payloads the expected shape is an object (record).
    if (
      typeof row.value === 'object' &&
      row.value !== null &&
      !Array.isArray(row.value)
    ) {
      return row.value as T;
    }
    return null;
  }

  private applyDiscountLimitsDefaults(
    raw: DiscountLimits | null,
  ): DiscountLimits {
    const safe: DiscountLimits = {
      cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
      admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
      inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
      accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
      manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
    };

    if (!raw) return safe;

    return {
      cashier: {
        itemMaxPercent:
          raw.cashier?.itemMaxPercent ?? safe.cashier.itemMaxPercent,
        globalMaxPercent:
          raw.cashier?.globalMaxPercent ?? safe.cashier.globalMaxPercent,
      },
      admin: {
        itemMaxPercent: raw.admin?.itemMaxPercent ?? safe.admin.itemMaxPercent,
        globalMaxPercent:
          raw.admin?.globalMaxPercent ?? safe.admin.globalMaxPercent,
      },
      inventoryAssistant: {
        itemMaxPercent:
          raw.inventoryAssistant?.itemMaxPercent ??
          safe.inventoryAssistant.itemMaxPercent,
        globalMaxPercent:
          raw.inventoryAssistant?.globalMaxPercent ??
          safe.inventoryAssistant.globalMaxPercent,
      },
      accountant: {
        itemMaxPercent:
          raw.accountant?.itemMaxPercent ?? safe.accountant.itemMaxPercent,
        globalMaxPercent:
          raw.accountant?.globalMaxPercent ?? safe.accountant.globalMaxPercent,
      },
      owner: {
        itemMaxPercent: raw.owner?.itemMaxPercent ?? safe.owner.itemMaxPercent,
        globalMaxPercent:
          raw.owner?.globalMaxPercent ?? safe.owner.globalMaxPercent,
      },
      manager: {
        itemMaxPercent:
          raw.manager?.itemMaxPercent ?? safe.manager.itemMaxPercent,
        globalMaxPercent:
          raw.manager?.globalMaxPercent ?? safe.manager.globalMaxPercent,
      },
    };
  }

  private applyAlertThresholdsDefaults(
    raw: AlertThresholds | null,
  ): AlertThresholds {
    const safe: AlertThresholds = {
      expirationWarningDays: 30,
      lowStockAlertEnabled: true,
    };
    if (!raw) return safe;

    return {
      expirationWarningDays:
        raw.expirationWarningDays ?? safe.expirationWarningDays,
      lowStockAlertEnabled:
        raw.lowStockAlertEnabled ?? safe.lowStockAlertEnabled,
    };
  }

  /**
   * Apply safe defaults to a sales-config payload read from SystemConfig.
   *
   * Owner is implicitly allowed to override prices and exempt from the cost
   * floor, so neither role appears in `priceOverridePermissions`; admin is
   * legacy and likewise omitted. Defaults can be overridden by
   * `POS_SALES_CONFIG` in SystemConfig; missing sub-fields fall back to
   * safe values rather than blowing the entire block away.
   */
  private applySalesConfigDefaults(raw: SalesConfig | null): SalesConfig {
    const safe: SalesConfig = {
      priceOverridePermissions: {
        cashier: { allowed: false, requireReason: true },
        manager: { allowed: true, requireReason: true },
        inventoryAssistant: { allowed: false, requireReason: true },
        accountant: { allowed: false, requireReason: true },
      },
      priceFloor: { enabled: true, type: 'COST', minMarginPercent: 0 },
    };

    if (!raw) return safe;

    const rawOverride = raw.priceOverridePermissions;
    const rawFloor = raw.priceFloor;

    return {
      priceOverridePermissions: {
        cashier: {
          allowed:
            rawOverride?.cashier?.allowed ??
            safe.priceOverridePermissions.cashier.allowed,
          requireReason:
            rawOverride?.cashier?.requireReason ??
            safe.priceOverridePermissions.cashier.requireReason,
        },
        manager: {
          allowed:
            rawOverride?.manager?.allowed ??
            safe.priceOverridePermissions.manager.allowed,
          requireReason:
            rawOverride?.manager?.requireReason ??
            safe.priceOverridePermissions.manager.requireReason,
        },
        inventoryAssistant: {
          allowed:
            rawOverride?.inventoryAssistant?.allowed ??
            safe.priceOverridePermissions.inventoryAssistant.allowed,
          requireReason:
            rawOverride?.inventoryAssistant?.requireReason ??
            safe.priceOverridePermissions.inventoryAssistant.requireReason,
        },
        accountant: {
          allowed:
            rawOverride?.accountant?.allowed ??
            safe.priceOverridePermissions.accountant.allowed,
          requireReason:
            rawOverride?.accountant?.requireReason ??
            safe.priceOverridePermissions.accountant.requireReason,
        },
      },
      priceFloor: {
        enabled: rawFloor?.enabled ?? safe.priceFloor.enabled,
        type: rawFloor?.type ?? safe.priceFloor.type,
        minMarginPercent:
          rawFloor?.minMarginPercent ?? safe.priceFloor.minMarginPercent,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RoleDiscountLimit {
  itemMaxPercent: number;
  globalMaxPercent: number;
}

interface DiscountLimits {
  cashier: RoleDiscountLimit;
  admin: RoleDiscountLimit;
  inventoryAssistant: RoleDiscountLimit;
  accountant: RoleDiscountLimit;
  owner: RoleDiscountLimit;
  manager: RoleDiscountLimit;
}

interface AlertThresholds {
  expirationWarningDays: number;
  lowStockAlertEnabled: boolean;
}

interface SyncDefaults {
  batchSize?: number;
  maxRetryAttempts?: number;
  retryDelaysSeconds?: number[];
}

interface RolePriceOverride {
  allowed: boolean;
  requireReason: boolean;
}

interface PriceOverridePermissions {
  cashier: RolePriceOverride;
  manager: RolePriceOverride;
  inventoryAssistant: RolePriceOverride;
  accountant: RolePriceOverride;
}

type PriceFloorType = 'COST' | 'COST_PLUS_MARGIN';

interface PriceFloorConfig {
  enabled: boolean;
  type: PriceFloorType;
  minMarginPercent: number;
}

interface SalesConfig {
  priceOverridePermissions: PriceOverridePermissions;
  priceFloor: PriceFloorConfig;
}

interface PosPaymentMethod {
  id: string;
  internalCode: string;
  name: string;
  dianCode?: string;
  category: string;
  isCash: boolean;
  sortOrder: number;
  isActive: boolean;
}
