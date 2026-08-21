// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: { Decimal: class {} },
  ImportSourceFormat: { CSV: 'CSV', XLSX: 'XLSX', JSON: 'JSON' },
}));

import { ImportDefinitionRegistry } from './import-definition-registry';
import { ImportDefinitionNotFoundException } from './exceptions/import-definition-not-found.exception';

function buildFakeDefinition(entityKey: string) {
  return {
    entityKey,
    entityLabel: entityKey.toUpperCase(),
    auditModule: 'CATALOG',
    columns: [
      { key: 'a', label: 'A', aliases: [], required: true, description: '' },
    ],
    mapColumns: jest.fn(),
    validate: jest.fn(),
    createOne: jest.fn(),
    findConflicts: jest.fn(),
  } as any;
}

describe('ImportDefinitionRegistry', () => {
  let registry: ImportDefinitionRegistry;

  beforeEach(() => {
    registry = new ImportDefinitionRegistry(
      buildFakeDefinition('products'),
      buildFakeDefinition('clients'),
    );
  });

  describe('get', () => {
    it('returns the definition registered for the entity key', () => {
      const definition = registry.get('products');

      expect(definition.entityKey).toBe('products');
    });

    it('throws ImportDefinitionNotFoundException for unknown keys', () => {
      expect(() => registry.get('unknown')).toThrow(
        ImportDefinitionNotFoundException,
      );
    });
  });

  describe('list', () => {
    it('exposes entity keys, labels and columns for every definition', () => {
      const list = registry.list();

      expect(list).toHaveLength(2);
      expect(list[0]).toEqual(
        expect.objectContaining({
          entityKey: 'products',
          entityLabel: 'PRODUCTS',
          columns: expect.any(Array),
        }),
      );
      expect(list[1].entityKey).toBe('clients');
    });
  });
});
