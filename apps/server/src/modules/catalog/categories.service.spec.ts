// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { CategoriesService } from './categories.service';

function buildCategory(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat-uuid-1',
    name: 'Analgesics',
    sortOrder: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const mockCategoryModel = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPrisma = {
  category: mockCategoryModel,
} as any;

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CategoriesService(mockPrisma);
  });

  describe('findAll', () => {
    it('should return all categories ordered by sortOrder ascending', async () => {
      const categories = [
        buildCategory({ id: 'c1', name: 'Antibiotics', sortOrder: 1 }),
        buildCategory({ id: 'c2', name: 'Analgesics', sortOrder: 2 }),
      ];
      mockCategoryModel.findMany.mockResolvedValue(categories);

      const result = await service.findAll();

      expect(result).toEqual(categories);
      expect(mockCategoryModel.findMany).toHaveBeenCalledWith({
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('should return an empty array when no categories exist', async () => {
      mockCategoryModel.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return the category when found', async () => {
      const category = buildCategory();
      mockCategoryModel.findUnique.mockResolvedValue(category);

      const result = await service.findById('cat-uuid-1');

      expect(result).toEqual(category);
      expect(mockCategoryModel.findUnique).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
      });
    });

    it('should return null when category is not found', async () => {
      mockCategoryModel.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    const dto = { name: 'Anti-inflammatories', sortOrder: 3 };

    it('should create a category with the provided name and sortOrder', async () => {
      const category = buildCategory({
        name: 'Anti-inflammatories',
        sortOrder: 3,
      });
      mockCategoryModel.create.mockResolvedValue(category);

      const result = await service.create(dto as any);

      expect(result).toEqual(category);
    });

    it('should generate an id using uuid format', async () => {
      mockCategoryModel.create.mockResolvedValue(buildCategory());

      await service.create(dto as any);

      const createCall = mockCategoryModel.create.mock.calls[0][0];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(createCall.data.id).toMatch(uuidRegex);
    });

    it('should default sortOrder to 0 when not provided', async () => {
      mockCategoryModel.create.mockResolvedValue(buildCategory());

      await service.create({ name: 'General' } as any);

      const createCall = mockCategoryModel.create.mock.calls[0][0];
      expect(createCall.data.sortOrder).toBe(0);
    });

    it('should set isActive to true by default', async () => {
      mockCategoryModel.create.mockResolvedValue(buildCategory());

      await service.create(dto as any);

      const createCall = mockCategoryModel.create.mock.calls[0][0];
      expect(createCall.data.isActive).toBe(true);
    });

    it('should set createdAt and updatedAt to Date objects', async () => {
      mockCategoryModel.create.mockResolvedValue(buildCategory());

      await service.create(dto as any);

      const createCall = mockCategoryModel.create.mock.calls[0][0];
      expect(createCall.data.createdAt).toBeInstanceOf(Date);
      expect(createCall.data.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('should update only the provided fields', async () => {
      const updated = buildCategory({ name: 'Updated Name' });
      mockCategoryModel.update.mockResolvedValue(updated);

      const result = await service.update('cat-uuid-1', {
        name: 'Updated Name',
      } as any);

      expect(result.name).toBe('Updated Name');
      expect(mockCategoryModel.update).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
        data: expect.objectContaining({
          name: 'Updated Name',
          updatedAt: expect.any(Date),
        }),
      });
    });

    it('should not include undefined fields in the update payload', async () => {
      mockCategoryModel.update.mockResolvedValue(buildCategory());

      await service.update('cat-uuid-1', {} as any);

      const data = (mockCategoryModel.update as jest.Mock).mock.calls[0][0]
        .data;
      expect(Object.keys(data)).toEqual(['updatedAt']);
    });

    it('should update sortOrder when provided', async () => {
      mockCategoryModel.update.mockResolvedValue(
        buildCategory({ sortOrder: 5 }),
      );

      await service.update('cat-uuid-1', { sortOrder: 5 } as any);

      expect(mockCategoryModel.update).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
        data: expect.objectContaining({ sortOrder: 5 }),
      });
    });

    it('should allow deactivating a category', async () => {
      mockCategoryModel.update.mockResolvedValue(
        buildCategory({ isActive: false }),
      );

      await service.update('cat-uuid-1', { isActive: false } as any);

      expect(mockCategoryModel.update).toHaveBeenCalledWith({
        where: { id: 'cat-uuid-1' },
        data: expect.objectContaining({ isActive: false }),
      });
    });
  });
});
