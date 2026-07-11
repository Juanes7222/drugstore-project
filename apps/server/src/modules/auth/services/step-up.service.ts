import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RoleType, StepUpStatus, SessionStatus } from '@pharmacy/database';
import type { StepUpRequest as StepUpRequestModel } from '@pharmacy/database';
import { EnvConfig } from '@/config/env.schema';
import * as crypto from 'node:crypto';

const STEP_UP_TTL_SECONDS = 300; // 5 minutes
const ONE_TIME_CODE_LENGTH = 6;

/**
 * Step-up authorization service.
 *
 * Operations that require elevated privileges declare an authRequirement.
 * This service manages the lifecycle of step-up requests:
 *
 * 1. A user requests authorization for an operation
 * 2. A user with the required role approves via PIN, remote, or one-time code
 * 3. The original operation proceeds with the approval token
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig>,
  ) {}

  /**
   * Create a step-up authorization request.
   */
  async requestStepUp(params: {
    operationType: string;
    operationId?: string;
    requestingUserId: string;
    workstationId: string;
    requiredRole: RoleType;
    method?: 'PIN' | 'REMOTE' | 'CODE';
  }): Promise<{
    id: string;
    status: string;
    expiresAt: Date;
    oneTimeCode?: string;
  }> {
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000);

    const request = await this.prisma.stepUpRequest.create({
      data: {
        id: crypto.randomUUID(),
        operationType: params.operationType,
        operationId: params.operationId ?? null,
        requestingUserId: params.requestingUserId,
        workstationId: params.workstationId,
        requiredRole: params.requiredRole,
        status: StepUpStatus.PENDING,
        method: params.method ?? 'PIN',
        oneTimeCode:
          params.method === 'CODE' ? this.generateOneTimeCode() : null,
        expiresAt,
      },
    });

    return {
      id: request.id,
      status: request.status,
      expiresAt: request.expiresAt,
      oneTimeCode: request.oneTimeCode ?? undefined,
    };
  }

  /**
   * Approve a step-up request.
   */
  async approveStepUp(
    requestId: string,
    approverUserId: string,
    method: 'PIN' | 'REMOTE' | 'CODE',
  ): Promise<{ approvalToken: string }> {
    const request = await this.prisma.stepUpRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Step-up request not found');
    }

    if (request.status !== StepUpStatus.PENDING) {
      throw new ConflictException(
        request.status === StepUpStatus.APPROVED
          ? 'Ya fue aprobado por otro usuario'
          : 'Step-up request is no longer pending',
      );
    }

    if (new Date() > request.expiresAt) {
      await this.prisma.stepUpRequest.update({
        where: { id: requestId },
        data: { status: StepUpStatus.EXPIRED },
      });
      throw new ForbiddenException('La solicitud expiró. Pedí una nueva.');
    }

    const approvalToken = crypto.randomUUID();
    const approvalTokenHash = crypto
      .createHash('sha256')
      .update(approvalToken)
      .digest('hex');

    await this.prisma.stepUpRequest.update({
      where: { id: requestId },
      data: {
        status: StepUpStatus.APPROVED,
        approvedByUserId: approverUserId,
        method,
        approvalToken: approvalTokenHash,
        approvedAt: new Date(),
      },
    });

    return { approvalToken };
  }

  /**
   * Deny a step-up request.
   */
  async denyStepUp(
    requestId: string,
    denierUserId: string,
    reason?: string,
  ): Promise<void> {
    const request = await this.prisma.stepUpRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Step-up request not found');
    }

    if (request.status !== StepUpStatus.PENDING) {
      throw new ConflictException('Step-up request is no longer pending');
    }

    await this.prisma.stepUpRequest.update({
      where: { id: requestId },
      data: {
        status: StepUpStatus.DENIED,
        deniedByUserId: denierUserId,
        denialReason: reason ?? null,
      },
    });
  }

  /**
   * Verify an approval token for an operation.
   */
  async verifyApproval(
    approvalToken: string,
    operationType?: string,
  ): Promise<boolean> {
    const tokenHash = crypto
      .createHash('sha256')
      .update(approvalToken)
      .digest('hex');

    const request = await this.prisma.stepUpRequest.findFirst({
      where: {
        approvalToken: tokenHash,
        status: StepUpStatus.APPROVED,
      },
    });

    if (!request) {
      return false;
    }

    if (new Date() > request.expiresAt) {
      await this.prisma.stepUpRequest.update({
        where: { id: request.id },
        data: { status: StepUpStatus.EXPIRED },
      });
      return false;
    }

    if (operationType && request.operationType !== operationType) {
      return false;
    }

    return true;
  }

  /**
   * Find pending step-up requests for a given workstation.
   */
  async findPendingForWorkstation(workstationId: string) {
    return this.prisma.stepUpRequest.findMany({
      where: {
        workstationId,
        status: StepUpStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        requestingUser: {
          select: { id: true, displayName: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find pending step-up requests visible to any manager (for async approval).
   */
  async findPendingForManager() {
    return this.prisma.stepUpRequest.findMany({
      where: {
        status: StepUpStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: {
        requestingUser: {
          select: { id: true, displayName: true, fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Expire all stale pending requests.
   */
  async expireStaleRequests(): Promise<number> {
    const result = await this.prisma.stepUpRequest.updateMany({
      where: {
        status: StepUpStatus.PENDING,
        expiresAt: { lte: new Date() },
      },
      data: { status: StepUpStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * List managers/owners currently logged in on a given workstation.
   */
  async getLoggedInManagersForWorkstation(workstationId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        workstationId,
        status: SessionStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        revokedAt: null,
        user: {
          role: { in: [RoleType.MANAGER, RoleType.OWNER] },
          status: 'ACTIVE',
          isActive: true,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            fullName: true,
            avatarUrl: true,
            avatarColor: true,
          },
        },
      },
      distinct: ['userId'],
    });

    return sessions.map((s) => ({
      userId: s.user.id,
      displayName: s.user.displayName || s.user.fullName,
      avatarUrl: s.user.avatarUrl,
      avatarColor: s.user.avatarColor,
      sessionId: s.id,
    }));
  }

  /**
   * Generate a random numeric one-time code.
   */
  private generateOneTimeCode(): string {
    return Array.from({ length: ONE_TIME_CODE_LENGTH }, () =>
      Math.floor(Math.random() * 10),
    ).join('');
  }
}
