import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());


import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { WompiWebhookController } from './wompi-webhook.controller';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { WompiService } from './wompi.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ActivationsService } from '../activations/activations.service';
import {
  WompiEventType,
  WompiTransactionStatus,
  SubscriptionPaymentPurpose,
} from '@pharmacy/shared-types';

function buildTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    reference: 'SUB-STARTER-1750000000000-abc12345',
    status: WompiTransactionStatus.APPROVED,
    ...overrides,
  };
}

function buildWebhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: WompiEventType.TRANSACTION_UPDATED,
    data: { transaction: buildTransaction() },
    environment: 'test',
    signature: { properties: ['transaction.id'], checksum: 'VALIDCHECKSUM' },
    timestamp: 1750000000,
    sent_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildPendingPayment(overrides: Record<string, unknown> = {}) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: 'pending-uuid-1',
    subscriptionId: null,
    wompiTransactionId: 'txn-1',
    wompiReference: 'SUB-STARTER-1750000000000-abc12345',
    purpose: SubscriptionPaymentPurpose.NEW_SUBSCRIPTION,
    planId: 'STARTER',
    amountCents: 9900000,
    currency: 'COP',
    customerTaxId: '900123456',
    customerEmail: 'owner@pharmacy.co',
    customerName: 'Juan Perez',
    newSubscriptionData: {
      customerName: 'Juan Perez',
      customerTaxId: '900123456',
      customerEmail: 'owner@pharmacy.co',
      customerPhone: '+573001234567',
      customerAddress: null,
      paymentMethod: 'WOMPI',
      gracePeriodDays: 7,
      trialEndsAt: null,
    },
    status: 'PENDING',
    expiresAt: future,
    createdAt: new Date(),
    ...overrides,
  };
}

const mockPrisma = mockDeep<PrismaClient>();

const mockWompiService = {
  verifyWebhookSignature: jest.fn(),
} as unknown as jest.Mocked<WompiService>;

const mockSubscriptionsService = {
  create: jest.fn(),
  recordPayment: jest.fn(),
} as unknown as jest.Mocked<SubscriptionsService>;

const mockActivationsService = {
  generateSubscriptionCodes: jest.fn(),
} as unknown as jest.Mocked<ActivationsService>;

describe('WompiWebhookController (integration)', () => {
  let app: INestApplication;
  let controller: WompiWebhookController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WompiWebhookController],
      providers: [
        { provide: WompiService, useValue: mockWompiService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
        { provide: ActivationsService, useValue: mockActivationsService },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    controller = app.get(WompiWebhookController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // $transaction must invoke its callback with the mock itself — never
    // assume a transaction callback runs without wiring this explicitly.
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
    mockPrisma.subscriptionPendingPayment.updateMany.mockResolvedValue({
      count: 1,
    } as any);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /webhooks/wompi', () => {
    // NestJS answers every POST with 201 unless @HttpCode overrides it; the
    // handler's own body still carries { statusCode: 200, message: 'OK' }.
    it('returns 401 and does not process when the signature is invalid', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(false);

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(buildWebhookEvent())
        .expect(401);

      expect(body.message).toBe('Invalid signature');
      expect(
        mockPrisma.subscriptionPendingPayment.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('creates the subscription and records the payment for an approved NEW_SUBSCRIPTION', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment() as any,
      );
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockSubscriptionsService.create.mockResolvedValue({
        id: 'sub-new-1',
      } as any);
      mockSubscriptionsService.recordPayment.mockResolvedValue({} as any);
      mockActivationsService.generateSubscriptionCodes.mockResolvedValue([] as any);
      mockPrisma.subscriptionPendingPayment.update.mockResolvedValue({} as any);

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(buildWebhookEvent())
        .expect(201);

      expect(body).toEqual({ statusCode: 200, message: 'OK' });
      expect(
        mockPrisma.subscriptionPendingPayment.findUnique,
      ).toHaveBeenCalledWith({ where: { wompiTransactionId: 'txn-1' } });
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
      );
      expect(
        mockPrisma.subscriptionPendingPayment.updateMany,
      ).toHaveBeenCalledWith({
        where: { id: 'pending-uuid-1', status: 'PENDING' },
        data: { status: 'PROCESSING' },
      });
      expect(mockSubscriptionsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'STARTER',
          customerName: 'Juan Perez',
          customerTaxId: '900123456',
          customerEmail: 'owner@pharmacy.co',
          customerPhone: '+573001234567',
          status: 'ACTIVE',
          paymentMethod: 'WOMPI',
          gracePeriodDays: 7,
        }),
      );
      expect(mockSubscriptionsService.recordPayment).toHaveBeenCalledWith(
        'sub-new-1',
        expect.objectContaining({
          amountCents: 9900000,
          currency: 'COP',
          paymentMethod: 'WOMPI',
          paymentReference: 'SUB-STARTER-1750000000000-abc12345',
          notes: expect.stringContaining('txn-1'),
          recordedById: null,
        }),
      );
      expect(mockActivationsService.generateSubscriptionCodes).toHaveBeenCalledWith(
        'sub-new-1',
        1,
      );
      expect(
        mockPrisma.subscriptionPendingPayment.update,
      ).toHaveBeenCalledWith({
        where: { id: 'pending-uuid-1' },
        data: { subscriptionId: 'sub-new-1', status: 'APPROVED' },
      });
    });

    it('skips a duplicate delivery when the claim updateMany matches nothing', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment() as any,
      );
      mockPrisma.subscriptionPendingPayment.updateMany.mockResolvedValue({
        count: 0,
      } as any);

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(buildWebhookEvent())
        .expect(201);

      expect(body).toEqual({ statusCode: 200, message: 'OK' });
      expect(mockSubscriptionsService.create).not.toHaveBeenCalled();
      expect(
        mockPrisma.subscriptionPendingPayment.update,
      ).not.toHaveBeenCalled();
    });

    it('records the payment only, without creating a subscription, for an approved RENEWAL', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment({
          subscriptionId: 'sub-existing-1',
          purpose: SubscriptionPaymentPurpose.RENEWAL,
          newSubscriptionData: null,
        }) as any,
      );
      mockSubscriptionsService.recordPayment.mockResolvedValue({} as any);
      mockPrisma.subscriptionPendingPayment.update.mockResolvedValue({} as any);

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(buildWebhookEvent())
        .expect(201);

      expect(body).toEqual({ statusCode: 200, message: 'OK' });
      expect(mockSubscriptionsService.create).not.toHaveBeenCalled();
      expect(mockSubscriptionsService.recordPayment).toHaveBeenCalledWith(
        'sub-existing-1',
        expect.objectContaining({
          amountCents: 9900000,
          paymentReference: 'SUB-STARTER-1750000000000-abc12345',
        }),
      );
      expect(
        mockPrisma.subscriptionPendingPayment.update,
      ).toHaveBeenCalledWith({
        where: { id: 'pending-uuid-1' },
        data: { status: 'APPROVED' },
      });
    });

    it('does nothing when the transaction is still PENDING', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment() as any,
      );

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(
          buildWebhookEvent({
            data: {
              transaction: buildTransaction({
                status: WompiTransactionStatus.PENDING,
              }),
            },
          }),
        )
        .expect(201);

      expect(body).toEqual({ statusCode: 200, message: 'OK' });
      expect(mockSubscriptionsService.create).not.toHaveBeenCalled();
      expect(mockSubscriptionsService.recordPayment).not.toHaveBeenCalled();
    });

    it('marks the pending payment with the failed status for a DECLINED transaction', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment() as any,
      );
      mockPrisma.subscriptionPendingPayment.update.mockResolvedValue({} as any);

      const { body } = await request(app.getHttpServer())
        .post('/webhooks/wompi')
        .send(
          buildWebhookEvent({
            data: {
              transaction: buildTransaction({
                status: WompiTransactionStatus.DECLINED,
              }),
            },
          }),
        )
        .expect(201);

      expect(body).toEqual({ statusCode: 200, message: 'OK' });
      expect(
        mockPrisma.subscriptionPendingPayment.update,
      ).toHaveBeenCalledWith({
        where: { id: 'pending-uuid-1' },
        data: { status: 'DECLINED' },
      });
      expect(mockSubscriptionsService.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('handleEvent error propagation', () => {
    it('rejects when processTransactionUpdate throws, so Wompi retries the webhook', async () => {
      mockWompiService.verifyWebhookSignature.mockReturnValue(true);
      mockPrisma.subscriptionPendingPayment.findUnique.mockResolvedValue(
        buildPendingPayment() as any,
      );
      mockSubscriptionsService.create.mockRejectedValue(
        new Error('wompi upstream failed'),
      );

      await expect(
        controller.handleEvent('checksum', { body: buildWebhookEvent() }),
      ).rejects.toThrow('wompi upstream failed');
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });
  });
});
