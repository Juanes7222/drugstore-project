// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockCategory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cat-uuid-1',
    name: 'Analgésicos',
    sortOrder: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCategoriesService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CategoriesController (integration)', () => {
  let controller: CategoriesController;
  let service: jest.Mocked<typeof mockCategoriesService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        { provide: CategoriesService, useValue: mockCategoriesService },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
    service = module.get(CategoriesService) as jest.Mocked<typeof mockCategoriesService>;
  });

  // -----------------------------------------------------------------------
  // GET /categories
  // -----------------------------------------------------------------------
  describe('GET /categories', () => {
    it('should return all categories', async () => {
      const categories = [
        buildMockCategory({ id: 'cat-1', name: 'Analgésicos' }),
        buildMockCategory({ id: 'cat-2', name: 'Antibióticos' }),
      ];
      service.findAll.mockResolvedValue(categories);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(categories);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no categories exist', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // GET /categories/:id
  // -----------------------------------------------------------------------
  describe('GET /categories/:id', () => {
    it('should return category by id', async () => {
      const category = buildMockCategory({ id: 'cat-123' });
      service.findById.mockResolvedValue(category);

      const result = await controller.findById('cat-123');

      expect(service.findById).toHaveBeenCalledWith('cat-123');
      expect(result).toEqual(category);
    });

    it('should propagate error when category not found', async () => {
      service.findById.mockRejectedValue(new Error('Category not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Category not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /categories
  // -----------------------------------------------------------------------
  describe('POST /categories', () => {
    const createDto = { name: 'Antiinflamatorios', sortOrder: 3 };

    it('should call create with the dto and return the created category', async () => {
      const created = buildMockCategory({
        id: 'new-cat-uuid',
        name: 'Antiinflamatorios',
        sortOrder: 3,
      });
      service.create.mockResolvedValue(created);

      const result = await controller.create(createDto);

      expect(service.create).toHaveBeenCalledWith(createDto);
      expect(result).toEqual(created);
    });

    it('should propagate error when create throws', async () => {
      service.create.mockRejectedValue(new Error('Duplicate category name'));

      await expect(controller.create(createDto)).rejects.toThrow(
        'Duplicate category name',
      );
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /categories/:id
  // -----------------------------------------------------------------------
  describe('PATCH /categories/:id', () => {
    const updateDto = { name: 'Analgésicos Actualizado', sortOrder: 2 };

    it('should call update with id and dto', async () => {
      const updated = buildMockCategory({
        id: 'cat-123',
        name: 'Analgésicos Actualizado',
      });
      service.update.mockResolvedValue(updated);

      const result = await controller.update('cat-123', updateDto);

      expect(service.update).toHaveBeenCalledWith('cat-123', updateDto);
      expect(result).toEqual(updated);
    });
  });
});
