// ---------------------------------------------------------------------------
// WorkstationConfigService — per-workstation configuration overrides stored
// in SystemConfig (key-value) to avoid a separate Prisma model migration.
// Key format: "ws_config:{subscriptionId}:{workstationId}"
// Only non-system fields (workflow + operational strictness) are allowed.
// ---------------------------------------------------------------------------

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SystemModule } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import type {
  WorkstationConfig,
  StrictnessConfig,
  WorkflowConfig,
} from '@pharmacy/shared-types';

// Workstation-level strictness keys — system/fiscal/compliance fields excluded
const WORKSTATION_STRICTNESS_KEYS: ReadonlySet<string> = new Set([
  'inventoryAdjustmentReason',
  'cashShiftRequired',
  'receiptPrintRequired',
  'autoOpenDrawer',
  'customerDisplayRequired',
]);

const WORKSTATION_WORKFLOW_KEYS: ReadonlySet<string> = new Set([
  'defaultPaymentMethodId',
  'autoPrintOnConfirm',
  'autoOpenDrawerOnConfirm',
  'printDuplicateReceipt',
  'requireShiftOpenForSale',
  'sessionIdleTimeoutSeconds',
  'sessionIdleTimeouts',
  'suggestionEngineEnabled',
  'autoReprintLastReceiptOnReprint',
]);

function configKey(subscriptionId: string, workstationId: string): string {
  return `ws_config:${subscriptionId}:${workstationId}`;
}

@Injectable()
export class WorkstationConfigService {
  constructor(private prisma: PrismaService) {}

  // -- Read ----------------------------------------------------------------

  /**
   * Get the workstation config for a specific workstation.
   * Returns null if no overrides are configured.
   */
  async getByWorkstation(
    subscriptionId: string,
    workstationId: string,
  ): Promise<WorkstationConfig | null> {
    const key = configKey(subscriptionId, workstationId);
    const row = await this.prisma.systemConfig.findUnique({
      where: { key },
    });
    if (!row) return null;
    return this.toEntity(row.value as Record<string, unknown>, subscriptionId, workstationId);
  }

  /**
   * List all workstation configs for a subscription by scanning key prefix.
   */
  async listBySubscription(subscriptionId: string): Promise<WorkstationConfig[]> {
    const prefix = `ws_config:${subscriptionId}:`;
    const all = await this.prisma.systemConfig.findMany({
      where: { key: { startsWith: prefix } },
      orderBy: { updatedAt: 'desc' },
    });
    return all.map((r: any) => {
      const wsId = r.key.replace(prefix, '');
      return this.toEntity(r.value as Record<string, unknown>, subscriptionId, wsId);
    });
  }

  // -- Upsert --------------------------------------------------------------

  /**
   * Upsert workstation config overrides.
   * System-level fields (fiscal, tax, compliance strictness) are silently
   * stripped from the input.
   */
  async upsert(
    subscriptionId: string,
    workstationId: string,
    data: {
      workflow?: Partial<WorkflowConfig>;
      strictness?: Partial<StrictnessConfig>;
    },
  ): Promise<WorkstationConfig> {
    const key = configKey(subscriptionId, workstationId);

    // Strip system-level fields from strictness
    const safeStrictness = this.filterSystemStrictness(data.strictness ?? {});
    const safeWorkflow = data.workflow ?? {};

    const value = {
      workflow: safeWorkflow,
      strictness: safeStrictness,
      subscriptionId,
      workstationId,
    };

    // Upsert via SystemConfig
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (existing) {
      await this.prisma.systemConfig.update({
        where: { key },
        data: { value: this.json(value), updatedAt: new Date() },
      });
    } else {
      await this.prisma.systemConfig.create({
        data: {
          key,
          value: this.json(value),
          valueType: 'OBJECT',
          module: SystemModule.CONFIGURATION,
          description: `Workstation-specific config overrides for ${workstationId}`,
          isSensitive: false,
        },
      });
    }

    return this.toEntity(value, subscriptionId, workstationId);
  }

  // -- Delete --------------------------------------------------------------

  /**
   * Remove all workstation config overrides for a given workstation.
   */
  async delete(subscriptionId: string, workstationId: string): Promise<void> {
    const key = configKey(subscriptionId, workstationId);
    const existing = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(
        `Workstation config not found for workstation "${workstationId}".`,
      );
    }
    await this.prisma.systemConfig.delete({ where: { key } });
  }

  // -- Validation helpers --------------------------------------------------

  /**
   * Returns only workstation-allowed strictness keys from the input.
   */
  private filterSystemStrictness(
    strictness: Partial<StrictnessConfig>,
  ): Partial<StrictnessConfig> {
    const filtered: Record<string, unknown> = {};
    for (const key of WORKSTATION_STRICTNESS_KEYS) {
      if ((strictness as Record<string, unknown>)[key] !== undefined) {
        filtered[key] = (strictness as Record<string, unknown>)[key];
      }
    }
    return filtered as unknown as Partial<StrictnessConfig>;
  }

  /**
   * Check if a strictness field is allowed per-workstation.
   */
  isWorkstationStrictnessField(key: string): boolean {
    return WORKSTATION_STRICTNESS_KEYS.has(key);
  }

  /**
   * Check if a workflow field is allowed per-workstation.
   */
  isWorkstationWorkflowField(key: string): boolean {
    return WORKSTATION_WORKFLOW_KEYS.has(key);
  }

  // -- Private helpers -----------------------------------------------------

  private toEntity(
    raw: Record<string, unknown>,
    subscriptionId: string,
    workstationId: string,
  ): WorkstationConfig {
    return {
      id: `${subscriptionId}:${workstationId}`,
      subscriptionId,
      workstationId,
      workflow: ((raw.workflow ?? {}) as unknown) as Partial<WorkflowConfig>,
      strictness: ((raw.strictness ?? {}) as unknown) as Partial<StrictnessConfig>,
      createdAt: (raw.createdAt as string) ?? new Date().toISOString(),
      updatedAt: (raw.updatedAt as string) ?? new Date().toISOString(),
    };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value));
  }
}
