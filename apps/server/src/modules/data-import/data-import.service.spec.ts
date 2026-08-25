// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { Job } from 'bullmq';
import {
  PrismaClient,
  DataImportRowStatus,
  DataImportStatus,
  ImportSourceFormat,
} from '@pharmacy/database';
import { DataImportService } from './data-import.service';
import type { DataImportJobData } from './data-import-job';
import { SaleType } from '@pharmacy/shared-types';
import { ProductImportDefinition } from './product-import.definition';
import { ClientImportDefinition } from './client-import.definition';
import { CsvSourceAdapter } from './csv-source.adapter';
import { ExcelSourceAdapter } from './excel-source.adapter';
import { JsonSourceAdapter } from './json-source.adapter';
import { ImportValidationException } from './exceptions/import-validation.exception';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import { ImportRowRejectedException } from './exceptions/import-row-rejected.exception';
import { ImportExecutionFailedException } from './exceptions/import-execution-failed.exception';
import { ImportNotFoundException } from './exceptions/import-not-found.exception';
import { ImportDefinitionNotFoundException } from './exceptions/import-definition-not-found.exception';
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_JOB_NAME,
} from './constants/import.constants';

const PRODUCT_HEADERS = [
  'Codigo interno',
  'Nombre comercial',
  'Laboratorio',
  'Precio de venta',
  'Impuesto',
];

const CLIENT_HEADERS = [
  'Nombre completo',
  'Tipo de documento',
  'Numero de documento',
  'Correo',
];

function buildCsv(headers: string[], rows: string[][]): Buffer {
  const lines = [headers.join(';'), ...rows.map((row) => row.join(';'))];
  return Buffer.from(lines.join('\n'), 'utf8');
}

function buildProductRows(count: number): string[][] {
  return Array.from({ length: count }, (_, index) => [
    `P-${index + 1}`,
    `Producto ${index + 1}`,
    'Genfar',
    '12500.50',
    'IVA 19%',
  ]);
}

function buildJobData(buffer: Buffer): DataImportJobData {
  return {
    importId: 'import-1',
    entityKey: 'products',
    format: ImportSourceFormat.CSV,
    fileName: 'products.csv',
    subscriptionId: 'sub-test',
    userId: 'user-1',
    userRole: 'MANAGER',
    fileBase64: buffer.toString('base64'),
  };
}

function buildJob(data: DataImportJobData) {
  return {
    id: 'job-1',
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };
}

/** mockDeep auto-creates mocks for any accessed property, so withTenant
 * (a PrismaService method not present on PrismaClient) is a jest.Mock too. */
type PrismaMock = DeepMockProxy<PrismaClient> & {
  withTenant: jest.Mock;
};

describe('DataImportService', () => {
  let prisma: PrismaMock;
  let tx: PrismaMock;
  let service: DataImportService;
  let productDefinition: ProductImportDefinition;
  let clientDefinition: ClientImportDefinition;
  let productsService: { createProduct: jest.Mock };
  let clientsService: { create: jest.Mock };
  let registry: { get: jest.Mock; list: jest.Mock };
  let importsQueue: { add: jest.Mock };
  let parseCache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let csvAdapter: CsvSourceAdapter;

  const tenantContext = { getSubscriptionId: jest.fn(() => 'sub-test') };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>() as unknown as PrismaMock;
    tx = mockDeep<PrismaClient>() as unknown as PrismaMock;
    importsQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    // The default cache miss (get -> null) keeps every existing test on the
    // re-parse path; only the cache-specific tests override it.
    parseCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    productsService = { createProduct: jest.fn() };
    clientsService = { create: jest.fn() };
    productDefinition = new ProductImportDefinition(
      prisma as any,
      tenantContext as any,
      productsService as any,
    );
    clientDefinition = new ClientImportDefinition(
      prisma as any,
      clientsService as any,
    );
    registry = { get: jest.fn(), list: jest.fn() };
    registry.get.mockImplementation((entityKey: string) => {
      if (entityKey === 'products') return productDefinition;
      if (entityKey === 'clients') return clientDefinition;
      throw new ImportDefinitionNotFoundException(entityKey);
    });
    csvAdapter = new CsvSourceAdapter();
    service = new DataImportService(
      prisma as any,
      tenantContext as any,
      registry as any,
      importsQueue as any,
      parseCache as any,
      csvAdapter,
      new ExcelSourceAdapter(),
      new JsonSourceAdapter(),
    );
    // withTenant executes its callback with the tx mock on every call (outer
    // lookup, per-chunk transactions and finalize all route through it).
    prisma.withTenant.mockImplementation(
      async (_sub: string, fn: (client: PrismaMock) => Promise<void>) => fn(tx),
    );
    (prisma.category.findFirst as jest.Mock).mockResolvedValue({ id: 'cat-1' });
    (prisma.pharmaceuticalForm.findFirst as jest.Mock).mockResolvedValue({
      id: 'form-1',
    });
    (prisma.taxScheme.findFirst as jest.Mock).mockResolvedValue({
      id: 'tax-1',
    });
    // ProductImportDefinition.prepare() resolves refs in batch via findMany.
    (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.category.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.taxScheme.findMany as jest.Mock).mockResolvedValue([
      { id: 'tax-1', name: 'IVA 19%' },
    ]);
    (prisma.dataImport.create as jest.Mock).mockResolvedValue({
      id: 'import-1',
    });
    (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue({
      id: 'import-1',
      status: DataImportStatus.PROCESSING,
    });
    (prisma.dataImportRow.aggregate as jest.Mock).mockResolvedValue({
      _max: { rowNumber: null },
    });
    (prisma.dataImport.delete as jest.Mock).mockResolvedValue({});
    (tx.dataImportRow.createMany as jest.Mock).mockResolvedValue({ count: 0 });
    (tx.dataImportRow.count as jest.Mock).mockResolvedValue(0);
    (tx.dataImport.update as jest.Mock).mockResolvedValue({});
    (tx.auditLog.create as jest.Mock).mockResolvedValue({});
  });

  describe('preview', () => {
    it('returns per-row counts, a bounded sample and no errors for a clean file', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(8));

      const result = await service.preview(
        { entityKey: 'products' },
        buffer,
        'products.csv',
      );

      expect(result.entityKey).toBe('products');
      expect(result.entityLabel).toBe('Products');
      expect(result.format).toBe(ImportSourceFormat.CSV);
      expect(result.fileName).toBe('products.csv');
      expect(result.totalRows).toBe(8);
      expect(result.validRows).toBe(8);
      expect(result.errorRows).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.validSample).toHaveLength(5);
      expect(result.validSample[0].rowNumber).toBe(2);
      expect(result.validSample[4].rowNumber).toBe(6);
      expect(result.unmatchedHeaders).toEqual([]);
    });

    it('reports unmatched headers that no definition column consumes', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(
        [...PRODUCT_HEADERS, 'Columna extra'],
        [['P-1', 'A', 'L', '1000', 'IVA 19%', 'x']],
      );

      const result = await service.preview(
        { entityKey: 'products' },
        buffer,
        'products.csv',
      );

      expect(result.unmatchedHeaders).toEqual(['Columna extra']);
    });

    it('flags rows whose internalCode already exists as conflicts', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([
        { internalCode: 'P-1' },
      ]);
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(8));

      const result = await service.preview(
        { entityKey: 'products' },
        buffer,
        'products.csv',
      );

      expect(result.validRows).toBe(7);
      expect(result.errorRows).toBe(1);
      expect(result.errors).toEqual([
        {
          rowNumber: 2,
          issues: [
            {
              path: 'internalCode',
              message: 'El codigo interno "P-1" ya existe en el sistema',
            },
          ],
        },
      ]);
      expect(result.validSample[0].rowNumber).toBe(3);
    });

    it('reports per-row validation errors with row numbers', async () => {
      (prisma.client.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(CLIENT_HEADERS, [
        ['Ana', 'cedula', '123', 'ana@email.com'],
        ['Bob', 'cc', '456', 'correo-invalido'],
      ]);

      const result = await service.preview(
        { entityKey: 'clients' },
        buffer,
        'clients.csv',
      );

      expect(result.totalRows).toBe(2);
      expect(result.validRows).toBe(1);
      expect(result.errorRows).toBe(1);
      expect(result.errors[0].rowNumber).toBe(3);
      expect(
        result.errors[0].issues.some((issue) => issue.path === 'email'),
      ).toBe(true);
      expect(result.validSample[0].rowNumber).toBe(2);
    });

    it('throws ImportFileInvalidException when required columns are missing', async () => {
      const buffer = buildCsv(
        ['Nombre comercial', 'Laboratorio', 'Precio de venta', 'Impuesto'],
        [['A', 'L', '1000', 'IVA 19%']],
      );

      await expect(
        service.preview({ entityKey: 'products' }, buffer, 'products.csv'),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException when the file exceeds MAX_IMPORT_ROWS', async () => {
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(5001));

      await expect(
        service.preview({ entityKey: 'products' }, buffer, 'products.csv'),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException for an empty buffer', async () => {
      await expect(
        service.preview({ entityKey: 'products' }, Buffer.alloc(0), 'p.csv'),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportDefinitionNotFoundException for an unknown entity', async () => {
      const buffer = buildCsv(PRODUCT_HEADERS, [
        ['P-1', 'A', 'L', '1000', 'IVA'],
      ]);

      await expect(
        service.preview({ entityKey: 'unknown' }, buffer, 'p.csv'),
      ).rejects.toThrow(ImportDefinitionNotFoundException);
    });

    it('honours an explicit format override instead of sniffing the extension', async () => {
      await expect(
        service.preview(
          { entityKey: 'products', format: ImportSourceFormat.XLSX },
          buildCsv(PRODUCT_HEADERS, buildProductRows(1)),
          'products.csv',
        ),
      ).rejects.toThrow(ImportFileInvalidException);
    });
  });

  describe('execute', () => {
    it('creates a PROCESSING record, enqueues the job and returns 202 without writing rows', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));

      const result = await service.execute(
        { entityKey: 'products' },
        buffer,
        'products.csv',
        'user-1',
        'MANAGER',
      );

      expect(result).toEqual(
        expect.objectContaining({
          entityKey: 'products',
          entityLabel: 'Products',
          fileName: 'products.csv',
          format: ImportSourceFormat.CSV,
          totalRows: 2,
          validRows: 2,
          errorRows: 0,
          errors: [],
          status: DataImportStatus.PROCESSING,
        }),
      );
      expect(prisma.dataImport.create).toHaveBeenCalledWith({
        data: {
          id: result.importId,
          subscriptionId: 'sub-test',
          entityKey: 'products',
          sourceFormat: ImportSourceFormat.CSV,
          fileName: 'products.csv',
          totalRows: 2,
          validRows: 0,
          errorRows: 0,
          status: DataImportStatus.PROCESSING,
          createdById: 'user-1',
        },
      });
      expect(importsQueue.add).toHaveBeenCalledTimes(1);
      expect(importsQueue.add).toHaveBeenCalledWith(
        IMPORT_JOB_NAME,
        {
          importId: result.importId,
          entityKey: 'products',
          format: ImportSourceFormat.CSV,
          fileName: 'products.csv',
          subscriptionId: 'sub-test',
          userId: 'user-1',
          userRole: 'MANAGER',
          fileBase64: buffer.toString('base64'),
        },
        {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 50,
          removeOnFail: 200,
        },
      );
      // No synchronous writes: the worker owns entity and row creation.
      expect(productsService.createProduct).not.toHaveBeenCalled();
      expect(tx.dataImportRow.createMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it('throws ImportValidationException and writes nothing when any row is invalid', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(PRODUCT_HEADERS, [
        ['P-1', 'A', 'L', '12500.50', 'IVA 19%'],
        ['P-2', 'B', 'L', '12.500', 'IVA 19%'],
      ]);

      const promise = service.execute(
        { entityKey: 'products' },
        buffer,
        'products.csv',
        'user-1',
        'MANAGER',
      );

      await expect(promise).rejects.toThrow(ImportValidationException);
      await expect(promise).rejects.toMatchObject({
        failure: {
          totalRows: 2,
          validRows: 1,
          errorRows: 1,
          errors: [{ rowNumber: 3, issues: expect.any(Array) }],
        },
      });
      expect(prisma.dataImport.create).not.toHaveBeenCalled();
      expect(importsQueue.add).not.toHaveBeenCalled();
    });

    it('deletes the PROCESSING record and throws ImportExecutionFailedException when enqueuing fails', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      importsQueue.add.mockRejectedValue(new Error('redis down'));
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(1));

      const promise = service.execute(
        { entityKey: 'products' },
        buffer,
        'products.csv',
        'user-1',
        'MANAGER',
      );

      await expect(promise).rejects.toThrow(ImportExecutionFailedException);
      await expect(promise).rejects.toThrow(
        'Failed to enqueue import job: redis down',
      );
      expect(prisma.dataImport.delete).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
      });
    });

    it('enqueues a null userRole in the job when the caller has no role', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(1));

      await service.execute(
        { entityKey: 'products' },
        buffer,
        'products.csv',
        'user-1',
        null,
      );

      expect(importsQueue.add).toHaveBeenCalledWith(
        IMPORT_JOB_NAME,
        expect.objectContaining({ userRole: null }),
        expect.any(Object),
      );
    });
  });

  describe('processImportJob', () => {
    it('processes the file in IMPORT_CHUNK_SIZE chunks with a transaction per chunk and finalizes', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (tx.dataImportRow.count as jest.Mock)
        .mockResolvedValueOnce(245)
        .mockResolvedValueOnce(5);
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(250));
      const job = buildJob(buildJobData(buffer));
      const findConflictsSpy = jest.spyOn(productDefinition, 'findConflicts');
      const prepareSpy = jest.spyOn(productDefinition, 'prepare');

      await service.processImportJob(job.data, job as unknown as Job);

      const chunkSize = IMPORT_CHUNK_SIZE;
      expect(productsService.createProduct).toHaveBeenCalledTimes(250);
      expect(findConflictsSpy).toHaveBeenCalledTimes(2);
      expect(prepareSpy).toHaveBeenCalledTimes(2);
      expect(findConflictsSpy).toHaveBeenNthCalledWith(
        1,
        { subscriptionId: 'sub-test' },
        expect.arrayContaining([
          expect.objectContaining({ rowNumber: 2 }),
          expect.objectContaining({ rowNumber: chunkSize + 1 }),
        ]),
      );
      expect(findConflictsSpy).toHaveBeenNthCalledWith(
        2,
        { subscriptionId: 'sub-test' },
        expect.arrayContaining([
          expect.objectContaining({ rowNumber: chunkSize + 2 }),
        ]),
      );
      expect(tx.dataImportRow.createMany).toHaveBeenCalledTimes(2);
      const firstCreateMany = (tx.dataImportRow.createMany as jest.Mock).mock
        .calls[0][0];
      const secondCreateMany = (tx.dataImportRow.createMany as jest.Mock).mock
        .calls[1][0];
      expect(firstCreateMany.data).toHaveLength(chunkSize);
      expect(secondCreateMany.data).toHaveLength(50);
      expect(secondCreateMany.data[0]).toEqual(
        expect.objectContaining({
          importId: 'import-1',
          rowNumber: chunkSize + 2,
          status: DataImportRowStatus.VALID,
          entityId: 'prod-1',
        }),
      );
      expect(job.updateProgress).toHaveBeenNthCalledWith(1, {
        processed: chunkSize,
        total: 250,
      });
      expect(job.updateProgress).toHaveBeenNthCalledWith(2, {
        processed: 250,
        total: 250,
      });
      expect(tx.dataImportRow.count).toHaveBeenCalledWith({
        where: { importId: 'import-1', status: DataImportRowStatus.VALID },
      });
      expect(tx.dataImportRow.count).toHaveBeenCalledWith({
        where: { importId: 'import-1', status: DataImportRowStatus.ERROR },
      });
      expect(tx.dataImport.update).toHaveBeenCalledWith({
        where: { id: 'import-1' },
        data: {
          status: DataImportStatus.COMPLETED,
          validRows: 245,
          errorRows: 5,
          failureReason: null,
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'IMPORT',
          module: 'CATALOG',
          entityType: 'DataImport',
          entityId: 'import-1',
          details: JSON.stringify({
            entityKey: 'products',
            validRows: 245,
            errorRows: 5,
          }),
          userId: 'user-1',
          userRole: 'MANAGER',
        }),
      });
      expect(parseCache.del).toHaveBeenCalledWith('import-1');
    });

    it('marks the import FAILED with validation errors as ERROR rows without throwing', async () => {
      const buffer = buildCsv(PRODUCT_HEADERS, [
        ['P-1', 'A', 'L', '12500.50', 'IVA 19%'],
        ['P-2', 'B', 'L', '12.500', 'IVA 19%'],
      ]);
      const job = buildJob(buildJobData(buffer));

      await expect(
        service.processImportJob(job.data, job as unknown as Job),
      ).resolves.toBeUndefined();

      expect(tx.dataImport.update).toHaveBeenCalledWith({
        where: { id: 'import-1' },
        data: {
          status: DataImportStatus.FAILED,
          failureReason: 'Validation failed: 1 of 2 rows contain errors',
        },
      });
      expect(tx.dataImportRow.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            importId: 'import-1',
            rowNumber: 3,
            status: DataImportRowStatus.ERROR,
            issues: expect.any(Array),
            rawData: expect.objectContaining({ 'Precio de venta': '12.500' }),
          }),
        ],
      });
      expect(productsService.createProduct).not.toHaveBeenCalled();
      expect(job.updateProgress).not.toHaveBeenCalled();
      expect(tx.dataImportRow.count).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
      expect(parseCache.set).toHaveBeenCalledWith(
        'import-1',
        expect.any(Object),
      );
      expect(parseCache.del).toHaveBeenCalledWith('import-1');
    });

    it('skips rows already recorded by an earlier attempt (resume) and only writes pending ones', async () => {
      (prisma.dataImportRow.aggregate as jest.Mock).mockResolvedValue({
        _max: { rowNumber: 5 },
      });
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(8));
      const job = buildJob(buildJobData(buffer));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(productsService.createProduct).toHaveBeenCalledTimes(4);
      expect(tx.dataImportRow.createMany).toHaveBeenCalledTimes(1);
      const createManyData = (tx.dataImportRow.createMany as jest.Mock).mock
        .calls[0][0].data;
      expect(createManyData).toHaveLength(4);
      expect(
        createManyData.map((row: { rowNumber: number }) => row.rowNumber),
      ).toEqual([6, 7, 8, 9]);
      expect(job.updateProgress).toHaveBeenCalledWith({
        processed: 8,
        total: 8,
      });
    });

    it('returns without processing when the import is already COMPLETED', async () => {
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-1',
        status: DataImportStatus.COMPLETED,
      });
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));
      const job = buildJob(buildJobData(buffer));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(productsService.createProduct).not.toHaveBeenCalled();
      expect(prisma.dataImportRow.aggregate).not.toHaveBeenCalled();
      expect(tx.dataImportRow.createMany).not.toHaveBeenCalled();
      expect(job.updateProgress).not.toHaveBeenCalled();
      expect(tx.dataImport.update).not.toHaveBeenCalled();
      // The cache is written on the miss but the early return never finalizes,
      // so nothing deletes it here — a retry could still reuse it.
      expect(parseCache.set).toHaveBeenCalledWith(
        'import-1',
        expect.any(Object),
      );
      expect(parseCache.del).not.toHaveBeenCalled();
    });

    it('rethrows an unexpected chunk error so the worker can mark the import FAILED', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      productsService.createProduct.mockRejectedValue(new Error('db exploded'));
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));
      const job = buildJob(buildJobData(buffer));

      await expect(
        service.processImportJob(job.data, job as unknown as Job),
      ).rejects.toThrow('db exploded');
      // The unexpected-failure path leaves the cache in place so the BullMQ
      // retry skips the parse+validate pass.
      expect(parseCache.set).toHaveBeenCalledWith(
        'import-1',
        expect.any(Object),
      );
      expect(parseCache.del).not.toHaveBeenCalled();
    });

    it('throws ImportExecutionFailedException when the import record no longer exists', async () => {
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue(null);
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(1));
      const job = buildJob(buildJobData(buffer));

      await expect(
        service.processImportJob(job.data, job as unknown as Job),
      ).rejects.toThrow(ImportExecutionFailedException);
      expect(parseCache.del).not.toHaveBeenCalled();
    });

    it('records a row as ERROR when createOne rejects with ImportRowRejectedException and commits the rest', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      productsService.createProduct
        .mockRejectedValueOnce(
          new ImportRowRejectedException(
            'La categoria "X" no existe en el sistema',
          ),
        )
        .mockResolvedValue({ id: 'prod-2' });
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));
      const job = buildJob(buildJobData(buffer));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(productsService.createProduct).toHaveBeenCalledTimes(2);
      expect(tx.dataImportRow.createMany).toHaveBeenCalledTimes(1);
      const createManyData = (tx.dataImportRow.createMany as jest.Mock).mock
        .calls[0][0].data;
      expect(createManyData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 2,
            status: DataImportRowStatus.ERROR,
            entityId: null,
            issues: [
              {
                path: 'row',
                message: 'La categoria "X" no existe en el sistema',
              },
            ],
          }),
          expect.objectContaining({
            rowNumber: 3,
            status: DataImportRowStatus.VALID,
            entityId: 'prod-2',
          }),
        ]),
      );
    });

    it('records a row as ERROR when a write races a P2002 duplicate and commits the rest', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      productsService.createProduct
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockResolvedValue({ id: 'prod-2' });
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));
      const job = buildJob(buildJobData(buffer));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(productsService.createProduct).toHaveBeenCalledTimes(2);
      const createManyData = (tx.dataImportRow.createMany as jest.Mock).mock
        .calls[0][0].data;
      expect(createManyData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rowNumber: 2,
            status: DataImportRowStatus.ERROR,
            entityId: null,
            issues: [
              {
                path: 'row',
                message:
                  'Ya existe un registro con los mismos datos (codigo o documento duplicado)',
              },
            ],
          }),
        ]),
      );
    });

    it('writes the parsed and validated file to the parse cache on a miss', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
      const parseSpy = jest.spyOn(csvAdapter, 'parse');
      const buffer = buildCsv(PRODUCT_HEADERS, buildProductRows(2));
      const job = buildJob(buildJobData(buffer));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(parseCache.get).toHaveBeenCalledWith('import-1');
      expect(parseSpy).toHaveBeenCalledTimes(1);
      expect(parseCache.set).toHaveBeenCalledWith('import-1', {
        totalRows: 2,
        valid: [
          expect.objectContaining({
            rowNumber: 2,
            data: expect.objectContaining({ internalCode: 'P-1' }),
          }),
          expect.objectContaining({
            rowNumber: 3,
            data: expect.objectContaining({ internalCode: 'P-2' }),
          }),
        ],
        errors: [],
        rawRows: [
          [2, expect.objectContaining({ 'Codigo interno': 'P-1' })],
          [3, expect.objectContaining({ 'Codigo interno': 'P-2' })],
        ],
      });
    });

    it('reuses the cached parse result without parsing or validating again', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
      const parseSpy = jest.spyOn(csvAdapter, 'parse');
      const validateSpy = jest.spyOn(productDefinition, 'validate');
      parseCache.get.mockResolvedValue({
        totalRows: 2,
        valid: [
          {
            rowNumber: 2,
            data: {
              internalCode: 'P-CACHED',
              commercialName: 'Cached product',
              laboratory: 'Genfar',
              saleType: SaleType.FREE_SALE,
              initialPrice: '10000',
              taxSchemeName: 'IVA 19%',
            },
          },
          {
            rowNumber: 3,
            data: {
              internalCode: 'P-CACHED-2',
              commercialName: 'Cached product 2',
              laboratory: 'Genfar',
              saleType: SaleType.FREE_SALE,
              initialPrice: '10000',
              taxSchemeName: 'IVA 19%',
            },
          },
        ],
        errors: [],
        rawRows: [
          [2, { 'Codigo interno': 'P-CACHED' }],
          [3, { 'Codigo interno': 'P-CACHED-2' }],
        ],
      });
      const job = buildJob(buildJobData(Buffer.alloc(0)));

      await service.processImportJob(job.data, job as unknown as Job);

      expect(parseSpy).not.toHaveBeenCalled();
      expect(validateSpy).not.toHaveBeenCalled();
      expect(parseCache.set).not.toHaveBeenCalled();
      expect(productsService.createProduct).toHaveBeenCalledTimes(2);
      expect(productsService.createProduct).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ internalCode: 'P-CACHED' }),
      );
      expect(parseCache.del).toHaveBeenCalledWith('import-1');
    });
  });

  describe('markImportFailed', () => {
    it('updates the import to FAILED with the given reason', async () => {
      await service.markImportFailed('import-1', 'sub-test', 'boom');

      expect(tx.dataImport.update).toHaveBeenCalledWith({
        where: { id: 'import-1' },
        data: { status: DataImportStatus.FAILED, failureReason: 'boom' },
      });
    });

    it('does not throw when the update itself fails', async () => {
      prisma.withTenant.mockRejectedValueOnce(new Error('tenant gone'));

      await expect(
        service.markImportFailed('import-1', 'sub-test', 'boom'),
      ).resolves.toBeUndefined();
    });
  });

  describe('listImports', () => {
    it('returns the paginated import history', async () => {
      (prisma.dataImport.findMany as jest.Mock).mockResolvedValue([
        { id: 'import-1' },
      ]);
      (prisma.dataImport.count as jest.Mock).mockResolvedValue(1);

      const result = await service.listImports({ page: 2, pageSize: 10 });

      expect(result).toEqual({
        data: [{ id: 'import-1' }],
        total: 1,
        page: 2,
        pageSize: 10,
      });
      expect(prisma.dataImport.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      });
    });

    it('filters by entityKey when provided', async () => {
      (prisma.dataImport.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.dataImport.count as jest.Mock).mockResolvedValue(0);

      await service.listImports({
        page: 1,
        pageSize: 20,
        entityKey: 'clients',
      });

      expect(prisma.dataImport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { entityKey: 'clients' } }),
      );
      expect(prisma.dataImport.count).toHaveBeenCalledWith({
        where: { entityKey: 'clients' },
      });
    });

    describe('cursor mode', () => {
      const cursorTime = new Date('2026-06-01T00:00:00.000Z');
      const cursor = Buffer.from(
        JSON.stringify({
          lastUpdatedAt: cursorTime.toISOString(),
          lastId: 'import-prev',
        }),
      ).toString('base64');

      it('decodes the cursor into an OR keyset condition merged over the entityKey filter', async () => {
        (prisma.dataImport.findMany as jest.Mock).mockResolvedValue([]);

        await service.listImports({ page: 1, pageSize: 10, entityKey: 'clients', cursor });

        expect(prisma.dataImport.findMany).toHaveBeenCalledWith({
          where: {
            entityKey: 'clients',
            OR: [
              { createdAt: { lt: cursorTime } },
              { createdAt: cursorTime, id: { lt: 'import-prev' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 11,
        });
      });

      it('returns pageSize items with hasMore true and a nextCursor built from the last item when more pages exist', async () => {
        const rows = Array.from({ length: 3 }, (_, i) => ({
          id: `import-${i}`,
          createdAt: new Date(Date.UTC(2026, 5, 10 - i)),
        }));
        (prisma.dataImport.findMany as jest.Mock).mockResolvedValue(rows);

        const result = await service.listImports({ page: 1, pageSize: 2, cursor });

        expect(result.data).toHaveLength(2);
        expect(result.hasMore).toBe(true);
        const payload = JSON.parse(
          Buffer.from(result.nextCursor as string, 'base64').toString('utf8'),
        );
        expect(payload).toEqual({
          lastUpdatedAt: '2026-06-09T00:00:00.000Z',
          lastId: 'import-1',
        });
      });

      it('sets hasMore false and null nextCursor when the page exhausts the result set', async () => {
        const rows = Array.from({ length: 2 }, (_, i) => ({
          id: `import-${i}`,
          createdAt: new Date(Date.UTC(2026, 5, 10 - i)),
        }));
        (prisma.dataImport.findMany as jest.Mock).mockResolvedValue(rows);

        const result = await service.listImports({ page: 1, pageSize: 2, cursor });

        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
      });
    });
  });

  describe('getImport', () => {
    it('returns the import with its rows ordered by row number', async () => {
      const record = { id: 'import-1', rows: [{ rowNumber: 2 }] };
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue(record);

      const result = await service.getImport('import-1');

      expect(result).toEqual(record);
      expect(prisma.dataImport.findUnique).toHaveBeenCalledWith({
        where: { id: 'import-1' },
        include: { rows: { orderBy: { rowNumber: 'asc' } } },
      });
    });

    it('throws ImportNotFoundException when the import does not exist', async () => {
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getImport('missing')).rejects.toThrow(
        ImportNotFoundException,
      );
    });
  });
});
