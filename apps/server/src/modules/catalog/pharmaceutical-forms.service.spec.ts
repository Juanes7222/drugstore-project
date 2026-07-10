// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PharmaceuticalFormsService } from './pharmaceutical-forms.service';

describe('PharmaceuticalFormsService', () => {
  let service: PharmaceuticalFormsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new PharmaceuticalFormsService(prisma as any);
  });

  // ── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all forms ordered by sortOrder ascending', async () => {
      const mockForms = [
        { id: 'f1', name: 'Tableta', sortOrder: 1 },
        { id: 'f2', name: 'Jarabe', sortOrder: 2 },
      ];
      (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue(mockForms);

      const result = await service.findAll();

      expect(result).toEqual(mockForms);
      expect(prisma.pharmaceuticalForm.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { sortOrder: 'asc' } }),
      );
    });

    it('returns empty array when no forms exist', async () => {
      (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the form when found', async () => {
      const mockForm = { id: 'f1', name: 'Tableta' };
      (prisma.pharmaceuticalForm.findUnique as jest.Mock).mockResolvedValue(mockForm);

      const result = await service.findById('f1');

      expect(result).toEqual(mockForm);
      expect(prisma.pharmaceuticalForm.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'f1' } }),
      );
    });

    it('returns null when not found', async () => {
      (prisma.pharmaceuticalForm.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result).toBeNull();
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a pharmaceutical form with default sortOrder when not provided', async () => {
      const dto = { name: 'Cápsula' };
      const created = { id: 'new-id', name: 'Cápsula', sortOrder: 0, isActive: true };
      (prisma.pharmaceuticalForm.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(prisma.pharmaceuticalForm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Cápsula', sortOrder: 0, isActive: true }),
        }),
      );
    });

    it('creates with provided sortOrder', async () => {
      const dto = { name: 'Inyectable', sortOrder: 5 };
      const created = { id: 'new-id', name: 'Inyectable', sortOrder: 5, isActive: true };
      (prisma.pharmaceuticalForm.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(prisma.pharmaceuticalForm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Inyectable', sortOrder: 5 }),
        }),
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates only provided fields', async () => {
      const dto = { name: 'Tableta Recubierta' };
      const updated = { id: 'f1', name: 'Tableta Recubierta', sortOrder: 1, isActive: true };
      (prisma.pharmaceuticalForm.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.update('f1', dto);

      expect(result).toEqual(updated);
      expect(prisma.pharmaceuticalForm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'f1' },
          data: expect.objectContaining({ name: 'Tableta Recubierta' }),
        }),
      );
    });

    it('updates isActive when provided', async () => {
      const dto = { isActive: false };
      const updated = { id: 'f1', name: 'Tableta', isActive: false };
      (prisma.pharmaceuticalForm.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.update('f1', dto);

      expect(result.isActive).toBe(false);
    });
  });
});
