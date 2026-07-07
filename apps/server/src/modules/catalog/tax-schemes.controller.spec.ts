// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { TaxSchemesController } from './tax-schemes.controller';
import { TaxSchemesService } from './tax-schemes.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'admin',
    role: 'ADMIN' as const,
    isActive: true,
    ...overrides,
  };
}

function buildMockTaxScheme(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tax-uuid-1',
    code: 'IVA19',
    name: 'IVA 19%',
    taxType: 'IVA' as const,
    rate: '19.0000',
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: 'user-uuid-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTaxSchemesService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  deactivate: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaxSchemesController (integration)', () => {
  let controller: TaxSchemesController;
  let service: jest.Mocked<typeof mockTaxSchemesService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaxSchemesController],
      providers: [
        { provide: TaxSchemesService, useValue: mockTaxSchemesService },
      ],
    }).compile();

    controller = module.get<TaxSchemesController>(TaxSchemesController);
    service = module.get(TaxSchemesService) as jest.Mocked<typeof mockTaxSchemesService>;
  });

  // -----------------------------------------------------------------------
  // GET /tax-schemes
  // -----------------------------------------------------------------------
  describe('GET /tax-schemes', () => {
    it('should return all tax schemes', async () => {
      const schemes = [
        buildMockTaxScheme({ id: 'tax-1', code: 'IVA19' }),
        buildMockTaxScheme({ id: 'tax-2', code: 'IVA5' }),
      ];
      service.findAll.mockResolvedValue(schemes);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(schemes);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no tax schemes exist', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /tax-schemes/:id
  // -----------------------------------------------------------------------
  describe('GET /tax-schemes/:id', () => {
    it('should return tax scheme by id', async () => {
      const scheme = buildMockTaxScheme({ id: 'tax-123' });
      service.findById.mockResolvedValue(scheme);

      const result = await controller.findById('tax-123');

      expect(service.findById).toHaveBeenCalledWith('tax-123');
      expect(result).toEqual(scheme);
    });

    it('should propagate error when tax scheme not found', async () => {
      service.findById.mockRejectedValue(new Error('Tax scheme not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Tax scheme not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /tax-schemes
  // -----------------------------------------------------------------------
  describe('POST /tax-schemes', () => {
    const createDto = {
      code: 'IVA19',
      name: 'IVA 19%',
      taxType: 'IVA' as const,
      rate: '19.0000',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    };

    it('should call create with userId and dto', async () => {
      const created = buildMockTaxScheme({ id: 'new-tax-uuid' });
      service.create.mockResolvedValue(created);

      const user = buildMockUser();
      const result = await controller.create(createDto, user as any);

      expect(service.create).toHaveBeenCalledWith(user.id, createDto);
      expect(result).toEqual(created);
    });

    it('should propagate error when create throws DuplicateActiveTaxSchemeException', async () => {
      service.create.mockRejectedValue(
        new Error('Duplicate active tax scheme'),
      );

      const user = buildMockUser();
      await expect(
        controller.create(createDto, user as any),
      ).rejects.toThrow('Duplicate active tax scheme');
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /tax-schemes/:id/deactivate
  // -----------------------------------------------------------------------
  describe('PATCH /tax-schemes/:id/deactivate', () => {
    it('should call deactivate with the id', async () => {
      const deactivated = buildMockTaxScheme({
        id: 'tax-123',
        isActive: false,
        effectiveTo: new Date(),
      });
      service.deactivate.mockResolvedValue(deactivated);

      const result = await controller.deactivate('tax-123');

      expect(service.deactivate).toHaveBeenCalledWith('tax-123');
      expect(result).toEqual(deactivated);
    });

    it('should propagate error when deactivate throws', async () => {
      service.deactivate.mockRejectedValue(new Error('Tax scheme not found'));

      await expect(controller.deactivate('nonexistent')).rejects.toThrow(
        'Tax scheme not found',
      );
    });
  });
});
