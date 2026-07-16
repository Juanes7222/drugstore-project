/**
 * Blessing controller — validates offline sessions when the workstation reconnects.
 *
 * POST /auth/offline-sessions/bless
 * GET  /auth/offline-tokens/revocation-list
 */
import { Controller, Post, Get, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BlessingService } from './blessing.service';
import { RevocationListService } from './revocation-list.service';
import { BlessingRequestDto, BlessingRequestSchema, BlessingResponseDto } from './dto/blessing.dto';
import { RevocationListQueryDto, RevocationListQuerySchema, RevocationListResponseDto } from './dto/revocation-list.dto';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PermissionGuard, Permission } from '../guards/permission.guard';
import { User } from '@pharmacy/shared-types';

@ApiTags('auth-offline')
@Controller('auth')
export class BlessingController {
  constructor(
    private readonly blessingService: BlessingService,
    private readonly revocationListService: RevocationListService,
  ) {}

  @Post('offline-sessions/bless')
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permission('MANAGER' as any)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute
  @ApiOperation({ summary: 'Bless pending offline sessions when workstation reconnects' })
  async blessSessions(
    @Body(new ZodValidationPipe(BlessingRequestSchema)) dto: BlessingRequestDto,
    @CurrentUser() user: User,
  ): Promise<{ results: Array<{ localSessionId: string; status: string; reason?: string; replacementToken?: any }> }> {
    // The workstation fingerprint is extracted from the blessing request entries
    // The first entry's fingerprint is used for validation consistency
    const primaryFingerprint =
      dto.pendingSessions[0]?.workstationFingerprint ?? '';

    const response = await this.blessingService.blessSessions(
      dto.pendingSessions,
      primaryFingerprint,
    );

    return {
      results: response.results.map((r) => ({
        ...r,
        replacementToken: r.replacementToken
          ? {
              ...r.replacementToken,
              expiresAt: r.replacementToken.expiresAt.toISOString(),
            }
          : undefined,
      })),
    };
  }

  @Get('offline-tokens/revocation-list')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get revoked offline tokens list (supports delta fetch)' })
  async getRevocationList(
    @Query(new ZodValidationPipe(RevocationListQuerySchema)) query: RevocationListQueryDto,
  ): Promise<RevocationListResponseDto> {
    const result = await this.revocationListService.getList({
      since: query.since,
      limit: query.limit,
      offset: query.offset,
    });

    const response = new RevocationListResponseDto();
    response.entries = result.entries.map((e) => ({
      jti: e.jti,
      revokedAt: e.revokedAt.toISOString(),
      reason: e.reason,
    }));
    response.total = result.total;
    return response;
  }
}
