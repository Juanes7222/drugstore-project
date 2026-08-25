// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Workbook } from 'exceljs';
import { ImportSourceFormat } from '@pharmacy/database';
import { ImportTemplateService } from './import-template.service';
import { ImportDefinitionNotFoundException } from './exceptions/import-definition-not-found.exception';

const FAKE_COLUMNS = [
  {
    key: 'internalCode',
    label: 'Codigo interno',
    aliases: ['codigo'],
    required: true,
    description: 'Codigo unico del producto',
  },
  {
    key: 'commercialName',
    label: 'Nombre comercial',
    aliases: ['nombre'],
    required: true,
    description: 'Nombre comercial del producto',
  },
];

describe('ImportTemplateService', () => {
  let templateService: ImportTemplateService;
  let registry: { get: jest.Mock };

  beforeEach(() => {
    registry = { get: jest.fn() };
    templateService = new ImportTemplateService(registry as any);
    registry.get.mockReturnValue({
      entityKey: 'products',
      entityLabel: 'Products',
      auditModule: 'CATALOG',
      columns: FAKE_COLUMNS,
    });
  });

  describe('generateTemplate with CSV', () => {
    it('returns a BOM-prefixed semicolon-separated header row', async () => {
      const template = await templateService.generateTemplate(
        'products',
        ImportSourceFormat.CSV,
      );

      expect(template.content).toBe('\uFEFFCodigo interno;Nombre comercial\n');
      expect(template.contentType).toBe('text/csv; charset=utf-8');
      expect(template.fileName).toBe('products-import-template.csv');
    });
  });

  describe('generateTemplate with JSON', () => {
    it('returns an empty headers/rows payload', async () => {
      const template = await templateService.generateTemplate(
        'products',
        ImportSourceFormat.JSON,
      );

      expect(JSON.parse(template.content as string)).toEqual({
        headers: ['Codigo interno', 'Nombre comercial'],
        rows: [],
      });
      expect(template.contentType).toBe('application/json; charset=utf-8');
      expect(template.fileName).toBe('products-import-template.json');
    });
  });

  describe('generateTemplate with XLSX', () => {
    it('builds a workbook with Datos and Instrucciones sheets', async () => {
      const template = await templateService.generateTemplate(
        'products',
        ImportSourceFormat.XLSX,
      );

      expect(template.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(template.fileName).toBe('products-import-template.xlsx');

      const workbook = new Workbook();
      await workbook.xlsx.load(template.content as Buffer);
      const dataSheet = workbook.getWorksheet('Datos');
      const instructionsSheet = workbook.getWorksheet('Instrucciones');

      expect(dataSheet).toBeDefined();
      expect(instructionsSheet).toBeDefined();
      const headers = dataSheet!.getRow(1).values as unknown[];
      expect(headers.slice(1)).toEqual(['Codigo interno', 'Nombre comercial']);
      const instructionRows = instructionsSheet!.getRows(
        2,
        FAKE_COLUMNS.length,
      )!;
      expect(instructionRows[0].getCell(1).text).toBe('Codigo interno');
      expect(instructionRows[0].getCell(2).text).toBe('Si');
    });
  });

  describe('generateTemplate with an unknown entity', () => {
    it('propagates ImportDefinitionNotFoundException', async () => {
      registry.get.mockImplementation(() => {
        throw new ImportDefinitionNotFoundException('unknown');
      });

      await expect(
        templateService.generateTemplate('unknown', ImportSourceFormat.CSV),
      ).rejects.toThrow(ImportDefinitionNotFoundException);
    });
  });
});
