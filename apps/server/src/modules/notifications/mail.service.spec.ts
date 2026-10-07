jest.mock('@/modules/tenant/tenant-context.service', () => ({
  TenantContextService: class {},
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Queue } from 'bullmq';
import { MailService } from './mail.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { EMAILS_QUEUE, MAIL_DELIVERY_ATTEMPTS } from './mail.port';
import type { EmailJobData } from './mail.types';

const EXPIRES_AT = new Date('2026-05-01T12:00:00.000Z');

function buildJobData(
  overrides: Partial<EmailJobData> = {},
): EmailJobData {
  return {
    template: 'EMAIL_VERIFICATION',
    to: 'user@example.com',
    recipientName: 'Ada Lovelace',
    token: 'raw-token',
    idempotencyKey: 'token-id-1',
    expiresAt: EXPIRES_AT.toISOString(),
    ...overrides,
  };
}

describe('MailService', () => {
  let add: jest.Mock;
  let queue: Queue;
  let hasTenant: jest.Mock;
  let registerAfterCommit: jest.Mock;
  let service: MailService;

  beforeEach(() => {
    add = jest.fn().mockResolvedValue(undefined);
    queue = { add } as unknown as Queue;
    hasTenant = jest.fn().mockReturnValue(false);
    registerAfterCommit = jest.fn();
    service = new MailService(queue, {
      hasTenant,
      registerAfterCommit,
    } as unknown as TenantContextService);
  });

  describe('dispatch inside a tenant context', () => {
    beforeEach(() => {
      hasTenant.mockReturnValue(true);
    });

    it('does not enqueue synchronously, so a rolled-back write cannot mail a dead link', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).not.toHaveBeenCalled();
    });

    it('registers the enqueue as an after-commit callback instead', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(registerAfterCommit).toHaveBeenCalledTimes(1);
      expect(typeof registerAfterCommit.mock.calls[0][0]).toBe('function');
    });

    it('enqueues once the registered callback actually runs', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      await registerAfterCommit.mock.calls[0][0]();

      expect(add).toHaveBeenCalledTimes(1);
    });

    it('defers a password reset the same way', async () => {
      await service.sendPasswordReset({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).not.toHaveBeenCalled();
      expect(registerAfterCommit).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispatch outside a tenant context', () => {
    it('enqueues the verification mail immediately', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).toHaveBeenCalledTimes(1);
      expect(registerAfterCommit).not.toHaveBeenCalled();
    });

    it('enqueues the password reset immediately', async () => {
      await service.sendPasswordReset({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).toHaveBeenCalledTimes(1);
      expect(registerAfterCommit).not.toHaveBeenCalled();
    });
  });

  describe('job payload', () => {
    it('publishes the verification payload on the emails queue', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).toHaveBeenCalledWith(
        'send',
        {
          template: 'EMAIL_VERIFICATION',
          to: 'user@example.com',
          recipientName: 'Ada Lovelace',
          token: 'raw-token',
          idempotencyKey: 'token-id-1',
          expiresAt: EXPIRES_AT.toISOString(),
        },
        expect.objectContaining({ attempts: MAIL_DELIVERY_ATTEMPTS }),
      );
    });

    it('publishes the password-reset payload with its own template name', async () => {
      await service.sendPasswordReset({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      expect(add).toHaveBeenCalledWith(
        'send',
        expect.objectContaining({ template: 'PASSWORD_RESET' }),
        expect.anything(),
      );
    });

    it('serializes the expiry as an ISO string so the payload survives the Redis round-trip', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: 'Ada Lovelace',
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      const [, data] = add.mock.calls[0];
      expect(typeof data.expiresAt).toBe('string');
      expect(data.expiresAt).toBe(EXPIRES_AT.toISOString());
    });

    it('carries a null display name through unchanged', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: null,
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      const [, data] = add.mock.calls[0];
      expect(data.recipientName).toBeNull();
    });
  });

  describe('queue options', () => {
    it('applies the shared retry policy so a transient provider failure is retried', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: null,
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      const [, , options] = add.mock.calls[0];
      expect(options.attempts).toBe(MAIL_DELIVERY_ATTEMPTS);
      expect(options.backoff).toEqual({
        type: 'exponential',
        delay: 5_000,
      });
    });

    it('drops a completed job so Redis does not accumulate them', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: null,
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      const [, , options] = add.mock.calls[0];
      expect(options.removeOnComplete).toBe(true);
    });

    it('drops an exhausted failed job after a day rather than retrying a dead link', async () => {
      await service.sendEmailVerification({
        to: 'user@example.com',
        recipientName: null,
        token: 'raw-token',
        idempotencyKey: 'token-id-1',
        expiresAt: EXPIRES_AT,
      });

      const [, , options] = add.mock.calls[0];
      expect(options.removeOnFail).toEqual({ age: 86_400 });
    });
  });

  describe('queue name', () => {
    it('is registered in the root BullMqModule under the shared constant', () => {
      expect(EMAILS_QUEUE).toBe('emails');
    });
  });
});