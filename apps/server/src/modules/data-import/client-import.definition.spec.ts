// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    Decimal: class {},
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
  AuditAction: { IMPORT: 'IMPORT' },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import {
  ClientImportRow,
  ClientImportRowSchema,
} from '@pharmacy/shared-validation';
import { ClientImportDefinition } from './client-import.definition';

function buildRawClientRecord(overrides: Record<string, unknown> = {}) {
  return {
    'Nombre Completo': 'Ana Garcia',
    'Tipo de Documento': 'cedula',
    'Número de Documento': '1234567890',
    Correo: 'ana@email.com',
    Cupo: '500000',
    ...overrides,
  };
}

function buildValidClientRow(overrides: Record<string, unknown> = {}) {
  return ClientImportRowSchema.parse({
    fullName: 'Ana Garcia',
    identificationType: 'CC',
    identificationNumber: '1234567890',
    email: 'ana@email.com',
    ...overrides,
  }) as ClientImportRow;
}

describe('ClientImportDefinition', () => {
  let prisma: DeepMockProxy<PrismaClient>;
  let definition: ClientImportDefinition;
  let clientsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    clientsService = { create: jest.fn() };
    definition = new ClientImportDefinition(
      prisma as any,
      clientsService as any,
    );
  });

  describe('entity metadata', () => {
    it('declares the clients entity key and clients audit module', () => {
      expect(definition.entityKey).toBe('clients');
      expect(definition.entityLabel).toBe('Clients');
      expect(definition.auditModule).toBe('CLIENTS');
    });
  });

  describe('mapColumns', () => {
    it('maps accented Spanish headers to canonical keys', () => {
      const { data, issues } = definition.mapColumns(buildRawClientRecord());

      expect(issues).toEqual([]);
      expect(data).toEqual({
        fullName: 'Ana Garcia',
        identificationType: 'cedula',
        identificationNumber: '1234567890',
        email: 'ana@email.com',
        creditLimit: '500000',
      });
    });

    it('ignores columns that match no alias', () => {
      const { data } = definition.mapColumns(
        buildRawClientRecord({ 'Campo raro': 'x' }),
      );

      expect(data).not.toHaveProperty('Campo raro');
    });

    it('maps English aliases as well', () => {
      const { data } = definition.mapColumns({
        'full name': 'Bob',
        'document type': 'nit',
        identification_number: '900123',
        mail: 'bob@email.com',
      });

      expect(data).toEqual({
        fullName: 'Bob',
        identificationType: 'nit',
        identificationNumber: '900123',
        email: 'bob@email.com',
      });
    });

    it('normalizes placeholder values to undefined', () => {
      const { data } = definition.mapColumns(
        buildRawClientRecord({ Telefono: '-', Direccion: 'n/a' }),
      );

      expect(data.phone).toBeUndefined();
      expect(data.address).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('accepts a fully mapped valid row and resolves the identification alias', () => {
      const outcome = definition.validate(
        definition.mapColumns(buildRawClientRecord()).data,
      );

      expect('data' in outcome).toBe(true);
      if ('data' in outcome) {
        expect(outcome.data.identificationType).toBe('CC');
        expect(outcome.data.creditLimit).toBe(500000);
      }
    });

    it('returns issues for an invalid email', () => {
      const outcome = definition.validate({
        fullName: 'Ana',
        identificationType: 'CC',
        identificationNumber: '123',
        email: 'not-an-email',
      });

      expect('issues' in outcome).toBe(true);
      if ('issues' in outcome) {
        expect(outcome.issues.some((issue) => issue.path === 'email')).toBe(
          true,
        );
      }
    });

    it('returns issues for a row missing required fields', () => {
      const outcome = definition.validate({
        fullName: 'Ana',
      });

      expect('issues' in outcome).toBe(true);
      if ('issues' in outcome) {
        const paths = outcome.issues.map((issue) => issue.path);
        expect(paths).toEqual(
          expect.arrayContaining([
            'identificationType',
            'identificationNumber',
          ]),
        );
      }
    });
  });

  describe('createOne', () => {
    beforeEach(() => {
      clientsService.create.mockResolvedValue({ id: 'cli-1' });
    });

    it('creates the client through ClientsService with mapped fields', async () => {
      const result = await definition.createOne(
        { userId: 'user-1' },
        buildValidClientRow({ creditLimit: 100000 }),
      );

      expect(result).toEqual({ id: 'cli-1' });
      expect(clientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: 'Ana Garcia',
          identificationType: 'CC',
          identificationNumber: '1234567890',
          email: 'ana@email.com',
          creditLimit: 100000,
        }),
        'user-1',
      );
    });

    it('passes null for optional fields that are absent', async () => {
      await definition.createOne(
        { userId: 'user-1' },
        buildValidClientRow({
          email: undefined,
          phone: undefined,
          address: undefined,
          creditLimit: undefined,
        }),
      );

      expect(clientsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: null,
          phone: null,
          address: null,
          municipality: null,
          department: null,
          creditLimit: null,
        }),
        'user-1',
      );
    });
  });

  describe('findConflicts', () => {
    it('reports rows whose identification already exists in the tenant', async () => {
      (prisma.client.findMany as jest.Mock).mockResolvedValue([
        { identificationType: 'CC', identificationNumber: '1234567890' },
      ]);

      const conflicts = await definition.findConflicts(
        { subscriptionId: 'sub-test' },
        [
          {
            rowNumber: 2,
            data: buildValidClientRow({ identificationNumber: '1234567890' }),
          },
          {
            rowNumber: 3,
            data: buildValidClientRow({ identificationNumber: '9876543210' }),
          },
        ],
      );

      expect(conflicts.size).toBe(1);
      expect(conflicts.get(2)).toEqual([
        {
          path: 'identificationNumber',
          message: 'El documento CC 1234567890 ya existe en el sistema',
        },
      ]);
      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-test',
          OR: [
            {
              identificationType: 'CC',
              identificationNumber: '1234567890',
            },
            {
              identificationType: 'CC',
              identificationNumber: '9876543210',
            },
          ],
        },
        select: { identificationType: true, identificationNumber: true },
      });
    });

    it('returns an empty map when no identification exists', async () => {
      (prisma.client.findMany as jest.Mock).mockResolvedValue([]);

      const conflicts = await definition.findConflicts(
        { subscriptionId: 'sub-test' },
        [{ rowNumber: 2, data: buildValidClientRow() }],
      );

      expect(conflicts.size).toBe(0);
    });
  });
});
