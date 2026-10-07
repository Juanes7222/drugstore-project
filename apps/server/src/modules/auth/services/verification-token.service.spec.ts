// jest.mock factories are used instead of jest.unstable_mockModule: the
// latter does not register in this Jest/ts-jest ESM setup.
jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper, so
// they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { VerificationPurpose } from '@pharmacy/database';
import * as crypto from 'node:crypto';
import { VerificationTokenService } from './verification-token.service';
import { InvalidVerificationTokenException } from '../exceptions/invalid-verification-token.exception';

const USER_ID = 'user-1';
const EMAIL = 'user@example.com';

function buildIssueParams(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    userId: USER_ID,
    email: EMAIL,
    purpose: VerificationPurpose.EMAIL_VERIFICATION,
    ttlMs: 60_000,
    cooldownMs: 0,
    ...overrides,
  };
}

describe('VerificationTokenService', () => {
  let prisma: MockProxy<PrismaClient>;
  // Distinct mock for the interactive-transaction client so retirement and
  // creation can be asserted as going THROUGH the tx, in order.
  let tx: MockProxy<PrismaClient>;
  let service: VerificationTokenService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    tx = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
    tx.verificationToken.create.mockResolvedValue({} as never);
    tx.verificationToken.updateMany.mockResolvedValue({ count: 0 } as never);
    prisma.verificationToken.findFirst.mockResolvedValue(null as never);
    service = new VerificationTokenService(prisma as unknown as PrismaClient);
  });

  describe('issue', () => {
    it('returns the raw token, the row id and the expiry', async () => {
      const issued = await service.issue(buildIssueParams() as never);

      expect(issued).not.toBeNull();
      expect(typeof issued?.rawToken).toBe('string');
      expect(typeof issued?.tokenId).toBe('string');
      expect(issued?.expiresAt).toBeInstanceOf(Date);
    });

    it('persists only the SHA-256 hash, never the raw token', async () => {
      const issued = await service.issue(buildIssueParams() as never);

      const persisted = tx.verificationToken.create.mock.calls[0][0].data;
      expect(persisted.tokenHash).not.toBe(issued?.rawToken);
      expect(persisted.tokenHash).toBe(
        crypto.createHash('sha256').update(issued!.rawToken).digest('hex'),
      );
    });

    it('produces a 256-bit base64url secret', async () => {
      const issued = await service.issue(buildIssueParams() as never);

      // 32 random bytes encode to 43 base64url characters.
      expect(issued!.rawToken).toHaveLength(43);
      expect(issued!.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('issues a different secret on every call', async () => {
      const first = await service.issue(buildIssueParams() as never);
      const second = await service.issue(buildIssueParams() as never);

      expect(first!.rawToken).not.toBe(second!.rawToken);
      expect(first!.tokenId).not.toBe(second!.tokenId);
    });

    it('stores the email the token was issued for and the requesting IP', async () => {
      await service.issue(
        buildIssueParams({ requestIp: '203.0.113.7' }) as never,
      );

      expect(tx.verificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: EMAIL,
          requestIp: '203.0.113.7',
        }),
      });
    });

    it('stores a null requestIp when none was supplied', async () => {
      await service.issue(buildIssueParams() as never);

      expect(tx.verificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ requestIp: null }),
      });
    });

    it('stores the purpose it was issued under', async () => {
      await service.issue(
        buildIssueParams({ purpose: VerificationPurpose.PASSWORD_RESET }) as never,
      );

      expect(tx.verificationToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          purpose: VerificationPurpose.PASSWORD_RESET,
        }),
      });
    });

    it('sets expiresAt to now plus the requested ttl', async () => {
      const before = Date.now();

      const issued = await service.issue(
        buildIssueParams({ ttlMs: 3_600_000 }) as never,
      );

      expect(issued!.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 3_600_000,
      );
      expect(issued!.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 3_600_000,
      );
    });

    it('retires the previous unconsumed token for the same user and purpose before creating', async () => {
      const order: string[] = [];
      tx.verificationToken.updateMany.mockImplementation(async () => {
        order.push('retire');
        return { count: 1 } as never;
      });
      tx.verificationToken.create.mockImplementation(async () => {
        order.push('create');
        return {} as never;
      });

      await service.issue(buildIssueParams() as never);

      expect(order).toEqual(['retire', 'create']);
    });

    it('retires only unconsumed tokens of the same user and purpose', async () => {
      await service.issue(
        buildIssueParams({ purpose: VerificationPurpose.PASSWORD_RESET }) as never,
      );

      expect(tx.verificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          purpose: VerificationPurpose.PASSWORD_RESET,
          consumedAt: null,
        },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('returns null when a token for the same user and purpose was created inside the cooldown', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'recent-token',
      } as never);

      const issued = await service.issue(
        buildIssueParams({ cooldownMs: 60_000 }) as never,
      );

      expect(issued).toBeNull();
    });

    it('writes nothing at all while the cooldown is active', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'recent-token',
      } as never);

      await service.issue(buildIssueParams({ cooldownMs: 60_000 }) as never);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.verificationToken.create).not.toHaveBeenCalled();
    });

    it('checks the cooldown window against createdAt', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 'recent-token',
      } as never);

      await service.issue(buildIssueParams({ cooldownMs: 60_000 }) as never);

      expect(prisma.verificationToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          purpose: VerificationPurpose.EMAIL_VERIFICATION,
          createdAt: { gt: expect.any(Date) },
        },
        select: { id: true },
      });
    });

    it('issues normally when the most recent token predates the cooldown window', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue(null as never);

      const issued = await service.issue(
        buildIssueParams({ cooldownMs: 60_000 }) as never,
      );

      expect(issued).not.toBeNull();
      expect(tx.verificationToken.create).toHaveBeenCalledTimes(1);
    });

    it('skips the cooldown lookup entirely when cooldownMs is zero', async () => {
      await service.issue(buildIssueParams({ cooldownMs: 0 }) as never);

      expect(prisma.verificationToken.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    it('returns the account, purpose and email the token was issued for', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.verificationToken.findUnique.mockResolvedValue({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: EMAIL,
      } as never);

      const consumed = await service.consume(
        'raw-token',
        VerificationPurpose.EMAIL_VERIFICATION,
      );

      expect(consumed).toEqual({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: EMAIL,
      });
    });

    it('claims the row with a conditional update rather than reading it first', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.verificationToken.findUnique.mockResolvedValue({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: EMAIL,
      } as never);

      await service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION);

      // A read-then-write would let two simultaneous clicks both pass.
      expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: crypto
            .createHash('sha256')
            .update('raw-token')
            .digest('hex'),
          purpose: VerificationPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('looks the token up by hash AND purpose, so a reset token cannot be redeemed as a verification', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(
        service.consume('raw-token', VerificationPurpose.PASSWORD_RESET),
      ).rejects.toThrow(InvalidVerificationTokenException);

      expect(prisma.verificationToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            purpose: VerificationPurpose.PASSWORD_RESET,
          }),
        }),
      );
    });

    it('never passes the raw token to the database', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.verificationToken.findUnique.mockResolvedValue({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: EMAIL,
      } as never);

      await service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION);

      const where = prisma.verificationToken.updateMany.mock.calls[0][0].where;
      expect(where.tokenHash).not.toBe('raw-token');
    });

    it('throws InvalidVerificationTokenException when updateMany reports zero rows claimed', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(
        service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION),
      ).rejects.toThrow(InvalidVerificationTokenException);
    });

    it('does not read the row back when nothing was claimed', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 0 } as never);

      await expect(
        service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION),
      ).rejects.toThrow(InvalidVerificationTokenException);

      expect(prisma.verificationToken.findUnique).not.toHaveBeenCalled();
    });

    it('throws InvalidVerificationTokenException when the claimed row vanished before the read-back', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.verificationToken.findUnique.mockResolvedValue(null as never);

      await expect(
        service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION),
      ).rejects.toThrow(InvalidVerificationTokenException);
    });

    it('reads the claimed row back by tokenHash alone once the claim has been proven', async () => {
      prisma.verificationToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.verificationToken.findUnique.mockResolvedValue({
        userId: USER_ID,
        purpose: VerificationPurpose.EMAIL_VERIFICATION,
        email: EMAIL,
      } as never);

      await service.consume('raw-token', VerificationPurpose.EMAIL_VERIFICATION);

      expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
        where: {
          tokenHash: crypto
            .createHash('sha256')
            .update('raw-token')
            .digest('hex'),
        },
        select: { userId: true, purpose: true, email: true },
      });
    });
  });

  describe('purgeExpired', () => {
    it('deletes only rows whose expiry is older than the cutoff', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 3 } as never);

      const purged = await service.purgeExpired(86_400_000);

      expect(purged).toBe(3);
      expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('defaults to a seven-day retention window', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 } as never);

      const before = Date.now();
      await service.purgeExpired();

      const cutoff =
        prisma.verificationToken.deleteMany.mock.calls[0][0].where.expiresAt.lt;
      expect(cutoff.getTime()).toBeLessThanOrEqual(
        before - 7 * 24 * 60 * 60 * 1000,
      );
    });

    it('returns the number of deleted rows', async () => {
      prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 } as never);

      expect(await service.purgeExpired()).toBe(0);
    });
  });
});