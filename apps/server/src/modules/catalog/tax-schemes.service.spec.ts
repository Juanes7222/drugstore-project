// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      Decimal: jest
        .fn()
        .mockImplementation(
          (v: string) => ({ value: v, toString: () => v }) as any,
        ),
    },
  };
});

import { TaxSchemesService } from './tax-schemes.service';
import { DuplicateActiveTaxSchemeException } from './exceptions/duplicate-active-tax-scheme.exception';

function buildTaxScheme(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tax-uuid-1',
    code: 'IVA19',
    name: 'IVA 19%',
    taxType: 'IVA',
    rate: { value: '19.00' },
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    isActive: true,
    createdById: 'user-uuid-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const mockTaxSchemeModel = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPrisma = {
  taxScheme: mockTaxSchemeModel,
} as any;

describe('TaxSchemesService', () => {
  let service: TaxSchemesService;
  const USER_ID = 'user-uuid-1';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaxSchemesService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return all tax schemes ordered by createdAt descending', async () => {
      const schemes = [
        buildTaxScheme({ id: 't1', code: 'IVA19' }),
        buildTaxScheme({ id: 't2', code: 'INC8' }),
      ];
      mockTaxSchemeModel.findMany.mockResolvedValue(schemes);

      const result = await service.findAll();

      expect(result).toEqual(schemes);
      expect(mockTaxSchemeModel.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return an empty array when no tax schemes exist', async () => {
      mockTaxSchemeModel.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return the tax scheme when found', async () => {
      const scheme = buildTaxScheme();
      mockTaxSchemeModel.findUnique.mockResolvedValue(scheme);

      const result = await service.findById('tax-uuid-1');

      expect(result).toEqual(scheme);
      expect(mockTaxSchemeModel.findUnique).toHaveBeenCalledWith({
        where: { id: 'tax-uuid-1' },
      });
    });

    it('should return null when tax scheme is not found', async () => {
      mockTaxSchemeModel.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const dto = {
      code: 'IVA19',
      name: 'IVA 19%',
      taxType: 'IVA' as const,
      rate: '19.00',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    };

    it('should create a tax scheme with all provided data', async () => {
      const scheme = buildTaxScheme();
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(scheme);

      const result = await service.create(USER_ID, dto as any);

      expect(result).toEqual(scheme);
    });

    it('should check for existing active tax scheme before creating', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(buildTaxScheme());

      await service.create(USER_ID, dto as any);

      expect(mockTaxSchemeModel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            code: 'IVA19',
            effectiveTo: null,
          }),
        }),
      );
    });

    it('should throw DuplicateActiveTaxSchemeException when active scheme exists', async () => {
      const existing = buildTaxScheme();
      mockTaxSchemeModel.findFirst.mockResolvedValue(existing);

      await expect(service.create(USER_ID, dto as any)).rejects.toThrow(
        DuplicateActiveTaxSchemeException,
      );
    });

    it('should throw with the correct code and rate in the error', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(buildTaxScheme());

      await expect(service.create(USER_ID, dto as any)).rejects.toThrow(
        'IVA19',
      );
    });

    it('should generate an id using uuid format', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(buildTaxScheme());

      await service.create(USER_ID, dto as any);

      const createCall = mockTaxSchemeModel.create.mock.calls[0][0];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(createCall.data.id).toMatch(uuidRegex);
    });

    it('should create with the provided effectiveFrom as a Date', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(buildTaxScheme());

      await service.create(USER_ID, dto as any);

      const createCall = mockTaxSchemeModel.create.mock.calls[0][0];
      expect(createCall.data.effectiveFrom).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
    });

    it('should set isActive to true by default', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(buildTaxScheme());

      await service.create(USER_ID, dto as any);

      const createCall = mockTaxSchemeModel.create.mock.calls[0][0];
      expect(createCall.data.isActive).toBe(true);
    });

    it('should store the createdById', async () => {
      mockTaxSchemeModel.findFirst.mockResolvedValue(null);
      mockTaxSchemeModel.create.mockResolvedValue(buildTaxScheme());

      await service.create(USER_ID, dto as any);

      const createCall = mockTaxSchemeModel.create.mock.calls[0][0];
      expect(createCall.data.createdById).toBe(USER_ID);
    });
  });

  describe('deactivate', () => {
    it('should set effectiveTo and isActive to false', async () => {
      const deactivated = buildTaxScheme({
        effectiveTo: new Date(),
        isActive: false,
      });
      mockTaxSchemeModel.update.mockResolvedValue(deactivated);

      const result = await service.deactivate('tax-uuid-1');

      expect(result).toEqual(deactivated);
      expect(mockTaxSchemeModel.update).toHaveBeenCalledWith({
        where: { id: 'tax-uuid-1' },
        data: {
          effectiveTo: expect.any(Date),
          isActive: false,
          updatedAt: expect.any(Date),
        },
      });
    });
  });
});
