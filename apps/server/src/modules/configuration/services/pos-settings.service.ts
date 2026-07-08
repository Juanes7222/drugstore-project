/**
 * Service that assembles the POS settings payload.
 *
 * Gathers payment methods, discount limits from SystemConfig, and static
 * alert/sync-defaults into a single structured response for the
 * `GET /configuration/pos-settings` endpoint.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import type { PosSettingsResponse } from '../dto/pos-settings-response.dto';

@Injectable()
export class PosSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the full POS settings response.
   *
   * - Reads active payment methods from the database.
   * - Reads discount-limit and alert-threshold config keys from SystemConfig.
   * - Falls back to safe defaults for any key that is missing.
   */
  async getPosSettings(): Promise<PosSettingsResponse> {
    const [paymentMethods, discountLimitsConfig, alertThresholdsConfig, syncDefaultsConfig] =
      await Promise.all([
        this.fetchPaymentMethods(),
        this.findConfigValue<DiscountLimits>(
          'POS_DISCOUNT_LIMITS',
        ),
        this.findConfigValue<AlertThresholds>(
          'POS_ALERT_THRESHOLDS',
        ),
        this.findConfigValue<SyncDefaults>(
          'POS_SYNC_DEFAULTS',
        ),
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
    const row = await this.prisma.systemConfig.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row) return null;

    // value is a Prisma Json value; it may be a raw value, an object, or an array.
    // For our payloads the expected shape is an object (record).
    if (typeof row.value === 'object' && row.value !== null && !Array.isArray(row.value)) {
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
    };

    if (!raw) return safe;

    return {
      cashier: {
        itemMaxPercent: raw.cashier?.itemMaxPercent ?? safe.cashier.itemMaxPercent,
        globalMaxPercent: raw.cashier?.globalMaxPercent ?? safe.cashier.globalMaxPercent,
      },
      admin: {
        itemMaxPercent: raw.admin?.itemMaxPercent ?? safe.admin.itemMaxPercent,
        globalMaxPercent: raw.admin?.globalMaxPercent ?? safe.admin.globalMaxPercent,
      },
      inventoryAssistant: {
        itemMaxPercent: raw.inventoryAssistant?.itemMaxPercent ?? safe.inventoryAssistant.itemMaxPercent,
        globalMaxPercent: raw.inventoryAssistant?.globalMaxPercent ?? safe.inventoryAssistant.globalMaxPercent,
      },
      accountant: {
        itemMaxPercent: raw.accountant?.itemMaxPercent ?? safe.accountant.itemMaxPercent,
        globalMaxPercent: raw.accountant?.globalMaxPercent ?? safe.accountant.globalMaxPercent,
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
      expirationWarningDays: raw.expirationWarningDays ?? safe.expirationWarningDays,
      lowStockAlertEnabled: raw.lowStockAlertEnabled ?? safe.lowStockAlertEnabled,
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