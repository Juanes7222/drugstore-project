import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StepUpService } from './services/step-up.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { User, RoleType } from '@pharmacy/shared-types';
import { z } from 'zod';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

const RequestStepUpSchema = z.object({
  operationType: z.string().min(1),
  operationId: z.string().optional(),
  workstationId: z.string().min(1),
  requiredRole: z.nativeEnum(RoleType),
  method: z.enum(['PIN', 'REMOTE', 'CODE']).optional(),
});

const ApproveStepUpSchema = z.object({
  requestId: z.string().min(1),
  method: z.enum(['PIN', 'REMOTE', 'CODE']),
});

const DenyStepUpSchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().optional(),
});

const VerifyApprovalSchema = z.object({
  approvalToken: z.string().min(1),
  operationType: z.string().optional(),
});

type RequestStepUpInput = z.infer<typeof RequestStepUpSchema>;
type ApproveStepUpInput = z.infer<typeof ApproveStepUpSchema>;
type DenyStepUpInput = z.infer<typeof DenyStepUpSchema>;
type VerifyApprovalInput = z.infer<typeof VerifyApprovalSchema>;

@ApiTags('auth/step-up')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/step-up')
export class StepUpController {
  constructor(
    private readonly stepUpService: StepUpService,
    private readonly auditService: AuditService,
  ) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request step-up authorization for a sensitive operation' })
  async requestStepUp(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(RequestStepUpSchema)) body: RequestStepUpInput,
  ) {
    const result = await this.stepUpService.requestStepUp({
      operationType: body.operationType,
      operationId: body.operationId,
      requestingUserId: user.id,
      workstationId: body.workstationId,
      requiredRole: body.requiredRole,
      method: body.method,
    });

    await this.auditService.log(AuditEvent.STEP_UP_REQUESTED, {
      actorId: user.id,
      actorRole: user.role,
      workstationId: body.workstationId,
      details: {
        operationType: body.operationType,
        requestId: result.id,
      },
    });

    return result;
  }

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a step-up request' })
  async approveStepUp(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(ApproveStepUpSchema)) body: ApproveStepUpInput,
  ) {
    const result = await this.stepUpService.approveStepUp(
      body.requestId,
      user.id,
      body.method,
    );

    await this.auditService.log(AuditEvent.STEP_UP_AUTHORIZED, {
      actorId: user.id,
      actorRole: user.role,
      details: { requestId: body.requestId, method: body.method },
    });

    return { approvalToken: result.approvalToken, message: 'Step-up request approved' };
  }

  @Post('deny')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deny a step-up request' })
  async denyStepUp(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(DenyStepUpSchema)) body: DenyStepUpInput,
  ) {
    await this.stepUpService.denyStepUp(body.requestId, user.id, body.reason);

    await this.auditService.log(AuditEvent.STEP_UP_DENIED, {
      actorId: user.id,
      actorRole: user.role,
      details: { requestId: body.requestId, reason: body.reason },
    });

    return { message: 'Step-up request denied' };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an approval token' })
  async verifyApproval(
    @Body(new ZodValidationPipe(VerifyApprovalSchema)) body: VerifyApprovalInput,
  ): Promise<{ valid: boolean }> {
    const valid = await this.stepUpService.verifyApproval(
      body.approvalToken,
      body.operationType,
    );
    return { valid };
  }

  @Get('pending')
  @ApiOperation({ summary: 'List pending step-up requests' })
  async findPendingForWorkstation() {
    return this.stepUpService.findPendingForManager();
  }

  @Get('pending/:workstationId')
  @ApiOperation({ summary: 'List pending step-up requests for a specific workstation' })
  async findPendingByWorkstation(@Param('workstationId') workstationId: string) {
    return this.stepUpService.findPendingForWorkstation(workstationId);
  }

  @Get('managers/:workstationId')
  @ApiOperation({ summary: 'List logged-in managers for remote approval' })
  async listManagers(@Param('workstationId') workstationId: string) {
    return this.stepUpService.getLoggedInManagersForWorkstation(workstationId);
  }
}
