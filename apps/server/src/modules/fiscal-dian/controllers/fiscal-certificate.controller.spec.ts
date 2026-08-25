import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Test, TestingModule } from '@nestjs/testing';
import { FiscalCertificateController } from './fiscal-certificate.controller';
import { FiscalCertificateService } from '../services/fiscal-certificate.service';
import { AUDITABLE_KEY } from '@/common/decorators/auditable.decorator';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { RoleType, AuditAction, SystemModule } from '@pharmacy/shared-types';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  upload: jest.fn(),
  revoke: jest.fn(),
};

describe('FiscalCertificateController (integration)', () => {
  let controller: FiscalCertificateController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalCertificateController],
      providers: [{ provide: FiscalCertificateService, useValue: mockService }],
    }).compile();

    controller = module.get<FiscalCertificateController>(
      FiscalCertificateController,
    );
    service = module.get(FiscalCertificateService) as jest.Mocked<
      typeof mockService
    >;
  });

  describe('route metadata', () => {
    it('restricts every handler to ADMIN and OWNER', () => {
      expect(Reflect.getMetadata(ROLES_KEY, controller.findAll)).toEqual([
        RoleType.ADMIN,
        RoleType.OWNER,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, controller.findById)).toEqual([
        RoleType.ADMIN,
        RoleType.OWNER,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, controller.upload)).toEqual([
        RoleType.ADMIN,
        RoleType.OWNER,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, controller.revoke)).toEqual([
        RoleType.ADMIN,
        RoleType.OWNER,
      ]);
    });

    it('marks upload and revoke as auditable CREATE / STATE_CHANGE on FISCAL', () => {
      expect(Reflect.getMetadata(AUDITABLE_KEY, controller.upload)).toEqual({
        action: AuditAction.CREATE,
        module: SystemModule.FISCAL,
        entityType: 'FiscalCertificate',
      });
      expect(Reflect.getMetadata(AUDITABLE_KEY, controller.revoke)).toEqual({
        action: AuditAction.STATE_CHANGE,
        module: SystemModule.FISCAL,
        entityType: 'FiscalCertificate',
      });
    });
  });

  describe('GET /fiscal-dian/certificates', () => {
    it('delegates to findAll', async () => {
      const expected = [{ id: 'cert-1' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith();
      expect(result).toEqual(expected);
    });
  });

  describe('GET /fiscal-dian/certificates/:id', () => {
    it('delegates to findById with the id', async () => {
      const expected = { id: 'cert-1', status: 'ACTIVE' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('cert-1');

      expect(service.findById).toHaveBeenCalledWith('cert-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /fiscal-dian/certificates', () => {
    it('delegates to upload with the dto and the current user id', async () => {
      const dto = { alias: 'DIAN Firma 2026' } as any;
      const user = { id: 'user-1' } as any;
      const expected = { id: 'cert-1' };
      service.upload.mockResolvedValue(expected);

      const result = await controller.upload(dto, user);

      expect(service.upload).toHaveBeenCalledWith(dto, 'user-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /fiscal-dian/certificates/:id/revoke', () => {
    it('delegates to revoke with the id', async () => {
      service.revoke.mockResolvedValue({ id: 'cert-1' });

      const result = await controller.revoke('cert-1');

      expect(service.revoke).toHaveBeenCalledWith('cert-1');
      expect(result).toEqual({ id: 'cert-1' });
    });
  });
});
