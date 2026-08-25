import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());


import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { ZodError } from 'zod';
import { CheckoutController } from './checkout.controller';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { WompiService } from './wompi.service';
import { PlansService } from '../plans/plans.service';
import { ActivationsService } from '../activations/activations.service';
import {
  BillingPeriod,
  DEFAULT_PLANS,
  SubscriptionPaymentPurpose,
} from '@pharmacy/shared-types';

const RENEWAL_SUBSCRIPTION_ID = '123e4567-e89b-12d3-a456-426614174000';
// The self-service checkout resolves plans through DEFAULT_PLANS when no DB
// row exists; the seed now contains only the two billing-method plans.
const PROVIDER_PLAN = DEFAULT_PLANS.find((p) => p.code === 'PROVIDER')!;
const PROVIDER_AMOUNT_CENTS = PROVIDER_PLAN.basePriceCents;
const CHECKOUT_URL = 'https://checkout.wompi.co/l/plink-1';

function buildSessionBody(overrides: Record<string, unknown> = {}) {
  return {
    planCode: 'PROVIDER',
    customerTaxId: '900123456',
    customerEmail: 'owner@pharmacy.co',
    customerName: 'Juan Perez',
    customerPhone: '+573001234567',
    billingPeriod: BillingPeriod.MONTHLY,
    ...overrides,
  };
}

function buildPendingPayment(overrides: Record<string, unknown> = {}) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: 'pending-uuid-1',
    subscriptionId: null,
    wompiTransactionId: 'plink-1',
    wompiReference: 'SUB-PROVIDER-1750000000000-abc12345',
    purpose: SubscriptionPaymentPurpose.NEW_SUBSCRIPTION,
    planId: 'PROVIDER',
    amountCents: PROVIDER_AMOUNT_CENTS,
    currency: 'COP',
    customerTaxId: '900123456',
    customerEmail: 'owner@pharmacy.co',
    customerName: 'Juan Perez',
    newSubscriptionData: null,
    status: 'PENDING',
    expiresAt: future,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildPaymentLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plink-2',
    name: `Suscripción ${PROVIDER_PLAN.name} - Juan Perez`,
    description: 'Plan PROVIDER - MONTHLY',
    single_use: true,
    collect_shipping: false,
    currency: 'COP',
    amount_in_cents: PROVIDER_AMOUNT_CENTS,
    sku: null,
    expires_at: null,
    redirect_url: null,
    image_url: null,
    active: true,
    customer_data: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    merchant_public_key: 'pub_test_xxx',
    ...overrides,
  };
}

const mockPrisma = mockDeep<PrismaClient>();

const mockWompiService = {
  createPaymentLink: jest.fn(),
  buildCheckoutUrl: jest.fn(),
} as unknown as jest.Mocked<WompiService>;

const mockPlansService = {} as unknown as jest.Mocked<PlansService>;

const mockActivationsService = {
  findFirstUnusedSubscriptionCode: jest.fn(),
} as unknown as jest.Mocked<ActivationsService>;

describe('CheckoutController (integration)', () => {
  let app: INestApplication;
  let controller: CheckoutController;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WompiService, useValue: mockWompiService },
        { provide: PlansService, useValue: mockPlansService },
        { provide: ActivationsService, useValue: mockActivationsService },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    controller = app.get(CheckoutController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockWompiService.buildCheckoutUrl.mockReturnValue(CHECKOUT_URL);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /public/licensing/checkout/create-session', () => {
    it('resumes an existing PENDING NEW_SUBSCRIPTION session without minting a new payment link', async () => {
      const existing = buildPendingPayment();
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(
        existing as any,
      );

      const { body } = await request(app.getHttpServer())
        .post('/public/licensing/checkout/create-session')
        .send(buildSessionBody())
        .expect(201);

      expect(mockPrisma.subscriptionPendingPayment.findFirst).toHaveBeenCalledWith(
        {
          where: {
            purpose: SubscriptionPaymentPurpose.NEW_SUBSCRIPTION,
            customerEmail: 'owner@pharmacy.co',
            planId: 'PROVIDER',
            status: 'PENDING',
            expiresAt: { gt: expect.any(Date) },
          },
          orderBy: { createdAt: 'desc' },
        },
      );
      expect(mockWompiService.createPaymentLink).not.toHaveBeenCalled();
      expect(mockPrisma.subscriptionPendingPayment.create).not.toHaveBeenCalled();
      expect(body).toEqual({
        sessionId: existing.id,
        paymentLinkId: existing.wompiTransactionId,
        checkoutUrl: CHECKOUT_URL,
        reference: existing.wompiReference,
        amountCents: existing.amountCents,
        currency: existing.currency,
      });
    });

    it('resumes an existing PENDING RENEWAL session keyed on purpose + subscriptionId', async () => {
      const existing = buildPendingPayment({
        subscriptionId: RENEWAL_SUBSCRIPTION_ID,
        purpose: SubscriptionPaymentPurpose.RENEWAL,
      });
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(
        existing as any,
      );

      const { body } = await request(app.getHttpServer())
        .post('/public/licensing/checkout/create-session')
        .send(
          buildSessionBody({ subscriptionId: RENEWAL_SUBSCRIPTION_ID }),
        )
        .expect(201);

      expect(mockPrisma.subscriptionPendingPayment.findFirst).toHaveBeenCalledWith(
        {
          where: {
            purpose: SubscriptionPaymentPurpose.RENEWAL,
            customerEmail: 'owner@pharmacy.co',
            planId: 'PROVIDER',
            subscriptionId: RENEWAL_SUBSCRIPTION_ID,
            status: 'PENDING',
            expiresAt: { gt: expect.any(Date) },
          },
          orderBy: { createdAt: 'desc' },
        },
      );
      expect(mockWompiService.createPaymentLink).not.toHaveBeenCalled();
      expect(mockPrisma.subscriptionPendingPayment.create).not.toHaveBeenCalled();
      expect(body.sessionId).toBe(existing.id);
      expect(body.paymentLinkId).toBe(existing.wompiTransactionId);
    });

    it('creates a Wompi payment link and a NEW_SUBSCRIPTION pending record when no session exists', async () => {
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(null);
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockWompiService.createPaymentLink.mockResolvedValue(
        buildPaymentLink() as any,
      );
      mockPrisma.subscriptionPendingPayment.create.mockResolvedValue(
        buildPendingPayment({
          id: 'pending-uuid-2',
          wompiTransactionId: 'plink-2',
        }) as any,
      );

      const { body } = await request(app.getHttpServer())
        .post('/public/licensing/checkout/create-session')
        .send(buildSessionBody())
        .expect(201);

      expect(mockWompiService.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `Suscripción ${PROVIDER_PLAN.name} - Juan Perez`,
          description: 'Plan PROVIDER — MONTHLY',
          single_use: true,
          collect_shipping: false,
          currency: 'COP',
          amount_in_cents: PROVIDER_AMOUNT_CENTS,
          redirect_url: null,
        }),
      );
      expect(mockPrisma.subscriptionPendingPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: null,
            wompiTransactionId: 'plink-2',
            wompiReference: expect.stringMatching(/^SUB-PROVIDER-/),
            purpose: SubscriptionPaymentPurpose.NEW_SUBSCRIPTION,
            planId: 'PROVIDER',
            amountCents: PROVIDER_AMOUNT_CENTS,
            currency: 'COP',
            status: 'PENDING',
            newSubscriptionData: expect.objectContaining({
              customerName: 'Juan Perez',
              customerTaxId: '900123456',
              customerEmail: 'owner@pharmacy.co',
              customerPhone: '+573001234567',
              customerAddress: null,
              paymentMethod: 'WOMPI',
              gracePeriodDays: 7,
              trialEndsAt: null,
            }),
          }),
        }),
      );
      expect(mockWompiService.buildCheckoutUrl).toHaveBeenCalledWith('plink-2');
      expect(body).toEqual({
        sessionId: expect.any(String),
        paymentLinkId: 'plink-2',
        checkoutUrl: CHECKOUT_URL,
        reference: expect.stringMatching(/^SUB-PROVIDER-/),
        amountCents: PROVIDER_AMOUNT_CENTS,
        currency: 'COP',
      });
    });

    it('stamps a renewal session with purpose RENEWAL and subscriptionId, omitting newSubscriptionData', async () => {
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(null);
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockWompiService.createPaymentLink.mockResolvedValue(
        buildPaymentLink() as any,
      );
      mockPrisma.subscriptionPendingPayment.create.mockResolvedValue(
        buildPendingPayment({
          id: 'pending-uuid-3',
          subscriptionId: RENEWAL_SUBSCRIPTION_ID,
          purpose: SubscriptionPaymentPurpose.RENEWAL,
        }) as any,
      );

      const { body } = await request(app.getHttpServer())
        .post('/public/licensing/checkout/create-session')
        .send(
          buildSessionBody({ subscriptionId: RENEWAL_SUBSCRIPTION_ID }),
        )
        .expect(201);

      expect(mockPrisma.subscriptionPendingPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: RENEWAL_SUBSCRIPTION_ID,
            purpose: SubscriptionPaymentPurpose.RENEWAL,
            status: 'PENDING',
          }),
        }),
      );
      expect(mockPrisma.subscriptionPendingPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            newSubscriptionData: expect.anything(),
          }),
        }),
      );
      expect(body.subscriptionId).toBeUndefined();
    });

    it('throws PAYMENT_LINK_CREATION_FAILED when Wompi link creation fails', async () => {
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(null);
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      mockWompiService.createPaymentLink.mockRejectedValue(
        new Error('wompi is down'),
      );

      await expect(
        controller.createSession(buildSessionBody()),
      ).rejects.toMatchObject({
        errorCode: 'PAYMENT_LINK_CREATION_FAILED',
        status: HttpStatus.BAD_GATEWAY,
      });
      expect(mockPrisma.subscriptionPendingPayment.create).not.toHaveBeenCalled();
    });

    it('throws PLAN_NOT_FOUND when the plan is neither in the DB nor in DEFAULT_PLANS', async () => {
      mockPrisma.subscriptionPendingPayment.findFirst.mockResolvedValue(null);
      mockPrisma.plan.findUnique.mockResolvedValue(null);

      await expect(
        controller.createSession(buildSessionBody({ planCode: 'NOPE' })),
      ).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
      expect(mockWompiService.createPaymentLink).not.toHaveBeenCalled();
    });

    it('rejects with ZodError before any prisma call when customerEmail is invalid', async () => {
      await expect(
        controller.createSession(buildSessionBody({ customerEmail: 'not-an-email' })),
      ).rejects.toBeInstanceOf(ZodError);
      expect(mockPrisma.subscriptionPendingPayment.findFirst).not.toHaveBeenCalled();
    });

    it('rejects with ZodError before any prisma call when planCode is missing', async () => {
      await expect(
        controller.createSession(buildSessionBody({ planCode: undefined })),
      ).rejects.toBeInstanceOf(ZodError);
      expect(mockPrisma.subscriptionPendingPayment.findFirst).not.toHaveBeenCalled();
    });

    it('rejects with ZodError before any prisma call when subscriptionId is not a uuid', async () => {
      await expect(
        controller.createSession(buildSessionBody({ subscriptionId: 'not-a-uuid' })),
      ).rejects.toBeInstanceOf(ZodError);
      expect(mockPrisma.subscriptionPendingPayment.findFirst).not.toHaveBeenCalled();
    });
  });
});