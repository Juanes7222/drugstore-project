import { searchIdsIgnoringAccents } from './accent-insensitive-search';

describe('searchIdsIgnoringAccents', () => {
  let prisma: { $queryRawUnsafe: jest.Mock };

  beforeEach(() => {
    prisma = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ id: 'row-1' }, { id: 'row-2' }]),
    };
  });

  it('rejects a table identifier that is not a bare SQL identifier', async () => {
    await expect(
      searchIdsIgnoringAccents(
        prisma as any,
        'Product"; DROP TABLE "Product',
        ['commercialName'],
        'dolex',
      ),
    ).rejects.toThrow('Invalid table identifier');
  });

  it('rejects an empty column list', async () => {
    await expect(
      searchIdsIgnoringAccents(prisma as any, 'Product', [], 'dolex'),
    ).rejects.toThrow('Invalid column identifiers');
  });

  it('rejects a column identifier that is not a bare SQL identifier', async () => {
    await expect(
      searchIdsIgnoringAccents(
        prisma as any,
        'Product',
        ['commercialName; DROP TABLE "Product"'],
        'dolex',
      ),
    ).rejects.toThrow('Invalid column identifiers');
  });

  it('queries ids with f_unaccent ILIKE clauses joined by OR and the default LIMIT', async () => {
    const result = await searchIdsIgnoringAccents(
      prisma as any,
      'Product',
      ['commercialName', 'internalCode'],
      'dolex',
    );

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      'SELECT id FROM "Product" WHERE f_unaccent("commercialName") ILIKE $1 OR f_unaccent("internalCode") ILIKE $2 LIMIT 5000',
      '%dolex%',
      '%dolex%',
    );
    expect(result).toEqual(['row-1', 'row-2']);
  });

  it('binds the term only as a %term% parameter, never inline in the SQL text', async () => {
    await searchIdsIgnoringAccents(prisma as any, 'Client', ['fullName'], "O'Brien%");

    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).not.toContain("O'Brien%");
    expect(params).toEqual(["%O'Brien%%"]);
  });

  it('forwards maxIds as the SQL LIMIT', async () => {
    await searchIdsIgnoringAccents(
      prisma as any,
      'Supplier',
      ['businessName'],
      'pharma',
      100,
    );

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toBe(
      'SELECT id FROM "Supplier" WHERE f_unaccent("businessName") ILIKE $1 LIMIT 100',
    );
  });
});
