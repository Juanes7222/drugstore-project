import {
  paginateWithCursor,
  type CursorPaginationInput,
} from './cursor-pagination';

type CursorModelStub = CursorPaginationInput<
  Record<string, unknown>
>['model'];

const ANCHOR_TIMESTAMP = '2026-06-01T10:00:00.000Z';

function createModelStub(rows: unknown[]): CursorModelStub {
  return {
    findMany: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(rows.length),
  } as unknown as CursorModelStub;
}

function encodeCursorPayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function decodeCursorPayload(raw: string): { lastUpdatedAt: string; lastId: string } {
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

// Rows ordered by ascending updatedAt, as an asc keyset walk reads them.
function buildTimeRows(count: number): Array<Record<string, unknown>> {
  const baseMs = new Date('2026-06-01T00:00:00Z').getTime();
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${index + 1}`,
    createdAt: new Date(baseMs + index * 60_000),
    updatedAt: new Date(baseMs + index * 3_600_000),
  }));
}

describe('paginateWithCursor', () => {
  describe('keyset condition', () => {
    it('walks forward with gt comparisons on updatedAt when direction is omitted', async () => {
      const model = createModelStub([]);
      const cursor = encodeCursorPayload({
        lastUpdatedAt: ANCHOR_TIMESTAMP,
        lastId: 'row-5',
      });

      await paginateWithCursor({ model, cursor, limit: 5 });

      expect(model.findMany as jest.Mock).toHaveBeenCalledWith({
        where: {
          OR: [
            { updatedAt: { gt: new Date(ANCHOR_TIMESTAMP) } },
            { updatedAt: new Date(ANCHOR_TIMESTAMP), id: { gt: 'row-5' } },
          ],
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: 6,
      });
    });

    it('flips to lt comparisons on the timeField and id when direction is desc', async () => {
      const model = createModelStub([]);
      const cursor = encodeCursorPayload({
        lastUpdatedAt: ANCHOR_TIMESTAMP,
        lastId: 'row-5',
      });

      await paginateWithCursor({
        model,
        cursor,
        limit: 5,
        timeField: 'createdAt',
        direction: 'desc',
      });

      expect(model.findMany as jest.Mock).toHaveBeenCalledWith({
        where: {
          OR: [
            { createdAt: { lt: new Date(ANCHOR_TIMESTAMP) } },
            { createdAt: new Date(ANCHOR_TIMESTAMP), id: { lt: 'row-5' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 6,
      });
    });
  });

  describe('cursor decoding', () => {
    it('round-trips a createdAt cursor through nextCursor back into the keyset condition', async () => {
      // First page: three rows exist, page of two → nextCursor encodes row-2.
      const rows = buildTimeRows(3);
      const firstModel = createModelStub(rows);

      const firstPage = await paginateWithCursor({
        model: firstModel,
        limit: 2,
        timeField: 'createdAt',
      });

      expect(firstPage.hasMore).toBe(true);
      expect(decodeCursorPayload(firstPage.nextCursor as string)).toEqual({
        lastUpdatedAt: (rows[1]['createdAt'] as Date).toISOString(),
        lastId: 'row-2',
      });

      // The produced opaque string must decode into the exact keyset
      // position it was built from.
      const secondModel = createModelStub([]);
      await paginateWithCursor({
        model: secondModel,
        limit: 2,
        timeField: 'createdAt',
        cursor: firstPage.nextCursor,
      });

      expect(secondModel.findMany as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { createdAt: { gt: rows[1]['createdAt'] as Date } },
              { createdAt: rows[1]['createdAt'] as Date, id: { gt: 'row-2' } },
            ],
          },
        }),
      );
    });

    it('treats an undecodable cursor as the first page and merges input where instead', async () => {
      const model = createModelStub([]);
      // Valid base64 whose decoded bytes are not JSON at all.
      const cursor = Buffer.from('<html-error-page>', 'utf8').toString('base64');

      await paginateWithCursor({
        model,
        cursor,
        where: { isActive: true },
      });

      expect(model.findMany as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
        }),
      );
      const callArgs = (model.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty('OR');
    });

    it('treats a base64 payload missing required keys as the first page', async () => {
      const model = createModelStub([]);
      const cursor = encodeCursorPayload({ foo: 'bar' });

      await paginateWithCursor({
        model,
        cursor,
        where: { isActive: true },
      });

      const callArgs = (model.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toEqual({ isActive: true });
      expect(callArgs.where).not.toHaveProperty('OR');
    });
  });

  describe('page detection', () => {
    it('fetches limit+1 rows, reports hasMore and trims the page when more rows exist', async () => {
      const rows = buildTimeRows(3);
      const model = createModelStub(rows);

      const page = await paginateWithCursor({ model, limit: 2 });

      expect((model.findMany as jest.Mock).mock.calls[0][0].take).toBe(3);
      expect(page.items).toEqual(rows.slice(0, 2));
      expect(page.hasMore).toBe(true);
      expect(decodeCursorPayload(page.nextCursor as string)).toEqual({
        lastUpdatedAt: (rows[1]['updatedAt'] as Date).toISOString(),
        lastId: 'row-2',
      });
    });

    it('returns all items with null nextCursor when the result is the last page', async () => {
      const rows = buildTimeRows(3);
      const model = createModelStub(rows);

      const page = await paginateWithCursor({ model, limit: 3 });

      expect(page.items).toEqual(rows);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('argument forwarding', () => {
    it('forwards include verbatim when provided and omits the key otherwise', async () => {
      const model = createModelStub(buildTimeRows(1));
      const include = { lot: { select: { id: true } } };

      await paginateWithCursor({ model, limit: 1, include });

      const callArgs = (model.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.include).toEqual(include);

      const bareModel = createModelStub(buildTimeRows(1));
      await paginateWithCursor({ model: bareModel, limit: 1 });

      const bareArgs = (bareModel.findMany as jest.Mock).mock.calls[0][0];
      expect(bareArgs).not.toHaveProperty('include');
    });
  });
});
