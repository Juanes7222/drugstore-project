// ---------------------------------------------------------------------------
// Tests for WorkstationConfigController — per-workstation config endpoints
// ---------------------------------------------------------------------------

// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    ConfigValueType: {
      NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN', STRING: 'STRING',
      ARRAY: 'ARRAY', OBJECT: 'OBJECT',
    },
    SystemModule: { CONFIGURATION: 'CONFIGURATION' },
    AuditAction: { UPDATE: 'UPDATE' },
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { WorkstationConfigController } from './workstation-config.controller';
import { WorkstationConfigService } from '../services/workstation-config.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { RoleType, User } from '@pharmacy/shared-types';
import { ForbiddenException } from '@nestjs/common';

describe('WorkstationConfigController', () => {
  let controller: WorkstationConfigController;
  let service: jest.Mocked<WorkstationConfigService>;

  const mockUser: User = {
    id: 'user-1',
    subscriptionId: 'sub-1',
    role: RoleType.OWNER,
    username: 'admin',
    displayName: 'Admin',
    email: 'admin@test.com',
    isActive: true,
    totpEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastLoginWorkstationId: 'ws-1',
    status: 'ACTIVE',
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-07-17T00:00:00Z',
    authMethod: 'PASSWORD_ONLY',
    identificationType: null,
    identificationNumber: null,
    firstName: undefined,
    lastName: undefined,
    avatarUrl: null,
    avatarColor: null,
    passwordHash: undefined,
    passwordAlgorithm: undefined,
    createdByUserId: undefined,
  };

  const mockWorkstationConfig = {
    id: 'sub-1:ws-1',
    subscriptionId: 'sub-1',
    workstationId: 'ws-1',
    workflow: { autoPrintOnConfirm: false },
    strictness: { cashShiftRequired: false },
    createdAt: '2026-07-17T00:00:00Z',
    updatedAt: '2026-07-17T00:00:00Z',
  };

  beforeEach(async () => {
    const mockService = {
      getByWorkstation: jest.fn(),
      listBySubscription: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkstationConfigController],
      providers: [
        {
          provide: WorkstationConfigService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WorkstationConfigController>(WorkstationConfigController);
    service = module.get(WorkstationConfigService) as jest.Mocked<WorkstationConfigService>;
  });

  // ── getByWorkstation ──────────────────────────────────────────────────

  describe('GET :workstationId', () => {
    it('returns workstation config for the given workstation', async () => {
      service.getByWorkstation.mockResolvedValue(mockWorkstationConfig);

      const result = await controller.getByWorkstation('ws-1', mockUser);

      expect(result).toEqual(mockWorkstationConfig);
      expect(service.getByWorkstation).toHaveBeenCalledWith('sub-1', 'ws-1');
    });

    it('returns null when no config exists', async () => {
      service.getByWorkstation.mockResolvedValue(null);

      const result = await controller.getByWorkstation('ws-2', mockUser);

      expect(result).toBeNull();
    });
  });

  // ── listBySubscription ────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns all workstation configs for the subscription', async () => {
      service.listBySubscription.mockResolvedValue([mockWorkstationConfig]);

      const result = await controller.listBySubscription(mockUser);

      expect(result).toHaveLength(1);
      expect(service.listBySubscription).toHaveBeenCalledWith('sub-1');
    });
  });

  // ── upsert ────────────────────────────────────────────────────────────

  describe('PUT :workstationId', () => {
    it('creates/updates workstation config overrides', async () => {
      const dto = {
        workflow: { autoPrintOnConfirm: false },
        strictness: { cashShiftRequired: false },
      };
      service.upsert.mockResolvedValue(mockWorkstationConfig);

      const result = await controller.upsert('ws-1', dto as any, mockUser);

      expect(result).toEqual(mockWorkstationConfig);
      expect(service.upsert).toHaveBeenCalledWith('sub-1', 'ws-1', {
        workflow: dto.workflow,
        strictness: dto.strictness,
      });
    });

    it('works with empty body (empty workflow and strictness)', async () => {
      const dto = {};
      const emptyConfig = {
        ...mockWorkstationConfig,
        workflow: {},
        strictness: {},
      };
      service.upsert.mockResolvedValue(emptyConfig);

      const result = await controller.upsert('ws-1', dto as any, mockUser);

      expect(result.workflow).toEqual({});
      expect(result.strictness).toEqual({});
    });
  });

  // ── delete ────────────────────────────────────────────────────────────

  describe('DELETE :workstationId', () => {
    it('deletes workstation config', async () => {
      service.delete.mockResolvedValue(undefined);

      await controller.delete('ws-1', mockUser);

      expect(service.delete).toHaveBeenCalledWith('sub-1', 'ws-1');
    });
  });
});
