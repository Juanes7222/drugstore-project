import { Injectable, Logger } from '@nestjs/common';
import { VerificationPurpose } from '@pharmacy/database';
import * as crypto from 'node:crypto';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { InvalidVerificationTokenException } from '../exceptions/invalid-verification-token.exception';

/** Raw capability returned to the caller. The hash is what gets persisted. */
export interface IssuedVerificationToken {
  /** Base64url secret embedded in the emailed link. Never stored. */
  rawToken: string;
  /** Row id; doubles as the provider idempotency key for delivery retries. */
  tokenId: string;
  expiresAt: Date;
}

export interface IssueVerificationTokenParams {
  userId: string;
  email: string;
  purpose: VerificationPurpose;
  ttlMs: number;
  /** Minimum gap since the previous token of this purpose. */
  cooldownMs: number;
  requestIp?: string;
}

export interface ConsumedVerificationToken {
  userId: string;
  purpose: VerificationPurpose;
  /** Email the token was issued for; the caller's account must still match. */
  email: string;
}

const TOKEN_ENTROPY_BYTES = 32;

/**
 * Issues and consumes the single-use capabilities behind account verification,
 * password reset and email-change confirmation.
 *
 * Two properties carry the security of the flow:
 *
 *  1. Only the SHA-256 hash of a 256-bit random token is persisted, so reading
 *     the table cannot produce a working link. This is the same discipline as
 *     UserSession.tokenHash.
 *  2. Issuing invalidates any earlier unconsumed token for the same user and
 *     purpose, and consumption is a single conditional update. Only the most
 *     recently emailed link ever works, and a link replayed after the password
 *     it protected has changed is dead.
 *
 * This table carries no row-level security policy, matching User and
 * UserSession: these endpoints are unauthenticated, so no tenant context exists
 * on the request. A row is reachable only by presenting its token.
 */
@Injectable()
export class VerificationTokenService {
  private readonly logger = new Logger(VerificationTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a token and retires the account's previous one for this purpose.
   *
   * Returns null when the cooldown is still in effect. Callers must not
   * distinguish that from a successful issue in their HTTP responses: the
   * endpoint answers identically either way, so the cooldown cannot be used to
   * probe whether an address belongs to a registered account.
   */
  async issue(
    params: IssueVerificationTokenParams,
  ): Promise<IssuedVerificationToken | null> {
    if (
      await this.isCoolingDown(params.userId, params.purpose, params.cooldownMs)
    ) {
      return null;
    }

    const rawToken = crypto
      .randomBytes(TOKEN_ENTROPY_BYTES)
      .toString('base64url');
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + params.ttlMs);

    await this.prisma.$transaction(async (tx) => {
      // Retire the previous link first: two emails outstanding for one account
      // would otherwise leave it ambiguous which one the user meant.
      await tx.verificationToken.updateMany({
        where: {
          userId: params.userId,
          purpose: params.purpose,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      });

      await tx.verificationToken.create({
        data: {
          id,
          userId: params.userId,
          purpose: params.purpose,
          tokenHash: this.hash(rawToken),
          email: params.email,
          requestIp: params.requestIp ?? null,
          expiresAt,
        },
      });
    });

    this.logger.log(
      `Issued ${params.purpose} token for user ${params.userId}, expires ${expiresAt.toISOString()}`,
    );

    return { rawToken, tokenId: id, expiresAt };
  }

  /**
   * Redeems a token for its purpose, marking it used in the same step.
   *
   * The redemption is a conditional update rather than a read-then-write: two
   * simultaneous clicks on the same link would both pass a plain existence
   * check, and only one may succeed.
   */
  async consume(
    rawToken: string,
    expectedPurpose: VerificationPurpose,
  ): Promise<ConsumedVerificationToken> {
    const tokenHash = this.hash(rawToken);

    const claimed = await this.prisma.verificationToken.updateMany({
      where: {
        tokenHash,
        purpose: expectedPurpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new InvalidVerificationTokenException();
    }

    // updateMany does not return the row, so read it back to report which
    // account the capability belonged to. Safe because the conditional update
    // above already proved this exact token was unconsumed and unexpired.
    const token = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      select: { userId: true, purpose: true, email: true },
    });

    if (!token) {
      throw new InvalidVerificationTokenException();
    }

    this.logger.log(`Consumed ${token.purpose} token for user ${token.userId}`);

    return { userId: token.userId, purpose: token.purpose, email: token.email };
  }

  /**
   * Drops tokens that expired long enough ago to be irrelevant. Called on a
   * schedule; the table is otherwise append-only per issuance.
   */
  async purgeExpired(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const { count } = await this.prisma.verificationToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.log(`Purged ${count} expired verification tokens`);
    }
    return count;
  }

  /** True when a token of this purpose was issued inside the cooldown window. */
  private async isCoolingDown(
    userId: string,
    purpose: VerificationPurpose,
    cooldownMs: number,
  ): Promise<boolean> {
    if (cooldownMs <= 0) return false;

    const recent = await this.prisma.verificationToken.findFirst({
      where: {
        userId,
        purpose,
        createdAt: { gt: new Date(Date.now() - cooldownMs) },
      },
      select: { id: true },
    });

    return recent !== null;
  }

  private hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
