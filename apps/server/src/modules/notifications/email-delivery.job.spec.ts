jest.mock('resend', () => ({
  Resend: jest.fn(),
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { EmailDeliveryJob } from './email-delivery.job';
import { ConsoleMailProvider } from './providers/console-mail.provider';
import { ResendMailProvider } from './providers/resend-mail.provider';
import { createMailProvider } from './mail.factory';
import type { MailProvider, RenderedMail } from './mail.port';
import { MailTemplatesService } from './mail-templates.service';
import type { EnvConfig } from '@/config/env.schema';
import type { EmailJobData } from './mail.types';

function buildConfig(values: Record<string, unknown>): ConfigService<EnvConfig> {
  return { get: (key: string) => values[key] } as unknown as
    ConfigService<EnvConfig>;
}

function buildJobData(overrides: Partial<EmailJobData> = {}): EmailJobData {
  return {
    template: 'EMAIL_VERIFICATION',
    to: 'user@example.com',
    recipientName: 'Ada Lovelace',
    token: 'raw-token',
    idempotencyKey: 'token-id-1',
    expiresAt: new Date('2026-05-01T12:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function buildJob(data: EmailJobData, attemptsMade = 0): Job<EmailJobData> {
  return { data, attemptsMade } as unknown as Job<EmailJobData>;
}

function buildMail(overrides: Partial<RenderedMail> = {}): RenderedMail {
  return {
    to: 'user@example.com',
    subject: 'Verifica tu correo electrónico',
    html: '<p>body</p>',
    text: 'Verificar mi correo: https://app.example.test/verify-email?token=raw-token',
    idempotencyKey: 'token-id-1',
    tags: [{ name: 'template', value: 'EMAIL_VERIFICATION' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ConsoleMailProvider
// ---------------------------------------------------------------------------

describe('ConsoleMailProvider', () => {
  let provider: ConsoleMailProvider;

  beforeEach(() => {
    provider = new ConsoleMailProvider();
  });

  it('reports the console driver name', () => {
    expect(provider.driver).toBe('console');
  });

  it('resolves without performing any network call', async () => {
    await expect(provider.send(buildMail())).resolves.toBeUndefined();
  });

  it('tolerates a body with no link line', async () => {
    await expect(
      provider.send(buildMail({ text: 'no link here' })),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ResendMailProvider
// ---------------------------------------------------------------------------

describe('ResendMailProvider', () => {
  const resendConfig = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'PharmacyPOS <no-reply@example.test>',
  };

  it('reports the resend driver name', () => {
    const provider = new ResendMailProvider(buildConfig(resendConfig));

    expect(provider.driver).toBe('resend');
  });

  it('passes the idempotency key through the SDK options argument, never as a literal header', async () => {
    const send = jest.fn().mockResolvedValue({ data: {}, error: null });
    const provider = new ResendMailProvider(buildConfig(resendConfig));
    // The provider builds its own client internally; reach it to stub the SDK.
    Reflect.set(provider, 'client', { emails: { send } });

    await provider.send(buildMail());

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: resendConfig.EMAIL_FROM,
        to: 'user@example.com',
        subject: 'Verifica tu correo electrónico',
        html: '<p>body</p>',
      }),
      { idempotencyKey: 'token-id-1' },
    );
  });

  it('omits reply_to when EMAIL_REPLY_TO is unset', async () => {
    const send = jest.fn().mockResolvedValue({ data: {}, error: null });
    const provider = new ResendMailProvider(buildConfig(resendConfig));
    Reflect.set(provider, 'client', { emails: { send } });

    await provider.send(buildMail());

    const [payload] = send.mock.calls[0];
    expect(payload).not.toHaveProperty('reply_to');
  });

  it('includes reply_to when EMAIL_REPLY_TO is configured', async () => {
    const send = jest.fn().mockResolvedValue({ data: {}, error: null });
    const provider = new ResendMailProvider(
      buildConfig({
        ...resendConfig,
        EMAIL_REPLY_TO: 'support@example.test',
      }),
    );
    Reflect.set(provider, 'client', { emails: { send } });

    await provider.send(buildMail());

    const [payload] = send.mock.calls[0];
    expect(payload.reply_to).toBe('support@example.test');
  });

  it('rethrows a provider rejection so the BullMQ retry policy applies', async () => {
    const send = jest.fn().mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'bad request' },
    });
    const provider = new ResendMailProvider(buildConfig(resendConfig));
    Reflect.set(provider, 'client', { emails: { send } });

    await expect(provider.send(buildMail())).rejects.toThrow(
      /Resend rejected the message/,
    );
  });

  it('does not swallow a transport-level exception', async () => {
    const send = jest.fn().mockRejectedValue(new Error('socket hang up'));
    const provider = new ResendMailProvider(buildConfig(resendConfig));
    Reflect.set(provider, 'client', { emails: { send } });

    await expect(provider.send(buildMail())).rejects.toThrow('socket hang up');
  });
});

// ---------------------------------------------------------------------------
// createMailProvider
// ---------------------------------------------------------------------------

describe('createMailProvider', () => {
  it('returns the console provider for the console driver', () => {
    const provider = createMailProvider(
      buildConfig({ EMAIL_DRIVER: 'console' }),
    );

    expect(provider).toBeInstanceOf(ConsoleMailProvider);
  });

  it('returns the resend provider for the resend driver', () => {
    const provider = createMailProvider(
      buildConfig({
        EMAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: 'no-reply@example.test',
      }),
    );

    expect(provider).toBeInstanceOf(ResendMailProvider);
  });

  it('defaults to the console provider when EMAIL_DRIVER is unset', () => {
    const provider = createMailProvider(buildConfig({}));

    expect(provider.driver).toBe('console');
  });
});

// ---------------------------------------------------------------------------
// EmailDeliveryJob
// ---------------------------------------------------------------------------

describe('EmailDeliveryJob', () => {
  let send: jest.Mock;
  let provider: MailProvider;
  let templates: { render: jest.Mock };
  let job: EmailDeliveryJob;

  beforeEach(() => {
    send = jest.fn().mockResolvedValue(undefined);
    provider = { driver: 'console', send };
    templates = { render: jest.fn().mockReturnValue(buildMail()) };
    job = new EmailDeliveryJob(provider, templates as unknown as MailTemplatesService);
  });

  it('renders the template named by the job payload', async () => {
    await job.process(buildJob(buildJobData()));

    expect(templates.render).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      expect.objectContaining({ to: 'user@example.com' }),
    );
  });

  it('converts the ISO expiry back into a Date for the template', async () => {
    await job.process(buildJob(buildJobData()));

    expect(templates.render).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      expect.objectContaining({
        expiresAt: new Date('2026-05-01T12:00:00.000Z'),
      }),
    );
  });

  it('forwards the idempotency key to the renderer', async () => {
    await job.process(buildJob(buildJobData({ idempotencyKey: 'key-99' })));

    expect(templates.render).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      expect.objectContaining({ idempotencyKey: 'key-99' }),
    );
  });

  it('hands the rendered message to the provider', async () => {
    await job.process(buildJob(buildJobData()));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(buildMail());
  });

  it('rethrows a delivery failure so BullMQ applies its retry and backoff', async () => {
    send.mockRejectedValue(new Error('provider 503'));

    await expect(job.process(buildJob(buildJobData()))).rejects.toThrow(
      'provider 503',
    );
  });

  it('reports the attempt number in the failure log without logging the body', async () => {
    const warn = jest.spyOn(
      (job as unknown as { logger: { warn: jest.Mock } }).logger,
      'warn',
    );
    send.mockRejectedValue(new Error('provider 503'));

    await expect(
      job.process(buildJob(buildJobData(), 1)),
    ).rejects.toThrow('provider 503');

    // The rendered body embeds the capability token, so it must not appear.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('attempt=2'),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('raw-token'),
    );
  });
});