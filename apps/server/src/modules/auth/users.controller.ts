import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { RoleType } from '@pharmacy/shared-types';
import {
  SessionRevocationReason,
  UserStatus,
  AuthMethod,
} from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import * as crypto from 'node:crypto';
import { PinService } from './services/pin.service';
import { PasswordHasherService } from './services/password-hasher.service';
import { SessionService } from './services/session.service';
import { AuditService, AuditEvent } from './services/audit.service';
import { AuthService } from './auth.service';
import {
  CreateUserSchema,
  CreateUserDto,
  UpdateUserSchema,
  UpdateUserDto,
} from './dto/create-user.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pinService: PinService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiOperation({ summary: 'List users in the accessible scope' })
  async listUsers(
    @CurrentUser() user: User,
    @Query('role') roleFilter?: string,
    @Query('status') statusFilter?: string,
    @Query('locationId') locationId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<{ users: unknown[]; total: number }> {
    const where: Record<string, unknown> = {};

    if (roleFilter) where.role = roleFilter;
    if (statusFilter) where.status = statusFilter;

    // Managers: restrict to their accessible locations
    if (user.role === RoleType.MANAGER) {
      const locationAccess = await this.prisma.userLocationAccess.findMany({
        where: { userId: user.id },
        select: { locationId: true },
      });
      const locationIds = locationAccess.map((l) => l.locationId);

      where.OR = [
        { locationAccess: { some: { locationId: { in: locationIds } } } },
        { createdById: user.id },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          displayName: true,
          fullName: true,
          email: true,
          username: true,
          role: true,
          status: true,
          isActive: true,
          avatarUrl: true,
          avatarColor: true,
          authMethod: true,
          totpEnabled: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          createdAt: true,
          createdById: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 50,
        skip: offset ?? 0,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total };
  }

  @Post()
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiOperation({ summary: 'Create a new user (cashier or manager)' })
  async createUser(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
  ): Promise<{
    id: string;
    displayName: string;
    username: string;
    role: string;
    initialPin?: string | null;
    mustChangePassword: boolean;
  }> {
    // Managers can only create cashiers
    if (user.role === RoleType.MANAGER && dto.role === 'MANAGER') {
      throw new ForbiddenException('Managers cannot create other managers');
    }

    let pinHash: string | null = null;
    if (dto.initialPin) {
      pinHash = await this.pinService.hash(dto.initialPin);
    } else if (dto.role === 'CASHIER') {
      const generatedPin = this.pinService.generate();
      pinHash = await this.pinService.hash(generatedPin);
    }

    let passwordHash: string | null = null;
    let passwordAlgorithm: string | null = null;
    if (dto.initialPassword) {
      const result = await this.passwordHasher.hash(dto.initialPassword);
      passwordHash = result.hash;
      passwordAlgorithm = result.algorithm;
    }

    const username =
      dto.username ??
      dto.email?.split('@')[0] ??
      `user-${crypto.randomBytes(4).toString('hex')}`;

    const generatedPinForResponse =
      dto.role === 'CASHIER' && !dto.initialPin
        ? null
        : dto.initialPin ?? null;

    const newUser = await this.prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        displayName: dto.displayName,
        fullName: dto.displayName,
        username,
        email: dto.email ?? null,
        role: dto.role,
        authMethod:
          dto.role === 'CASHIER' ? AuthMethod.PIN_ONLY : AuthMethod.PASSWORD_ONLY,
        pinHash,
        passwordHash,
        passwordAlgorithm,
        status: UserStatus.ACTIVE,
        isActive: true,
        mustChangePassword: true,
        createdById: user.id,
        subscriptionId: user.subscriptionId ?? null,
      },
    });

    if (dto.locationIds && dto.locationIds.length > 0) {
      await this.prisma.userLocationAccess.createMany({
        data: dto.locationIds.map((locationId) => ({
          id: crypto.randomUUID(),
          userId: newUser.id,
          locationId,
        })),
      });
    }

    await this.auditService.log(AuditEvent.USER_CREATED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: newUser.id,
      details: { role: dto.role, username },
    });

    return {
      id: newUser.id,
      displayName: newUser.displayName ?? newUser.fullName,
      username: newUser.username ?? '',
      role: newUser.role,
      initialPin: generatedPinForResponse,
      mustChangePassword: true,
    };
  }

  @Get(':id')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiOperation({ summary: 'Get user details' })
  async getUser(@CurrentUser() user: User, @Param('id') id: string) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        fullName: true,
        email: true,
        username: true,
        role: true,
        status: true,
        isActive: true,
        authMethod: true,
        totpEnabled: true,
        avatarUrl: true,
        avatarColor: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        lastPasswordChangeAt: true,
        mustChangePassword: true,
        createdAt: true,
        createdById: true,
        locationAccess: {
          select: { locationId: true },
        },
      },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    return targetUser;
  }

  @Patch(':id')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiOperation({ summary: 'Update user details' })
  async updateUser(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
  ): Promise<{ id: string } & Record<string, unknown>> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Managers can only update cashiers
    if (user.role === RoleType.MANAGER && targetUser.role !== 'CASHIER') {
      throw new ForbiddenException('Managers can only update cashiers');
    }

    const updateData: Record<string, unknown> = {};
    const changes: string[] = [];

    if (dto.displayName !== undefined) {
      updateData.displayName = dto.displayName;
      updateData.fullName = dto.displayName;
      changes.push('displayName');
    }

    if (dto.role !== undefined) {
      updateData.role = dto.role;
      changes.push(`role: ${targetUser.role} → ${dto.role}`);
    }

    if (dto.isActive !== undefined) {
      updateData.isActive = dto.isActive;
      updateData.status = dto.isActive ? UserStatus.ACTIVE : UserStatus.DISABLED;
      changes.push(`isActive: ${dto.isActive}`);

      if (!dto.isActive) {
        await this.sessionService.revokeUserSessions(
          id,
          SessionRevocationReason.USER_DEACTIVATION,
          user.id,
        );
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    if (dto.locationIds !== undefined) {
      await this.prisma.userLocationAccess.deleteMany({
        where: { userId: id },
      });

      if (dto.locationIds.length > 0) {
        await this.prisma.userLocationAccess.createMany({
          data: dto.locationIds.map((locationId) => ({
            id: crypto.randomUUID(),
            userId: id,
            locationId,
          })),
        });
      }
    }

    await this.auditService.log(AuditEvent.USER_UPDATED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: id,
      details: { changes },
    });

    return { id: updatedUser.id, ...updateData };
  }

  @Post(':id/disable')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable a user' })
  async disableUser(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false, status: UserStatus.DISABLED },
    });

    await this.sessionService.revokeUserSessions(
      id,
      SessionRevocationReason.USER_DEACTIVATION,
      user.id,
    );

    await this.auditService.log(AuditEvent.USER_DISABLED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: id,
    });

    return { message: 'User disabled' };
  }

  @Post(':id/enable')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable a disabled user' })
  async enableUser(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        isActive: true,
        status: UserStatus.ACTIVE,
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });

    await this.auditService.log(AuditEvent.USER_ENABLED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: id,
    });

    return { message: 'User enabled' };
  }

  @Post(':id/unlock')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unlock a locked account' })
  async unlockUser(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        lockedUntil: null,
        failedLoginAttempts: 0,
        status: UserStatus.ACTIVE,
      },
    });

    await this.auditService.log(AuditEvent.USER_UNLOCKED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: id,
    });

    return { message: 'Account unlocked' };
  }

  @Post(':id/reset-pin')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset a user\'s PIN (manager/owner only)' })
  async resetPin(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{ newPin: string; message: string }> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const newPin = this.pinService.generate();
    const pinHash = await this.pinService.hash(newPin);

    await this.prisma.user.update({
      where: { id },
      data: { pinHash, mustChangePassword: true },
    });

    await this.sessionService.revokeUserSessions(
      id,
      SessionRevocationReason.PASSWORD_CHANGED,
      user.id,
    );

    await this.auditService.log(AuditEvent.PIN_RESET, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'User',
      targetId: id,
    });

    return { newPin, message: 'PIN has been reset. Share the new PIN with the user.' };
  }

  @Post(':id/reset-password')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a password reset link to the user\'s email' })
  async resetPassword(
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const targetUser = await this.prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    if (!targetUser.email) {
      throw new BadRequestException('User does not have an email address');
    }

    await this.authService.forgotPassword(targetUser.email);

    return { message: 'Password reset link sent to the user\'s email' };
  }

  @Get(':id/sessions')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @ApiOperation({ summary: 'List a user\'s active sessions' })
  async listUserSessions(@Param('id') id: string) {
    return this.sessionService.findActiveSessionsByUser(id);
  }

  @Post(':userId/sessions/:sessionId/revoke')
  @Roles(RoleType.OWNER, RoleType.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session for a user' })
  async revokeUserSession(
    @CurrentUser() user: User,
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<{ message: string }> {
    const session = await this.sessionService.findSessionById(sessionId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found');
    }

    await this.sessionService.revokeSession(
      sessionId,
      SessionRevocationReason.ADMIN_REVOCATION,
      user.id,
    );

    await this.auditService.log(AuditEvent.SESSION_REVOKED, {
      actorId: user.id,
      actorRole: user.role,
      targetType: 'UserSession',
      targetId: sessionId,
      details: { revokedUserId: userId },
    });

    return { message: 'Session revoked' };
  }
}
