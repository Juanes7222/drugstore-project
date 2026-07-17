// ---------------------------------------------------------------------------
// WorkstationConfigController — per-workstation config overrides for
// operational preferences (workflow, non-system strictness).
// MANAGER+ can view, OWNER+ can modify.
// ---------------------------------------------------------------------------

import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import {
  RoleType,
  AuditAction,
  SystemModule,
  User,
  StrictnessConfig,
  WorkflowConfig,
} from '@pharmacy/shared-types';
import { WorkstationConfigService } from '../services/workstation-config.service';
import { z } from 'zod';

// -- Schemas ---

const UpsertWorkstationConfigSchema = z.object({
  workflow: z
    .object({
      defaultPaymentMethodId: z.string().nullable().optional(),
      autoPrintOnConfirm: z.boolean().optional(),
      autoOpenDrawerOnConfirm: z.enum(['ALWAYS', 'CASH_ONLY', 'NEVER']).optional(),
      printDuplicateReceipt: z.boolean().optional(),
      requireShiftOpenForSale: z.boolean().optional(),
      sessionIdleTimeoutSeconds: z.number().int().min(0).optional(),
      sessionIdleTimeouts: z
        .object({
          cashier: z.number().int().min(0),
          manager: z.number().int().min(0),
          owner: z.number().int().min(0),
        })
        .optional(),
      suggestionEngineEnabled: z.boolean().optional(),
      autoReprintLastReceiptOnReprint: z.boolean().optional(),
    })
    .optional(),
  strictness: z
    .object({
      inventoryAdjustmentReason: z.enum(['REQUIRED', 'OPTIONAL']).optional(),
      cashShiftRequired: z.boolean().optional(),
      receiptPrintRequired: z.enum(['STRICT', 'OPTIONAL', 'OFF']).optional(),
      autoOpenDrawer: z.enum(['ALWAYS', 'CASH_ONLY', 'MANUAL']).optional(),
      customerDisplayRequired: z.boolean().optional(),
    })
    .optional(),
});

type UpsertWorkstationConfigInput = z.infer<typeof UpsertWorkstationConfigSchema>;

@Controller('tenant-config/workstation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkstationConfigController {
  constructor(
    private workstationConfigService: WorkstationConfigService,
  ) {}

  /**
   * Get workstation config for a specific workstation.
   */
  @Get(':workstationId')
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async getByWorkstation(
    @Param('workstationId') workstationId: string,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.workstationConfigService.getByWorkstation(
      user.subscriptionId ?? '',
      workstationId,
    );
  }

  /**
   * List all workstation configs for the subscription.
   */
  @Get()
  @Roles(RoleType.MANAGER, RoleType.OWNER)
  async listBySubscription(@CurrentUser() user: User): Promise<unknown> {
    return this.workstationConfigService.listBySubscription(
      user.subscriptionId ?? '',
    );
  }

  /**
   * Upsert workstation config overrides.
   * System-level fields (fiscal, tax, compliance strictness) are silently
   * ignored by the service.
   */
  @Put(':workstationId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CONFIG,
    entityType: 'WorkstationConfig',
  })
  async upsert(
    @Param('workstationId') workstationId: string,
    @Body(new ZodValidationPipe(UpsertWorkstationConfigSchema))
    dto: UpsertWorkstationConfigInput,
    @CurrentUser() user: User,
  ): Promise<unknown> {
    return this.workstationConfigService.upsert(
      user.subscriptionId ?? '',
      workstationId,
      {
        workflow: dto.workflow as Partial<WorkflowConfig> | undefined,
        strictness: dto.strictness as Partial<StrictnessConfig> | undefined,
      },
    );
  }

  /**
   * Remove all workstation config overrides for a workstation.
   */
  @Delete(':workstationId')
  @Roles(RoleType.OWNER)
  @Auditable({
    action: AuditAction.DELETE,
    module: SystemModule.CONFIG,
    entityType: 'WorkstationConfig',
  })
  async delete(
    @Param('workstationId') workstationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.workstationConfigService.delete(
      user.subscriptionId ?? '',
      workstationId,
    );
  }
}
