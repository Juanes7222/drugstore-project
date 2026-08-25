// Mock @pharmacy/database before importing the service: its import chain
// pulls in PrismaService, which value-imports the generated Prisma client.
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalProvider } from '@pharmacy/shared-types';
import { FiscalWebhookService } from './fiscal-webhook.service';
import { WebhookSignatureVerifier } from './webhook-signature.verifier';
import {
  WebhookEventNormalizer,
  NormalizedWebhookEvent,
} from './webhook-event.normalizer';
import { EnvSecretResolver } from './env-secret.resolver';
import { TECH_PROVIDER_CONFIG_ID } from '../constants/fiscal-singleton-ids';

const CONFIG = {
  subscriptionId: 'sub-1',
  webhookSecretReference: 'env:WEBHOOK_SECRET',
  providerType: FiscalProvider.ALANUBE,
};

const NORMALIZED: NormalizedWebhookEvent = {
  providerEventId: 'evt-provider-1',
  eventType: 'status.validated',
  providerTrackId: 'track-1',
  outcome: 'VALIDATED',
  cufe: 'cufe-123',
  signedXml: '<SignedInvoice/>',
  responseCode: '00',
  responseMessage: 'Ok',
};

describe('FiscalWebhookService', () => {
  let service: FiscalWebhookService;
  let prisma: DeepMockProxy<PrismaClient>;
  let tenantContext: {
    registerAfterCommit: jest.Mock;
    getSubscriptionId: jest.Mock;
  };
  let verifier: { verify: jest.Mock };
  let normalizer: { normalize: jest.Mock };
  let secrets: { resolve: jest.Mock };
  let queue: { add: jest.Mock };
  let afterCommitCallback: (() => Promise<void>) | null;

  const payload = { status: 'VALIDATED', cufe: 'cufe-123' };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    (prisma as any).withTenant = jest.fn(
      async (_subscriptionId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
    );
    afterCommitCallback = null;
    tenantContext = {
      registerAfterCommit: jest.fn((cb: () => Promise<void>) => {
        afterCommitCallback = cb;
      }),
      getSubscriptionId: jest.fn().mockReturnValue('sub-1'),
    };
    verifier = { verify: jest.fn().mockReturnValue(true) };
    normalizer = { normalize: jest.fn().mockReturnValue(NORMALIZED) };
    secrets = { resolve: jest.fn().mockReturnValue('secret-value') };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue(
      CONFIG,
    );
    (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue({
      id: 'fd-1',
    });
    (prisma.fiscalWebhookEvent.create as jest.Mock).mockResolvedValue({
      id: 'evt-1',
    });
    service = new FiscalWebhookService(
      prisma as any,
      tenantContext as any,
      verifier as unknown as WebhookSignatureVerifier,
      normalizer as unknown as WebhookEventNormalizer,
      secrets as unknown as EnvSecretResolver,
      queue as any,
    );
  });

  const ingest = () =>
    service.ingest({
      subscriptionId: 'sub-1',
      provider: FiscalProvider.ALANUBE,
      rawBody: Buffer.from(JSON.stringify(payload)),
      headers: { 'x-signature': 'sig' },
      payload,
    });

  describe('ingest', () => {
    it('rejects when no TechProviderConfig exists', async () => {
      (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await ingest();

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('configuration');
      expect(prisma.fiscalWebhookEvent.create).not.toHaveBeenCalled();
    });

    it('rejects when the provider type does not match the configured one', async () => {
      (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue({
        ...CONFIG,
        providerType: FiscalProvider.DIAN_DIRECT,
      });

      const result = await ingest();

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('ALANUBE');
      expect(result.reason).toContain('configuration');
    });

    it('rejects when no webhook secret reference is configured', async () => {
      (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue({
        ...CONFIG,
        webhookSecretReference: null,
      });

      const result = await ingest();

      expect(result.accepted).toBe(false);
      expect(result.reason).toContain('Webhook secret is not configured');
    });

    it('persists the event as REJECTED and rejects when the signature cannot be verified', async () => {
      verifier.verify.mockReturnValue(false);

      const result = await ingest();

      expect(prisma.fiscalWebhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subscriptionId: 'sub-1',
          provider: FiscalProvider.ALANUBE,
          signatureValid: false,
          status: 'REJECTED',
          outcome: 'VALIDATED',
        }),
      });
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('Webhook signature verification failed');
      expect(queue.add).not.toHaveBeenCalled();
      expect(tenantContext.registerAfterCommit).not.toHaveBeenCalled();
    });

    it('correlates the document, persists a RECEIVED event, and enqueues the engine job after commit', async () => {
      const result = await ingest();

      expect(prisma.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          providerType: FiscalProvider.ALANUBE,
          providerTrackId: 'track-1',
        },
        select: { id: true },
      });
      expect(prisma.fiscalWebhookEvent.create).toHaveBeenCalledWith({
        data: {
          id: expect.any(String),
          subscriptionId: 'sub-1',
          provider: FiscalProvider.ALANUBE,
          providerEventId: 'evt-provider-1',
          eventType: 'status.validated',
          fiscalDocumentId: 'fd-1',
          rawPayload: payload,
          signatureValid: true,
          outcome: 'VALIDATED',
          cufe: 'cufe-123',
          signedXml: '<SignedInvoice/>',
          responseCode: '00',
          responseMessage: 'Ok',
          status: 'RECEIVED',
        },
      });
      expect(tenantContext.registerAfterCommit).toHaveBeenCalledWith(
        expect.any(Function),
      );
      expect(queue.add).not.toHaveBeenCalled();

      // The callback only runs after the request transaction commits.
      await afterCommitCallback!();

      expect(queue.add).toHaveBeenCalledWith('webhook-event', {
        eventId: expect.any(String),
      });
      expect(result).toEqual({ accepted: true, eventId: expect.any(String) });
    });

    it('treats a duplicate (provider, providerEventId) as idempotent success', async () => {
      (prisma.fiscalWebhookEvent.create as jest.Mock).mockRejectedValue({
        code: 'P2002',
      });

      const result = await ingest();

      expect(result.accepted).toBe(true);
      expect(tenantContext.registerAfterCommit).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('persists a FAILED event and accepts the webhook when normalization returns null', async () => {
      // Documented behaviour: accepted is only false when the signature is
      // invalid; an unparseable payload still gets recorded (status FAILED)
      // so the event is never silently dropped.
      normalizer.normalize.mockReturnValue(null);

      const result = await ingest();

      expect(prisma.fiscalWebhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          signatureValid: true,
          status: 'FAILED',
          outcome: null,
          fiscalDocumentId: null,
        }),
      });
      expect(result.accepted).toBe(true);
      expect(result.reason).toContain('no matching fiscal document');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('records the event without enqueueing when no document matches', async () => {
      (prisma.fiscalDocument.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await ingest();

      expect(prisma.fiscalWebhookEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiscalDocumentId: null,
          status: 'RECEIVED',
        }),
      });
      expect(result.accepted).toBe(true);
      expect(result.reason).toContain('no matching fiscal document');
      expect(queue.add).not.toHaveBeenCalled();
    });
  });
});
