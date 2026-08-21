jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { FiscalProvider } from '@pharmacy/shared-types';
import { FiscalWebhooksController } from './fiscal-webhooks.controller';
import { FiscalWebhookService } from '../services/fiscal-webhook.service';

const mockService = {
  ingest: jest.fn(),
};

function createRequest(
  body: Record<string, unknown>,
  rawBody?: Buffer,
): Request {
  return {
    body,
    rawBody,
  } as unknown as Request;
}

describe('FiscalWebhooksController', () => {
  let controller: FiscalWebhooksController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalWebhooksController],
      providers: [{ provide: FiscalWebhookService, useValue: mockService }],
    }).compile();

    controller = module.get<FiscalWebhooksController>(FiscalWebhooksController);
    service = module.get(FiscalWebhookService) as jest.Mocked<
      typeof mockService
    >;
  });

  describe('POST /fiscal-dian/webhooks/:subscriptionId/:provider', () => {
    it('rejects an unknown provider with 400', async () => {
      await expect(
        controller.handle('sub-1', 'FOO', {}, createRequest({})),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.handle('sub-1', 'FOO', {}, createRequest({})),
      ).rejects.toThrow('Unsupported webhook provider "FOO"');
      expect(service.ingest).not.toHaveBeenCalled();
    });

    it.each([FiscalProvider.ALANUBE, FiscalProvider.DATAICO])(
      'delegates %s webhooks to the service with the raw body',
      async (provider) => {
        const rawBody = Buffer.from('{"status":"VALIDATED"}', 'utf-8');
        const req = createRequest({ status: 'VALIDATED' }, rawBody);
        service.ingest.mockResolvedValue({ accepted: true, eventId: 'evt-1' });

        const result = await controller.handle(
          'sub-1',
          provider,
          { 'x-signature': 'sig' },
          req,
        );

        expect(service.ingest).toHaveBeenCalledWith({
          subscriptionId: 'sub-1',
          provider,
          rawBody,
          headers: { 'x-signature': 'sig' },
          payload: { status: 'VALIDATED' },
        });
        expect(result).toEqual({ accepted: true, eventId: 'evt-1' });
      },
    );

    it('falls back to the serialized body when no rawBody was captured', async () => {
      const req = createRequest({ status: 'VALIDATED' });
      service.ingest.mockResolvedValue({ accepted: true, eventId: 'evt-1' });

      await controller.handle('sub-1', FiscalProvider.ALANUBE, {}, req);

      const ingestCall = service.ingest.mock.calls[0][0];
      expect(ingestCall.rawBody).toEqual(
        Buffer.from(JSON.stringify({ status: 'VALIDATED' }), 'utf-8'),
      );
    });

    it('throws 400 with the service reason when the webhook is rejected', async () => {
      service.ingest.mockResolvedValue({
        accepted: false,
        eventId: null,
        reason: 'Webhook signature verification failed',
      });

      await expect(
        controller.handle(
          'sub-1',
          FiscalProvider.ALANUBE,
          {},
          createRequest({}),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.handle(
          'sub-1',
          FiscalProvider.ALANUBE,
          {},
          createRequest({}),
        ),
      ).rejects.toThrow('Webhook signature verification failed');
    });
  });
});
