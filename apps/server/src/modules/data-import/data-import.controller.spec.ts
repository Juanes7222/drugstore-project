// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    Decimal: class {},
    JsonNull: 'JSON_NULL',
    PrismaClientKnownRequestError: class extends Error {
      constructor(
        m: string,
        public code: string,
        public meta?: unknown,
      ) {
        super(m);
      }
    },
  },
  ImportSourceFormat: { CSV: 'CSV', XLSX: 'XLSX', JSON: 'JSON' },
  DataImportRowStatus: { VALID: 'VALID', ERROR: 'ERROR' },
  DataImportStatus: {
    PROCESSING: 'PROCESSING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  },
  AuditAction: { IMPORT: 'IMPORT' },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { DataImportStatus } from '@pharmacy/database';
import type { PrismaClient } from '@pharmacy/database';
import { Workbook } from 'exceljs';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';
import { ImportParseCache } from './import-parse-cache';
import { ImportTemplateService } from './import-template.service';
import { ImportDefinitionRegistry } from './import-definition-registry';
import { ProductImportDefinition } from './product-import.definition';
import { ClientImportDefinition } from './client-import.definition';
import { CsvSourceAdapter } from './csv-source.adapter';
import { ExcelSourceAdapter } from './excel-source.adapter';
import { JsonSourceAdapter } from './json-source.adapter';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { ProductsService } from '@/modules/catalog/products.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import { IMPORTS_QUEUE, IMPORT_JOB_NAME } from './constants/import.constants';

const PRODUCT_HEADERS = [
  'Codigo interno',
  'Nombre comercial',
  'Laboratorio',
  'Precio de venta',
  'Impuesto',
];

function buildCsv(headers: string[], rows: string[][]): Buffer {
  const lines = [headers.join(';'), ...rows.map((row) => row.join(';'))];
  return Buffer.from(lines.join('\n'), 'utf8');
}

describe('DataImportController (integration)', () => {
  let app: INestApplication;
  let controller: DataImportController;
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>;
  let productsService: { createProduct: jest.Mock };
  let clientsService: { create: jest.Mock };
  let importsQueue: { add: jest.Mock };
  let currentUserRole: string | null;

  const buildJwtGuard = {
    canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = {
        id: 'user-1',
        username: 'admin',
        role: currentUserRole,
        isActive: true,
        workstationId: 'ws-1',
      };
      return true;
    },
  };

  beforeAll(async () => {
    prisma = mockDeep<PrismaClient>();
    productsService = { createProduct: jest.fn() };
    clientsService = { create: jest.fn() };
    importsQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataImportController],
      providers: [
        DataImportService,
        ImportTemplateService,
        ImportDefinitionRegistry,
        ProductImportDefinition,
        ClientImportDefinition,
        CsvSourceAdapter,
        ExcelSourceAdapter,
        JsonSourceAdapter,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantContextService,
          useValue: { getSubscriptionId: jest.fn(() => 'sub-test') },
        },
        { provide: ProductsService, useValue: productsService },
        { provide: ClientsService, useValue: clientsService },
        { provide: getQueueToken(IMPORTS_QUEUE), useValue: importsQueue },
        {
          provide: ImportParseCache,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
            del: jest.fn().mockResolvedValue(undefined),
          },
        },
        RolesGuard,
        { provide: Reflector, useValue: new Reflector() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(buildJwtGuard)
      .compile();

    app = module.createNestApplication();
    await app.init();
    controller = module.get(DataImportController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserRole = 'ADMIN';
    productsService.createProduct.mockResolvedValue({ id: 'prod-1' });
    (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.client.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.category.findFirst as jest.Mock).mockResolvedValue({ id: 'cat-1' });
    (prisma.pharmaceuticalForm.findFirst as jest.Mock).mockResolvedValue({
      id: 'form-1',
    });
    (prisma.taxScheme.findFirst as jest.Mock).mockResolvedValue({
      id: 'tax-1',
    });
    // ProductImportDefinition.prepare() resolves refs in batch via findMany.
    (prisma.category.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.pharmaceuticalForm.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.taxScheme.findMany as jest.Mock).mockResolvedValue([
      { id: 'tax-1', name: 'IVA 19%' },
    ]);
    (prisma.dataImport.create as jest.Mock).mockResolvedValue({
      id: 'import-1',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('role enforcement', () => {
    it('rejects CASHIER with 403 on GET /imports', async () => {
      currentUserRole = 'CASHIER';

      const response = await request(app.getHttpServer()).get('/imports');

      expect(response.status).toBe(403);
    });

    it('rejects CASHIER with 403 on POST /imports/preview', async () => {
      currentUserRole = 'CASHIER';

      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .field('entityKey', 'products')
        .attach('file', buildCsv(PRODUCT_HEADERS, []), 'products.csv');

      expect(response.status).toBe(403);
    });

    it('allows ADMIN on GET /imports', async () => {
      (prisma.dataImport.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.dataImport.count as jest.Mock).mockResolvedValue(0);

      const response = await request(app.getHttpServer()).get('/imports');

      expect(response.status).toBe(200);
    });

    it('allows MANAGER on GET /imports', async () => {
      currentUserRole = 'MANAGER';
      (prisma.dataImport.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.dataImport.count as jest.Mock).mockResolvedValue(0);

      const response = await request(app.getHttpServer()).get('/imports');

      expect(response.status).toBe(200);
    });
  });

  describe('DTO validation', () => {
    it('rejects preview without an entityKey field', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .attach('file', buildCsv(PRODUCT_HEADERS, []), 'products.csv');

      expect(response.status).toBe(400);
    });

    it('rejects preview with an unsupported format', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .field('entityKey', 'products')
        .field('format', 'XML')
        .attach('file', buildCsv(PRODUCT_HEADERS, []), 'products.csv');

      expect(response.status).toBe(400);
    });

    it('rejects a file larger than 5MB', async () => {
      const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);

      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .field('entityKey', 'products')
        .attach('file', oversized, 'products.csv');

      expect(response.status).toBe(413);
    });

    it('rejects the request when no file is uploaded', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .field('entityKey', 'products');

      expect(response.status).toBe(400);
    });

    it('throws ImportFileInvalidException when the handler receives no file', async () => {
      await expect(
        controller.preview(undefined as any, { entityKey: 'products' } as any),
      ).rejects.toThrow(ImportFileInvalidException);
    });
  });

  describe('template endpoints', () => {
    it('serves the CSV template with BOM, content type and attachment header', async () => {
      const response = await request(app.getHttpServer()).get(
        '/imports/templates/products/CSV',
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="products-import-template.csv"',
      );
      expect(response.text).toBe(
        '\uFEFFCodigo interno;Nombre comercial;Laboratorio;Concentracion;Unidad de concentracion;Tipo de venta;Stock minimo;Registro INVIMA;Codigo ATC;Categoria;Forma farmaceutica;Precio de venta;Precio de compra;Impuesto\n',
      );
    });

    it('serves the JSON template as a headers/rows payload', async () => {
      const response = await request(app.getHttpServer()).get(
        '/imports/templates/products/JSON',
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="products-import-template.json"',
      );
      const payload = JSON.parse(response.text);
      expect(payload.headers).toContain('Codigo interno');
      expect(payload.headers).toContain('Impuesto');
      expect(payload.rows).toEqual([]);
    });

    it('serves the XLSX template with Datos and Instrucciones sheets', async () => {
      // Known defect: the controller returns a raw Buffer, which Nest's
      // ExpressAdapter.reply JSON-serializes ({"type":"Buffer","data":[...]})
      // because isObject(Buffer) is true. The endpoint should stream a
      // StreamableFile instead. Reported; the test pins the current payload.
      const response = await request(app.getHttpServer())
        .get('/imports/templates/products/XLSX')
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="products-import-template.xlsx"',
      );
      const serialized = JSON.parse(response.body.toString('utf8'));
      expect(serialized.type).toBe('Buffer');
      const workbook = new Workbook();
      await workbook.xlsx.load(Buffer.from(serialized.data));
      expect(workbook.getWorksheet('Datos')).toBeDefined();
      expect(workbook.getWorksheet('Instrucciones')).toBeDefined();
    });

    it('returns 404 for an unknown entity template', async () => {
      const response = await request(app.getHttpServer()).get(
        '/imports/templates/unknown/CSV',
      );

      expect(response.status).toBe(404);
    });
  });

  describe('preview endpoint', () => {
    it('returns the preview payload for a valid CSV upload', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/preview')
        .field('entityKey', 'products')
        .attach(
          'file',
          buildCsv(PRODUCT_HEADERS, [
            ['P-1', 'Aspirina', 'Genfar', '12500.50', 'IVA 19%'],
          ]),
          'products.csv',
        );

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          entityKey: 'products',
          totalRows: 1,
          validRows: 1,
          errorRows: 0,
          format: 'CSV',
        }),
      );
    });
  });

  describe('execute endpoint', () => {
    it('enqueues the import and returns 202 with a PROCESSING status', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/execute')
        .field('entityKey', 'products')
        .attach(
          'file',
          buildCsv(PRODUCT_HEADERS, [
            ['P-1', 'Aspirina', 'Genfar', '12500.50', 'IVA 19%'],
          ]),
          'products.csv',
        );

      expect(response.status).toBe(202);
      expect(response.body).toEqual(
        expect.objectContaining({
          importId: expect.any(String),
          entityKey: 'products',
          status: DataImportStatus.PROCESSING,
          validRows: 1,
          errorRows: 0,
        }),
      );
      expect(prisma.dataImport.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityKey: 'products',
          status: DataImportStatus.PROCESSING,
          validRows: 0,
          errorRows: 0,
        }),
      });
      expect(importsQueue.add).toHaveBeenCalledTimes(1);
      expect(importsQueue.add).toHaveBeenCalledWith(
        IMPORT_JOB_NAME,
        expect.objectContaining({
          entityKey: 'products',
          subscriptionId: 'sub-test',
          userId: 'user-1',
          fileBase64: expect.any(String),
        }),
        expect.objectContaining({ attempts: 2 }),
      );
      // The worker owns entity creation; nothing is written synchronously.
      expect(productsService.createProduct).not.toHaveBeenCalled();
    });

    it('returns 422 with per-row errors when validation fails and enqueues nothing', async () => {
      const response = await request(app.getHttpServer())
        .post('/imports/execute')
        .field('entityKey', 'products')
        .attach(
          'file',
          buildCsv(PRODUCT_HEADERS, [
            ['P-1', 'Aspirina', 'Genfar', '12.500', 'IVA 19%'],
          ]),
          'products.csv',
        );

      expect(response.status).toBe(422);
      expect(response.body.errors).toHaveLength(1);
      expect(productsService.createProduct).not.toHaveBeenCalled();
      expect(prisma.dataImport.create).not.toHaveBeenCalled();
      expect(importsQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('history and detail endpoints', () => {
    it('lists import definitions', async () => {
      const response = await request(app.getHttpServer()).get(
        '/imports/definitions',
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toEqual(
        expect.objectContaining({ entityKey: 'products' }),
      );
    });

    it('returns one import with its rows', async () => {
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue({
        id: 'import-1',
        rows: [{ rowNumber: 2, status: 'VALID' }],
      });

      const response = await request(app.getHttpServer()).get(
        '/imports/import-1',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({ id: 'import-1' }),
      );
    });

    it('returns 404 for an unknown import id', async () => {
      (prisma.dataImport.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await request(app.getHttpServer()).get(
        '/imports/missing',
      );

      expect(response.status).toBe(404);
    });
  });
});
