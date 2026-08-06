// ---------------------------------------------------------------------------
// TenantConfigService — main business logic for per-subscription tenant
// configuration: CRUD, preset application, custom fields/toggles, history,
// and rollback.
// ---------------------------------------------------------------------------

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ConfigValidationService } from './config-validation.service';
import { ConfigVersionConflictException } from '../exceptions/config-version-conflict.exception';
import { ConfigValidationException } from '../exceptions/config-validation.exception';
import { PresetNotFoundException } from '../exceptions/preset-not-found.exception';
import {
  RoleType,
} from '@pharmacy/shared-types';
import type {
  TenantConfig,
  StrictnessConfig,
  FiscalConfig,
  WorkflowConfig,
  PurchasesConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
  ConfigChangelogEntry,
  TenantConfigSyncPayload,
  WorkstationConfig,
  PresetDefinition,
  PresetCode,
  DeliveryConfig,
} from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Built-in preset definitions
// ---------------------------------------------------------------------------

type PresetStrictness = Pick<
  StrictnessConfig,
  | 'lots'
  | 'expiryDates'
  | 'stockValidation'
  | 'clientRequired'
  | 'prescriptionEnforcement'
  | 'inventoryAdjustmentReason'
  | 'returnsRequireOriginalSale'
  | 'cashShiftRequired'
  | 'receiptPrintRequired'
  | 'autoOpenDrawer'
  | 'customerDisplayRequired'
  | 'prescriptionExpiryDays'
  | 'clientRequiredThreshold'
>;

type PresetWorkflow = Pick<
  WorkflowConfig,
  | 'defaultPaymentMethodId'
  | 'autoPrintOnConfirm'
  | 'autoOpenDrawerOnConfirm'
  | 'printDuplicateReceipt'
  | 'requireShiftOpenForSale'
  | 'maxOfflineLoginDays'
  | 'sessionIdleTimeoutSeconds'
  | 'sessionIdleTimeouts'
  | 'suggestionEngineEnabled'
  | 'autoReprintLastReceiptOnReprint'
  | 'delivery'
>;

/**
 * Default delivery (domicilio) policy — the feature is OFF by default; a
 * tenant must enable it explicitly. Mirrors the POS DEFAULT_DELIVERY in
 * apps/pos-desktop/src/domain/config/defaults.ts.
 */
const DEFAULT_DELIVERY: DeliveryConfig = {
  enabled: false,
  requiresClient: false,
  addressRequired: true,
  phoneRequired: false,
  allowScheduling: false,
  deliveryFeeMode: 'DISABLED',
  fixedDeliveryFeeCents: 0,
  maxDeliveryFeeCents: 0,
  printOnReceipt: true,
  enableStatusTracking: false,
};

interface PresetData {
  strictness: PresetStrictness;
  workflow: PresetWorkflow;
  purchases: PurchasesConfig;
}

const PRESETS: Record<string, PresetData> = {
  SIMPLE: {
    strictness: {
      lots: 'OFF',
      expiryDates: 'OFF',
      stockValidation: 'WARN',
      clientRequired: 'NEVER',
      clientRequiredThreshold: 0,
      prescriptionEnforcement: 'OFF',
      inventoryAdjustmentReason: 'OPTIONAL',
      returnsRequireOriginalSale: 'OFF',
      cashShiftRequired: false,
      receiptPrintRequired: 'OPTIONAL',
      autoOpenDrawer: 'ALWAYS',
      customerDisplayRequired: false,
      prescriptionExpiryDays: 365,
    },
    workflow: {
      defaultPaymentMethodId: null,
      autoPrintOnConfirm: true,
      autoOpenDrawerOnConfirm: 'ALWAYS',
      printDuplicateReceipt: false,
      requireShiftOpenForSale: false,
      maxOfflineLoginDays: 30,
      sessionIdleTimeoutSeconds: 3600,
      sessionIdleTimeouts: {
        cashier: 3600,
        manager: 7200,
        owner: 14400,
      },
      suggestionEngineEnabled: false,
      autoReprintLastReceiptOnReprint: false,
      // SIMPLE: domicilios allowed, no client/address/phone requirement.
      delivery: {
        enabled: true,
        requiresClient: false,
        addressRequired: false,
        phoneRequired: false,
        allowScheduling: false,
        deliveryFeeMode: 'DISABLED',
        fixedDeliveryFeeCents: 0,
        maxDeliveryFeeCents: 0,
        printOnReceipt: true,
        enableStatusTracking: false,
      },
    },
    purchases: {
      autoConfirmOnCreate: true,
      requireManagerPinForConfirm: false,
      requireManagerPinForAnnul: false,
      requireLotOnReception: false,
      requireExpiryOnReception: false,
      allowOverReception: true,
      defaultPaymentTermsDays: 30,
      maxItemsPerOrder: 0,
    },
  },
  BALANCED: {
    strictness: {
      lots: 'OPTIONAL',
      expiryDates: 'OPTIONAL',
      stockValidation: 'WARN',
      clientRequired: 'ABOVE_AMOUNT',
      clientRequiredThreshold: 50000,
      prescriptionEnforcement: 'STRICT',
      inventoryAdjustmentReason: 'OPTIONAL',
      returnsRequireOriginalSale: 'STRICT',
      cashShiftRequired: true,
      receiptPrintRequired: 'STRICT',
      autoOpenDrawer: 'CASH_ONLY',
      customerDisplayRequired: false,
      prescriptionExpiryDays: 180,
    },
    workflow: {
      defaultPaymentMethodId: null,
      autoPrintOnConfirm: true,
      autoOpenDrawerOnConfirm: 'CASH_ONLY',
      printDuplicateReceipt: false,
      requireShiftOpenForSale: true,
      maxOfflineLoginDays: 30,
      sessionIdleTimeoutSeconds: 600,
      sessionIdleTimeouts: {
        cashier: 600,
        manager: 1800,
        owner: 3600,
      },
      suggestionEngineEnabled: true,
      autoReprintLastReceiptOnReprint: true,
      // BALANCED: domicilios require a client and an address; scheduling allowed.
      delivery: {
        enabled: true,
        requiresClient: true,
        addressRequired: true,
        phoneRequired: false,
        allowScheduling: true,
        deliveryFeeMode: 'DISABLED',
        fixedDeliveryFeeCents: 0,
        maxDeliveryFeeCents: 0,
        printOnReceipt: true,
        enableStatusTracking: false,
      },
    },
    purchases: {
      autoConfirmOnCreate: false,
      requireManagerPinForConfirm: false,
      requireManagerPinForAnnul: false,
      requireLotOnReception: true,
      requireExpiryOnReception: true,
      allowOverReception: false,
      defaultPaymentTermsDays: 30,
      maxItemsPerOrder: 50,
    },
  },
  STRICT: {
    strictness: {
      lots: 'STRICT',
      expiryDates: 'STRICT',
      stockValidation: 'STRICT',
      clientRequired: 'ALWAYS',
      clientRequiredThreshold: 0,
      prescriptionEnforcement: 'STRICT',
      inventoryAdjustmentReason: 'STRICT',
      returnsRequireOriginalSale: 'STRICT',
      cashShiftRequired: true,
      receiptPrintRequired: 'STRICT',
      autoOpenDrawer: 'CASH_ONLY',
      customerDisplayRequired: true,
      prescriptionExpiryDays: 90,
    },
    workflow: {
      defaultPaymentMethodId: null,
      autoPrintOnConfirm: true,
      autoOpenDrawerOnConfirm: 'CASH_ONLY',
      printDuplicateReceipt: true,
      requireShiftOpenForSale: true,
      maxOfflineLoginDays: 15,
      sessionIdleTimeoutSeconds: 300,
      sessionIdleTimeouts: {
        cashier: 300,
        manager: 900,
        owner: 1800,
      },
      suggestionEngineEnabled: true,
      autoReprintLastReceiptOnReprint: true,
      // STRICT: domicilios require client, address AND phone; status tracking on.
      delivery: {
        enabled: true,
        requiresClient: true,
        addressRequired: true,
        phoneRequired: true,
        allowScheduling: false,
        deliveryFeeMode: 'DISABLED',
        fixedDeliveryFeeCents: 0,
        maxDeliveryFeeCents: 0,
        printOnReceipt: true,
        enableStatusTracking: true,
      },
    },
    purchases: {
      autoConfirmOnCreate: false,
      requireManagerPinForConfirm: true,
      requireManagerPinForAnnul: true,
      requireLotOnReception: true,
      requireExpiryOnReception: true,
      allowOverReception: false,
      defaultPaymentTermsDays: 15,
      maxItemsPerOrder: 20,
    },
  },
};

const PRESET_NAMES: Record<string, string> = {
  SIMPLE: 'Sencillo',
  BALANCED: 'Balanceado',
  STRICT: 'Estricto',
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  SIMPLE:
    'Configuración mínima — ideal para establecimientos de baja rotación o no obligados a facturar electrónicamente',
  BALANCED:
    'Configuración recomendada — equilibrio entre control operativo y agilidad en punto de venta',
  STRICT:
    'Máximo control — ideal para cadenas farmacéuticas y establecimientos con alta regulación',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class TenantConfigService {
  constructor(
    private prisma: PrismaService,
    private validationService: ConfigValidationService,
  ) {}

  // -- Read ----------------------------------------------------------------

  async getBySubscription(subscriptionId: string): Promise<TenantConfig> {
    const raw = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!raw) {
      // Return a computed default when no record exists yet — allows the
      // POS frontend to render its config screen during initial refresh()
      // without requiring a prior POST or an explicit init step.
      return this.buildDefaultEntity(subscriptionId);
    }
    return this.toEntity(raw);
  }

  // -- Create default ------------------------------------------------------

  /**
   * Return a computed default TenantConfig when no DB record exists yet.
   * Does NOT persist — allows the POS frontend to render its config screen
   * during initial refresh() without requiring a prior POST or explicit init.
   */
  private buildDefaultEntity(subscriptionId: string): TenantConfig {
    const preset = PRESETS['BALANCED'];

    return {
      id: '',
      subscriptionId,
      activePresetCode: 'BALANCED',
      strictness: preset.strictness as StrictnessConfig,
      fiscal: this.emptyFiscalConfig(),
      workflow: preset.workflow as WorkflowConfig,
      purchases: preset.purchases as PurchasesConfig,
      customCompanyFields: [],
      customStrictnessToggles: [],
      configVersion: 1,
      lastModifiedByUserId: '',
      lastModifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  async createDefault(
    subscriptionId: string,
    actorUserId?: string,
  ): Promise<TenantConfig> {
    const existing = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (existing) {
      return this.toEntity(existing);
    }

    const preset = PRESETS['BALANCED'];

    const config = await this.prisma.tenantConfig.create({
      data: {
        id: this.genId(),
        subscriptionId,
        activePresetCode: 'BALANCED',
        strictness: this.json(preset.strictness),
        fiscal: this.json(this.emptyFiscalConfig()),
        workflow: this.json(preset.workflow),
        purchases: this.json(preset.purchases),
        customCompanyFields: [],
        customStrictnessToggles: [],
        configVersion: 1,
        lastModifiedById: actorUserId ?? null,
      },
    });

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: config.id,
        configVersion: 1,
        changeType: 'PRESET_APPLIED',
        fieldPath: null,
        beforeValue: Prisma.JsonNull,
        afterValue: this.json({ presetCode: 'BALANCED' }),
        actorUserId: actorUserId ?? null,
      },
    });

    return this.toEntity(config);
  }

  // -- Full update ---------------------------------------------------------

  /**
   * System-level strictness keys that only OWNER/SAAS_ADMIN can modify.
   * MANAGER role can only update workstation-level fields.
   */
  private readonly SYSTEM_STRICTNESS_KEYS: ReadonlySet<string> = new Set([
    'lots',
    'expiryDates',
    'stockValidation',
    'clientRequired',
    'clientRequiredThreshold',
    'prescriptionEnforcement',
    'prescriptionExpiryDays',
    'returnsRequireOriginalSale',
  ]);

  async update(
    subscriptionId: string,
    dto: {
      strictness?: Partial<StrictnessConfig>;
      fiscal?: Partial<FiscalConfig>;
      workflow?: Partial<WorkflowConfig>;
      purchases?: Partial<PurchasesConfig>;
      expectedConfigVersion: number;
    },
    actorUserId: string,
    actorRole?: string,
  ): Promise<TenantConfig> {
    // Auto-create a default config if none exists yet — allows the POS to
    // save its first config without requiring a prior init call.
    const current = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!current) {
      return this.createDefaultAndUpdate(subscriptionId, dto, actorUserId);
    }

    if (current.configVersion !== dto.expectedConfigVersion) {
      throw new ConfigVersionConflictException(current.configVersion);
    }

    // Merge partial update with current config from DB at the field level.
    // dto.strictness/fiscal/workflow may be partial objects containing only
    // the fields the user actually changed.
    const mergedStrictness: StrictnessConfig = dto.strictness
      ? { ...(current.strictness as unknown as StrictnessConfig), ...dto.strictness }
      : (current.strictness as unknown as StrictnessConfig);
    const mergedFiscal: FiscalConfig = dto.fiscal
      ? { ...(current.fiscal as unknown as FiscalConfig), ...dto.fiscal }
      : (current.fiscal as unknown as FiscalConfig);
    const mergedWorkflow: WorkflowConfig = dto.workflow
      ? this.withDeliveryDefaults({ ...(current.workflow as unknown as WorkflowConfig), ...dto.workflow })
      : this.withDeliveryDefaults(current.workflow as unknown as WorkflowConfig);
    const mergedPurchases: PurchasesConfig = dto.purchases
      ? { ...(current.purchases as unknown as PurchasesConfig), ...dto.purchases }
      : (current.purchases as unknown as PurchasesConfig);

    // Auto-adjust defaultTaxRate when taxRegime changes — Colombian fiscal rule.
    // NO_RESPONSABLE and EXENTO regimes don't charge IVA; spreading the old rate
    // from the frontend would incorrectly preserve it.
    if (dto.fiscal?.taxRegime) {
      const regimeDefaultRates: Record<string, number | undefined> = {
        NO_RESPONSABLE: 0,
        EXENTO: 0,
        RESPONSABLE_IVA: 0.19,
        // SIMPLE: keep current — rate varies per municipality
      };
      const rate = regimeDefaultRates[dto.fiscal.taxRegime];
      if (rate !== undefined) {
        mergedFiscal.defaultTaxRate = rate;
      }
    }

    // RBAC: MANAGER role cannot modify system-level fields
    if (actorRole === RoleType.MANAGER) {
      this.assertNoSystemFieldChanges(
        current.strictness as unknown as StrictnessConfig,
        mergedStrictness,
        current.fiscal as unknown as FiscalConfig,
        mergedFiscal,
      );
    }

    // Validate strictness and workflow always (preset defaults are always
    // structurally valid).  Only validate fiscal when the DB already has a
    // fully-configured fiscal (all required fields filled). During the initial
    // setup the admin fills fields one at a time via auto-save — partial
    // fiscal should not block changes to other sections.
    const validationInput: Parameters<typeof this.validationService.validate>[0] = {};
    validationInput.strictness = mergedStrictness;
    const dbFiscalForValidation = current.fiscal as unknown as FiscalConfig;
    // Validate fiscal only when:
    // 1. DB already has a fully-configured fiscal (prevents wiping required fields), OR
    // 2. The merged payload becomes fully configured (single-shot complete save).
    // Skip during initial setup where admin fills fields one at a time via auto-save.
    if (this.isFiscalFullyConfigured(dbFiscalForValidation) || this.isFiscalFullyConfigured(mergedFiscal)) {
      validationInput.fiscal = mergedFiscal;
    }
    validationInput.workflow = mergedWorkflow;
    validationInput.purchases = mergedPurchases;

    const validationErrors = this.validationService.validate(validationInput);
    if (validationErrors.length > 0) {
      throw new ConfigValidationException(validationErrors);
    }

    const now = new Date();
    const newVersion = current.configVersion + 1;

    // Build update data — only include sections that actually changed
    const updateData: Record<string, unknown> = {
      configVersion: newVersion,
      lastModifiedById: actorUserId,
      lastModifiedAt: now,
    };

    const changes: Array<{
      fieldPath: string;
      beforeValue: unknown;
      afterValue: unknown;
    }> = [];

    if (dto.strictness) {
      if (!this.deepEqual(current.strictness, mergedStrictness)) {
        changes.push({
          fieldPath: 'strictness',
          beforeValue: current.strictness,
          afterValue: mergedStrictness,
        });
      }
      updateData.strictness = this.json(mergedStrictness);
    }
    if (dto.fiscal) {
      if (!this.deepEqual(current.fiscal, mergedFiscal)) {
        changes.push({
          fieldPath: 'fiscal',
          beforeValue: current.fiscal,
          afterValue: mergedFiscal,
        });
      }
      updateData.fiscal = this.json(mergedFiscal);
    }
    if (dto.workflow) {
      if (!this.deepEqual(current.workflow, mergedWorkflow)) {
        changes.push({
          fieldPath: 'workflow',
          beforeValue: current.workflow,
          afterValue: mergedWorkflow,
        });
      }
      updateData.workflow = this.json(mergedWorkflow);
    }
    if (dto.purchases) {
      if (!this.deepEqual(current.purchases, mergedPurchases)) {
        changes.push({
          fieldPath: 'purchases',
          beforeValue: current.purchases,
          afterValue: mergedPurchases,
        });
      }
      updateData.purchases = this.json(mergedPurchases);
    }

    const updated = await this.updateConfigWithVersionGuard(
      current.id,
      current.configVersion,
      updateData,
    );

    if (changes.length > 0) {
      for (const c of changes) {
        await this.prisma.configChangelog.create({
          data: {
            id: this.genId(),
            tenantConfigId: current.id,
            configVersion: newVersion,
            changeType: 'FIELD_UPDATED',
            fieldPath: c.fieldPath,
            beforeValue: this.json(c.beforeValue),
            afterValue: this.json(c.afterValue),
            actorUserId,
            createdAt: now,
          },
        });
      }
    }

    return this.toEntity(updated);
  }

  // -- Preset application --------------------------------------------------

  async applyPreset(
    subscriptionId: string,
    presetCode: string,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const preset = PRESETS[presetCode];
    if (!preset) {
      throw new PresetNotFoundException(presetCode);
    }

    const current = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!current) {
      throw new NotFoundException(
        `Tenant configuration not found for subscription "${subscriptionId}".`,
      );
    }

    const newVersion = current.configVersion + 1;
    const now = new Date();

    const updated = await this.updateConfigWithVersionGuard(
      current.id,
      current.configVersion,
      {
        strictness: this.json(preset.strictness),
        workflow: this.json(preset.workflow),
        purchases: this.json(preset.purchases),
        activePresetCode: presetCode,
        configVersion: newVersion,
        lastModifiedById: actorUserId,
        lastModifiedAt: now,
      },
    );

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: current.id,
        configVersion: newVersion,
        changeType: 'PRESET_APPLIED',
        fieldPath: null,
        beforeValue: this.json({ presetCode: current.activePresetCode }),
        afterValue: this.json({ presetCode }),
        actorUserId,
        createdAt: now,
      },
    });

    return this.toEntity(updated);
  }

  async resetToPreset(
    subscriptionId: string,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const current = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!current) {
      throw new NotFoundException(
        `Tenant configuration not found for subscription "${subscriptionId}".`,
      );
    }

    const presetCode = current.activePresetCode as string;
    const preset = PRESETS[presetCode];
    if (!preset) {
      throw new PresetNotFoundException(presetCode ?? 'CUSTOM');
    }

    const newVersion = current.configVersion + 1;
    const now = new Date();

    const updated = await this.updateConfigWithVersionGuard(
      current.id,
      current.configVersion,
      {
        strictness: this.json(preset.strictness),
        workflow: this.json(preset.workflow),
        purchases: this.json(preset.purchases),
        configVersion: newVersion,
        lastModifiedById: actorUserId,
        lastModifiedAt: now,
      },
    );

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: current.id,
        configVersion: newVersion,
        changeType: 'RESET_TO_PRESET',
        fieldPath: null,
        beforeValue: this.json({
          strictness: current.strictness,
          workflow: current.workflow,
          purchases: current.purchases,
        }),
        afterValue: this.json({
          strictness: preset.strictness,
          workflow: preset.workflow,
          purchases: preset.purchases,
        }),
        actorUserId,
        createdAt: now,
      },
    });

    return this.toEntity(updated);
  }

  // -- Custom fields -------------------------------------------------------

  async addCustomField(
    subscriptionId: string,
    field: CustomCompanyField,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const fields = (config.customCompanyFields ?? []) as CustomCompanyField[];

    const validationErrors = this.validationService.validate({
      customCompanyFields: [...fields, field],
    });
    if (validationErrors.length > 0) {
      throw new ConfigValidationException(validationErrors);
    }

    if (!field.id) {
      field = { ...field, id: this.genId() };
    }
    fields.push(field);

    return this.updateCustomArray(config, 'customCompanyFields', fields, 'CUSTOM_FIELD_ADDED', field.id, null, actorUserId);
  }

  async updateCustomField(
    subscriptionId: string,
    fieldId: string,
    updates: Partial<CustomCompanyField>,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const fields = (config.customCompanyFields ?? []) as CustomCompanyField[];
    const idx = fields.findIndex((f) => f.id === fieldId);

    if (idx === -1) {
      throw new NotFoundException(`Custom field with id "${fieldId}" not found`);
    }

    const before = { ...fields[idx] };
    fields[idx] = { ...fields[idx], ...updates };

    return this.updateCustomArray(config, 'customCompanyFields', fields, 'CUSTOM_FIELD_UPDATED', fieldId, before, actorUserId);
  }

  async removeCustomField(
    subscriptionId: string,
    fieldId: string,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const fields = (config.customCompanyFields ?? []) as CustomCompanyField[];
    const idx = fields.findIndex((f) => f.id === fieldId);
    if (idx === -1) {
      throw new NotFoundException(`Custom field with id "${fieldId}" not found`);
    }

    const removed = fields.splice(idx, 1)[0];
    return this.updateCustomArray(config, 'customCompanyFields', fields, 'CUSTOM_FIELD_REMOVED', fieldId, removed, actorUserId);
  }

  // -- Custom toggles ------------------------------------------------------

  async addCustomToggle(
    subscriptionId: string,
    toggle: CustomStrictnessToggle,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const toggles = (config.customStrictnessToggles ?? []) as CustomStrictnessToggle[];

    const validationErrors = this.validationService.validate({
      customStrictnessToggles: [...toggles, toggle],
    });
    if (validationErrors.length > 0) {
      throw new ConfigValidationException(validationErrors);
    }

    if (!toggle.id) {
      toggle = { ...toggle, id: this.genId() };
    }
    toggles.push(toggle);

    return this.updateCustomArray(config, 'customStrictnessToggles', toggles, 'CUSTOM_TOGGLE_ADDED', toggle.id, null, actorUserId);
  }

  async updateCustomToggle(
    subscriptionId: string,
    toggleId: string,
    updates: Partial<CustomStrictnessToggle>,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const toggles = (config.customStrictnessToggles ?? []) as CustomStrictnessToggle[];
    const idx = toggles.findIndex((t) => t.id === toggleId);
    if (idx === -1) {
      throw new NotFoundException(`Custom toggle with id "${toggleId}" not found`);
    }

    const before = { ...toggles[idx] };
    toggles[idx] = { ...toggles[idx], ...updates };

    return this.updateCustomArray(config, 'customStrictnessToggles', toggles, 'CUSTOM_TOGGLE_UPDATED', toggleId, before, actorUserId);
  }

  async removeCustomToggle(
    subscriptionId: string,
    toggleId: string,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);
    const toggles = (config.customStrictnessToggles ?? []) as CustomStrictnessToggle[];
    const idx = toggles.findIndex((t) => t.id === toggleId);
    if (idx === -1) {
      throw new NotFoundException(`Custom toggle with id "${toggleId}" not found`);
    }

    const removed = toggles.splice(idx, 1)[0];
    return this.updateCustomArray(config, 'customStrictnessToggles', toggles, 'CUSTOM_TOGGLE_REMOVED', toggleId, removed, actorUserId);
  }

  // -- History & rollback --------------------------------------------------

  async getHistory(
    subscriptionId: string,
    limit = 30,
  ): Promise<ConfigChangelogEntry[]> {
    const config = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!config) return [];

    const rows = await this.prisma.configChangelog.findMany({
      where: { tenantConfigId: config.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((r: any) => ({
      id: r.id,
      tenantConfigId: r.tenantConfigId,
      configVersion: r.configVersion,
      changeType: r.changeType,
      fieldPath: r.fieldPath,
      beforeValue: r.beforeValue,
      afterValue: r.afterValue,
      actorUserId: r.actorUserId ?? '',
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async rollback(
    subscriptionId: string,
    targetVersion: number,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const config = await this.getRawOrThrow(subscriptionId);

    if (targetVersion >= config.configVersion) {
      throw new ConfigValidationException([
        {
          path: 'configVersion',
          message: `Target version ${targetVersion} is not older than current version ${config.configVersion}`,
          code: 'ROLLBACK_TARGET_NOT_OLDER',
        },
      ]);
    }

    const entries = await this.prisma.configChangelog.findMany({
      where: {
        tenantConfigId: config.id,
        configVersion: { gt: targetVersion },
      },
      orderBy: { configVersion: 'desc' },
    });

    if (entries.length === 0) {
      return this.toEntity(config);
    }

    const newStrictness: Record<string, unknown> = { ...(config.strictness as Record<string, unknown>) };
    const newFiscal: Record<string, unknown> = { ...(config.fiscal as Record<string, unknown>) };
    const newWorkflow: Record<string, unknown> = { ...(config.workflow as Record<string, unknown>) };
    const newPurchases: Record<string, unknown> = { ...(config.purchases as Record<string, unknown>) };

    for (const entry of entries) {
      if (!entry.fieldPath || !entry.beforeValue) continue;

      if (entry.fieldPath === 'strictness') {
        Object.assign(newStrictness, entry.beforeValue as Record<string, unknown>);
      } else if (entry.fieldPath === 'fiscal') {
        Object.assign(newFiscal, entry.beforeValue as Record<string, unknown>);
      } else if (entry.fieldPath === 'workflow') {
        Object.assign(newWorkflow, entry.beforeValue as Record<string, unknown>);
      } else if (entry.fieldPath === 'purchases') {
        Object.assign(newPurchases, entry.beforeValue as Record<string, unknown>);
      }
    }

    const newVersion = config.configVersion + 1;
    const now = new Date();

    const updated = await this.updateConfigWithVersionGuard(
      config.id,
      config.configVersion,
      {
        strictness: this.json(newStrictness),
        fiscal: this.json(newFiscal),
        workflow: this.json(newWorkflow),
        purchases: this.json(newPurchases),
        configVersion: newVersion,
        lastModifiedById: actorUserId,
        lastModifiedAt: now,
      },
    );

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: config.id,
        configVersion: newVersion,
        changeType: 'ROLLBACK',
        fieldPath: null,
        beforeValue: this.json({ configVersion: config.configVersion }),
        afterValue: this.json({ configVersion: targetVersion }),
        actorUserId,
        createdAt: now,
      },
    });

    return this.toEntity(updated);
  }

  // -- Sync payload --------------------------------------------------------

  async getSyncPayload(
    subscriptionId: string,
    workstationId?: string,
  ): Promise<TenantConfigSyncPayload> {
    const config = await this.getBySubscription(subscriptionId);

    let workstationConfig: WorkstationConfig | undefined;
    if (workstationId) {
      const key = `ws_config:${subscriptionId}:${workstationId}`;
      const row = await this.prisma.systemConfig.findUnique({
        where: { subscriptionId_key: { subscriptionId, key } },
      });
      if (row) {
        const val = row.value as Record<string, unknown>;
        workstationConfig = {
          id: key,
          subscriptionId,
          workstationId,
          workflow: ((val.workflow ?? {}) as unknown) as Partial<WorkflowConfig>,
          strictness: ((val.strictness ?? {}) as unknown) as Partial<StrictnessConfig>,
          createdAt: (val.createdAt as string) ?? new Date().toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }
    }

    return { config, presets: this.getAllPresetDefinitions(), workstationConfig };
  }

  // -- Preset definitions --------------------------------------------------

  getAllPresetDefinitions(): PresetDefinition[] {
    return Object.entries(PRESETS).map(([code, data]) => ({
      code: code as PresetCode,
      name: PRESET_NAMES[code] ?? code,
      description: PRESET_DESCRIPTIONS[code] ?? '',
      strictness: data.strictness as Partial<StrictnessConfig>,
      fiscal: {},
      workflow: data.workflow as Partial<WorkflowConfig>,
      purchases: data.purchases as Partial<PurchasesConfig>,
    }));
  }

  // -- Named presets -------------------------------------------------------

  async saveNamedPreset(
    subscriptionId: string,
    name: string,
    description: string | undefined,
    isShared: boolean,
    actorUserId: string,
  ): Promise<{ id: string }> {
    const config = await this.getRawOrThrow(subscriptionId);

    const preset = await this.prisma.namedPreset.create({
      data: {
        id: this.genId(),
        subscriptionId,
        name,
        description: description ?? null,
        strictness: this.json(config.strictness),
        fiscal: this.json(config.fiscal),
        workflow: this.json(config.workflow),
        purchases: this.json(config.purchases),
        customCompanyFields: this.jsonArray(config.customCompanyFields),
        customStrictnessToggles: this.jsonArray(config.customStrictnessToggles),
        isShared,
        createdById: actorUserId,
      },
    });

    return { id: preset.id };
  }

  async listNamedPresets(subscriptionId: string): Promise<any[]> {
    return this.prisma.namedPreset.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        isShared: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getNamedPreset(id: string, subscriptionId: string): Promise<any> {
    const preset = await this.prisma.namedPreset.findFirst({
      where: { id, subscriptionId },
    });
    if (!preset) {
      throw new NotFoundException(`Named preset "${id}" not found`);
    }
    return preset;
  }

  async applyNamedPreset(
    id: string,
    subscriptionId: string,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const preset = await this.prisma.namedPreset.findFirst({
      where: { id, subscriptionId },
    });
    if (!preset) {
      throw new NotFoundException(`Named preset "${id}" not found`);
    }

    const config = await this.getRawOrThrow(subscriptionId);
    const newVersion = config.configVersion + 1;
    const now = new Date();

    const updated = await this.prisma.tenantConfig.update({
      where: { id: config.id },
      data: {
        activePresetCode: null,
        strictness: this.json(preset.strictness),
        fiscal: this.json(preset.fiscal),
        workflow: this.json(preset.workflow),
        purchases: this.json(preset.purchases),
        customCompanyFields: this.jsonArray(preset.customCompanyFields),
        customStrictnessToggles: this.jsonArray(preset.customStrictnessToggles),
        configVersion: newVersion,
        lastModifiedById: actorUserId,
        lastModifiedAt: now,
      },
    });

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: config.id,
        configVersion: newVersion,
        changeType: 'NAMED_PRESET_APPLIED',
        fieldPath: null,
        beforeValue: Prisma.JsonNull,
        afterValue: this.json({ namedPresetId: id, name: preset.name }),
        actorUserId,
        createdAt: now,
      },
    });

    return this.toEntity(updated);
  }

  async deleteNamedPreset(id: string, subscriptionId: string): Promise<void> {
    const preset = await this.prisma.namedPreset.findFirst({
      where: { id, subscriptionId },
    });
    if (!preset) {
      throw new NotFoundException(`Named preset "${id}" not found`);
    }
    await this.prisma.namedPreset.delete({ where: { id } });
  }

  async updateNamedPreset(
    id: string,
    subscriptionId: string,
    data: { name?: string; description?: string; isShared?: boolean },
  ): Promise<any> {
    const preset = await this.prisma.namedPreset.findFirst({
      where: { id, subscriptionId },
    });
    if (!preset) {
      throw new NotFoundException(`Named preset "${id}" not found`);
    }

    return this.prisma.namedPreset.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isShared !== undefined && { isShared: data.isShared }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        isShared: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // -- Admin helpers -------------------------------------------------------

  async getRawForAdmin(subscriptionId: string): Promise<any> {
    const raw = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!raw) {
      throw new NotFoundException(
        `Tenant configuration not found for subscription "${subscriptionId}".`,
      );
    }
    return this.toEntity(raw);
  }

  async forceUpdateRaw(
    subscriptionId: string,
    data: Record<string, unknown>,
    actorUserId: string,
  ): Promise<any> {
    const config = await this.getRawOrThrow(subscriptionId);
    const newVersion = config.configVersion + 1;

    const updateData: Record<string, unknown> = { ...data };
    updateData.configVersion = newVersion;
    updateData.lastModifiedById = actorUserId;
    updateData.lastModifiedAt = new Date();

    const updated = await this.updateConfigWithVersionGuard(
      config.id,
      config.configVersion,
      updateData,
    );

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: config.id,
        configVersion: newVersion,
        changeType: 'FIELD_UPDATED',
        fieldPath: 'admin_force_update',
        beforeValue: Prisma.JsonNull,
        afterValue: this.json({ updatedFields: Object.keys(data) }),
        actorUserId,
      },
    });

    return this.toEntity(updated);
  }

  /**
   * Create a default config and immediately apply the partial update on top.
   * Called when PUT /tenant-config is invoked before any config exists.
   */
  private async createDefaultAndUpdate(
    subscriptionId: string,
    dto: {
      strictness?: Partial<StrictnessConfig>;
      fiscal?: Partial<FiscalConfig>;
      workflow?: Partial<WorkflowConfig>;
      purchases?: Partial<PurchasesConfig>;
      expectedConfigVersion: number;
    },
    actorUserId: string,
  ): Promise<TenantConfig> {
    // Create default config first
    const defaults = await this.createDefault(subscriptionId, actorUserId);

    // Apply partial update on top, ignoring expectedConfigVersion mismatch
    // since the newly-created config already has version 1.
    // Deep-merge individual fields — dto sections may be partial objects
    // containing only the fields the user changed.
    const mergedStrictness: StrictnessConfig = dto.strictness
      ? { ...(defaults.strictness as StrictnessConfig), ...dto.strictness }
      : (defaults.strictness as StrictnessConfig);
    const mergedFiscal: FiscalConfig = dto.fiscal
      ? { ...(defaults.fiscal as FiscalConfig), ...dto.fiscal }
      : (defaults.fiscal as FiscalConfig);
    const mergedWorkflow: WorkflowConfig = dto.workflow
      ? this.withDeliveryDefaults({ ...(defaults.workflow as WorkflowConfig), ...dto.workflow })
      : this.withDeliveryDefaults(defaults.workflow as WorkflowConfig);
    const mergedPurchases: PurchasesConfig = dto.purchases
      ? { ...(defaults.purchases as PurchasesConfig), ...dto.purchases }
      : (defaults.purchases as PurchasesConfig);

    // Auto-adjust defaultTaxRate when taxRegime changes — Colombian fiscal rule.
    if (dto.fiscal?.taxRegime) {
      const regimeDefaultRates: Record<string, number | undefined> = {
        NO_RESPONSABLE: 0,
        EXENTO: 0,
        RESPONSABLE_IVA: 0.19,
      };
      const rate = regimeDefaultRates[dto.fiscal.taxRegime];
      if (rate !== undefined) {
        mergedFiscal.defaultTaxRate = rate;
      }
    }

    // Validate strictness and workflow (preset defaults are always valid,
    // cross-field rules like clientRequired + threshold need checking).
    // Skip fiscal validation entirely during the initial creation — the
    // admin hasn't filled in company details yet and may save them field
    // by field through sequential auto-save calls. Fiscal will be fully
    // validated on subsequent updates via the normal update() path.
    const validationInput: Parameters<typeof this.validationService.validate>[0] = {};
    if (dto.strictness) validationInput.strictness = mergedStrictness;
    // Fiscal intentionally omitted during first-creation path
    if (dto.workflow) validationInput.workflow = mergedWorkflow;
    if (dto.purchases) validationInput.purchases = mergedPurchases;

    const validationErrors = this.validationService.validate(validationInput);
    if (validationErrors.length > 0) {
      throw new ConfigValidationException(validationErrors);
    }

    const now = new Date();
    const newVersion = defaults.configVersion + 1;

    const updateData: Record<string, unknown> = {
      configVersion: newVersion,
      lastModifiedById: actorUserId,
      lastModifiedAt: now,
    };

    const changes: Array<{
      fieldPath: string;
      beforeValue: unknown;
      afterValue: unknown;
    }> = [];

    if (dto.strictness) {
      if (!this.deepEqual(defaults.strictness, mergedStrictness)) {
        changes.push({
          fieldPath: 'strictness',
          beforeValue: defaults.strictness,
          afterValue: mergedStrictness,
        });
      }
      updateData.strictness = this.json(mergedStrictness);
    }
    if (dto.fiscal) {
      if (!this.deepEqual(defaults.fiscal, mergedFiscal)) {
        changes.push({
          fieldPath: 'fiscal',
          beforeValue: defaults.fiscal,
          afterValue: mergedFiscal,
        });
      }
      updateData.fiscal = this.json(mergedFiscal);
    }
    if (dto.workflow) {
      if (!this.deepEqual(defaults.workflow, mergedWorkflow)) {
        changes.push({
          fieldPath: 'workflow',
          beforeValue: defaults.workflow,
          afterValue: mergedWorkflow,
        });
      }
      updateData.workflow = this.json(mergedWorkflow);
    }
    if (dto.purchases) {
      if (!this.deepEqual(defaults.purchases, mergedPurchases)) {
        changes.push({
          fieldPath: 'purchases',
          beforeValue: defaults.purchases,
          afterValue: mergedPurchases,
        });
      }
      updateData.purchases = this.json(mergedPurchases);
    }

    // Only persist if there are changes beyond the defaults
    if (Object.keys(updateData).length > 3) {
      const raw = await this.prisma.tenantConfig.findUnique({
        where: { subscriptionId },
      });
      if (raw) {
        const updated = await this.updateConfigWithVersionGuard(
          raw.id,
          raw.configVersion,
          updateData,
        );

        if (changes.length > 0) {
          for (const c of changes) {
            await this.prisma.configChangelog.create({
              data: {
                id: this.genId(),
                tenantConfigId: raw.id,
                configVersion: newVersion,
                changeType: 'FIELD_UPDATED',
                fieldPath: c.fieldPath,
                beforeValue: this.json(c.beforeValue),
                afterValue: this.json(c.afterValue),
                actorUserId,
                createdAt: now,
              },
            });
          }
        }

        return this.toEntity(updated);
      }
    }

    return defaults;
  }

  /**
   * Assert that a MANAGER role is not attempting to modify system-level
   * fiscal or strictness fields. Throws ForbiddenException if detected.
   */
  private assertNoSystemFieldChanges(
    currentStrictness: StrictnessConfig,
    newStrictness: StrictnessConfig,
    currentFiscal: FiscalConfig,
    newFiscal: FiscalConfig,
  ): void {
    // MANAGER cannot touch fiscal at all
    const fiscalChanged = !this.deepEqual(currentFiscal, newFiscal);
    if (fiscalChanged) {
      throw new ForbiddenException(
        'MANAGER role cannot modify fiscal settings. Only OWNER can change tax, ' +
        'company, and DIAN configuration.',
      );
    }

    // Check system-level strictness fields
    for (const key of this.SYSTEM_STRICTNESS_KEYS) {
      const currentVal = (currentStrictness as unknown as Record<string, unknown>)[key];
      const newVal = (newStrictness as unknown as Record<string, unknown>)[key];
      if (currentVal !== undefined && !this.deepEqual(currentVal, newVal)) {
        throw new ForbiddenException(
          `MANAGER role cannot modify system-level strictness field "${key}". ` +
          'Only OWNER can change compliance and regulatory settings.',
        );
      }
    }
  }

  // -- Private helpers -----------------------------------------------------

  private async getRawOrThrow(subscriptionId: string): Promise<any> {
    const config = await this.prisma.tenantConfig.findUnique({
      where: { subscriptionId },
    });
    if (!config) {
      throw new NotFoundException(
        `Tenant configuration not found for subscription "${subscriptionId}".`,
      );
    }
    return config;
  }

  /**
   * Compare-and-swap version guard for JSONB config writes.
   *
   * The read-modify-write of a config section only persists if the row still
   * carries the version the caller read; otherwise a concurrent write won and
   * the caller must retry with fresh data (ConfigVersionConflictException).
   * Without the guard, two concurrent auto-saves could both pass the version
   * check and the second would silently overwrite the first's section
   * (lost update on the JSONB merge).
   */
  private async updateConfigWithVersionGuard(
    id: string,
    expectedConfigVersion: number,
    data: Record<string, unknown>,
  ): Promise<any> {
    const result = await this.prisma.tenantConfig.updateMany({
      where: { id, configVersion: expectedConfigVersion },
      data: data as any,
    });
    if (result.count === 0) {
      throw new ConfigVersionConflictException(expectedConfigVersion);
    }
    return this.prisma.tenantConfig.findUnique({ where: { id } });
  }

  private async updateCustomArray(
    config: any,
    fieldName: 'customCompanyFields' | 'customStrictnessToggles',
    newArray: unknown[],
    changeType: string,
    itemId: string | null,
    beforeItem: unknown | null,
    actorUserId: string,
  ): Promise<TenantConfig> {
    const newVersion = config.configVersion + 1;
    const now = new Date();

    const updated = await this.updateConfigWithVersionGuard(
      config.id,
      config.configVersion,
      {
        [fieldName]: this.json(newArray),
        configVersion: newVersion,
        lastModifiedById: actorUserId,
        lastModifiedAt: now,
      },
    );

    await this.prisma.configChangelog.create({
      data: {
        id: this.genId(),
        tenantConfigId: config.id,
        configVersion: newVersion,
        changeType,
        fieldPath: fieldName,
        beforeValue: beforeItem ? this.json(beforeItem) : Prisma.JsonNull,
        afterValue: itemId ? this.json({ id: itemId }) : Prisma.JsonNull,
        actorUserId,
        createdAt: now,
      },
    });

    return this.toEntity(updated);
  }

  private toEntity(raw: any): TenantConfig {
    const fiscal = raw.fiscal as FiscalConfig;
    const safeFiscal: FiscalConfig = { ...fiscal, dianTechnicalKey: '' };

    return {
      id: raw.id,
      subscriptionId: raw.subscriptionId,
      activePresetCode: raw.activePresetCode ?? null,
      strictness: raw.strictness as StrictnessConfig,
      fiscal: safeFiscal,
      workflow: this.withDeliveryDefaults(raw.workflow as WorkflowConfig),
      purchases: raw.purchases as PurchasesConfig,
      customCompanyFields: (raw.customCompanyFields ?? []) as CustomCompanyField[],
      customStrictnessToggles: (raw.customStrictnessToggles ?? []) as CustomStrictnessToggle[],
      configVersion: raw.configVersion,
      lastModifiedByUserId: raw.lastModifiedById ?? '',
      lastModifiedAt:
        raw.lastModifiedAt instanceof Date
          ? raw.lastModifiedAt.toISOString()
          : String(raw.lastModifiedAt),
      createdAt:
        raw.createdAt instanceof Date
          ? raw.createdAt.toISOString()
          : String(raw.createdAt),
    };
  }

  private isEmptyFiscal(f: Partial<FiscalConfig>): boolean {
    return (
      !f.companyName &&
      !f.nit &&
      !f.address &&
      !f.city &&
      !f.phone &&
      !f.email &&
      !f.dianResolutionNumber &&
      !f.dianResolutionDate &&
      !f.dianResolutionPrefix
    );
  }

  /**
   * Returns true when all 9 required fiscal fields are non-empty.
   * Used by the normal update() path to decide whether to validate
   * fiscal: once fully configured, all subsequent updates validate
   * fiscal alongside other sections. During setup (partially filled)
   * other sections can be saved without being blocked by incomplete
   * fiscal data.
   */
  private isFiscalFullyConfigured(f: Partial<FiscalConfig>): boolean {
    return !!(
      f.companyName &&
      f.nit &&
      f.address &&
      f.city &&
      f.phone &&
      f.email &&
      f.dianResolutionNumber &&
      f.dianResolutionDate &&
      f.dianResolutionPrefix
    );
  }

  /**
   * Fill the delivery section of a workflow with defaults so legacy stored
   * configs written before the delivery feature never surface
   * `workflow.delivery === undefined` to the POS or backoffice. Stored
   * values win over defaults; only missing keys are filled.
   */
  private withDeliveryDefaults(workflow: WorkflowConfig): WorkflowConfig {
    return {
      ...workflow,
      delivery: { ...DEFAULT_DELIVERY, ...(workflow.delivery ?? {}) },
    };
  }

  private emptyPurchasesConfig(): PurchasesConfig {
    return {
      autoConfirmOnCreate: false,
      requireManagerPinForConfirm: true,
      requireManagerPinForAnnul: true,
      requireLotOnReception: false,
      requireExpiryOnReception: false,
      allowOverReception: false,
      defaultPaymentTermsDays: 30,
      maxItemsPerOrder: 500,
    };
  }

  private emptyFiscalConfig(): FiscalConfig {
    return {
      companyName: '',
      nit: '',
      address: '',
      city: '',
      phone: '',
      email: '',
      logoPath: null,
      taxRegime: 'RESPONSABLE_IVA',
      defaultTaxRate: 19,
      additionalTaxes: [],
      invoiceHeader: '',
      invoiceFooter: '',
      dianResolutionNumber: '',
      dianResolutionDate: '',
      dianResolutionPrefix: '',
      dianTechnicalKey: '',
      invoiceNumberFormat: '',
      showLogoOnReceipt: false,
      showQrOnReceipt: false,
      qrContent: 'INVOICE_URL',
      qrCustomContent: null,
    };
  }

  /** Serialize a value to a Prisma-compatible JSON representation. */
  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value));
  }

  /** Serialize an array to a Prisma-compatible JSON array. */
  private jsonArray(value: unknown): Prisma.InputJsonValue[] {
    const arr = Array.isArray(value) ? value : [];
    return JSON.parse(JSON.stringify(arr));
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private genId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return `tc_${ts}_${rand}`;
  }
}
