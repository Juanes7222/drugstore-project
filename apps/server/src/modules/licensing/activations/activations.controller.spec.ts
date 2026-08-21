// Mock @pharmacy/database before any imports that pull in PrismaClient,
// because the generated client is ESM and Jest's CommonJS runner cannot
// parse it without a transform layer.
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ActivationsController } from './activations.controller';
import { ActivationsService } from './activations.service';
import { ZodExceptionFilter } from '@/common/filters/zod-exception.filter';

const mockActivationsService = {
  recoverActivationCodes: jest.fn(),
  activate: jest.fn(),
  getStatusByWorkstation: jest.fn(),
  generateActivationCode: jest.fn(),
  findBySubscription: jest.fn(),
  findByLocation: jest.fn(),
  revoke: jest.fn(),
  getActivationStatus: jest.fn(),
} as unknown as jest.Mocked<ActivationsService>;

describe('ActivationsController (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivationsController],
      providers: [
        { provide: ActivationsService, useValue: mockActivationsService },
      ],
    }).compile();

    app = module.createNestApplication();
    // Mirrors main.ts: in-handler ZodError must surface as 400, not 500.
    app.useGlobalFilters(new ZodExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /public/licensing/activation-codes', () => {
    it('returns the recovered activation codes for matching taxId and email', async () => {
      mockActivationsService.recoverActivationCodes.mockResolvedValue({
        codes: [
          {
            code: 'ABCD-EFGH-IJKL-MNOP5',
            expiresAt: '2027-01-01T00:00:00.000Z',
          },
        ],
      });

      const { body } = await request(app.getHttpServer())
        .get(
          '/public/licensing/activation-codes?taxId=900123456&email=owner%40pharmacy.co',
        )
        .expect(200);

      expect(body).toEqual({
        codes: [
          {
            code: 'ABCD-EFGH-IJKL-MNOP5',
            expiresAt: '2027-01-01T00:00:00.000Z',
          },
        ],
      });
      expect(mockActivationsService.recoverActivationCodes).toHaveBeenCalledWith(
        '900123456',
        'owner@pharmacy.co',
      );
    });

    it('returns 400 and never calls the service when taxId is missing', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/public/licensing/activation-codes?email=owner%40pharmacy.co')
        .expect(400);

      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(body.statusCode).toBe(400);
      expect(
        mockActivationsService.recoverActivationCodes,
      ).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when taxId is empty', async () => {
      const { body } = await request(app.getHttpServer())
        .get(
          '/public/licensing/activation-codes?taxId=&email=owner%40pharmacy.co',
        )
        .expect(400);

      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(
        mockActivationsService.recoverActivationCodes,
      ).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when email is missing', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/public/licensing/activation-codes?taxId=900123456')
        .expect(400);

      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(
        mockActivationsService.recoverActivationCodes,
      ).not.toHaveBeenCalled();
    });

    it('returns 400 and never calls the service when email is invalid', async () => {
      const { body } = await request(app.getHttpServer())
        .get(
          '/public/licensing/activation-codes?taxId=900123456&email=not-an-email',
        )
        .expect(400);

      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(
        mockActivationsService.recoverActivationCodes,
      ).not.toHaveBeenCalled();
    });
  });
});