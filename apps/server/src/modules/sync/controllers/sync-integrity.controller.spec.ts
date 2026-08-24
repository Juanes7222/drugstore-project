import { Reflector } from '@nestjs/core';
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Guard/controller import chain reaches the Prisma client package at
// module load; keep it a stub so no generated client is needed. The
// controller pulls in both sync services, which import SyncStatus — the
// helper exports the real generated enum, so values cannot drift.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SyncIntegrityController } from './sync-integrity.controller';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';
import type { LedgerVerifyRequestDto } from '../dto/ledger-verify.dto';

describe('SyncIntegrityController', () => {
  const reflector = new Reflector();
  let integrityService: { verifyLedger: jest.Mock; getReport: jest.Mock };
  let requeueService: { requeue: jest.Mock };
  let controller: SyncIntegrityController;

  beforeEach(() => {
    integrityService = {
      verifyLedger: jest.fn().mockResolvedValue({ summary: {} }),
      getReport: jest.fn().mockResolvedValue({ generatedAt: new Date() }),
    };
    requeueService = { requeue: jest.fn().mockResolvedValue({ requeued: [] }) };
    controller = new SyncIntegrityController(integrityService as any, requeueService as any);
  });

  describe('route metadata', () => {
    it('requires OWNER and MANAGER on the report endpoint', () => {
      expect(
        reflector.get(ROLES_KEY, SyncIntegrityController.prototype.getReport),
      ).toEqual([RoleType.OWNER, RoleType.MANAGER]);
    });

    it('requires OWNER and MANAGER on the requeue endpoint', () => {
      expect(
        reflector.get(ROLES_KEY, SyncIntegrityController.prototype.requeue),
      ).toEqual([RoleType.OWNER, RoleType.MANAGER]);
    });

    it('leaves the verify endpoint open to any authenticated POS user', () => {
      // Post-reconnect check runs as CASHIER — no @Roles metadata expected.
      expect(
        reflector.get(ROLES_KEY, SyncIntegrityController.prototype.verifyLedger),
      ).toBeUndefined();
    });
  });

  describe('delegation', () => {
    it('forwards the ledger dto to the integrity service', async () => {
      const dto = {
        workstationId: 'ws-1',
        operations: [{ operationUuid: 'op-1', status: 'SYNCED' }],
      } as unknown as LedgerVerifyRequestDto;

      await controller.verifyLedger(dto);

      expect(integrityService.verifyLedger).toHaveBeenCalledWith(dto);
    });

    it('normalizes an empty report query to undefined', async () => {
      await controller.getReport('');
      expect(integrityService.getReport).toHaveBeenCalledWith(undefined);

      await controller.getReport('ws-7');
      expect(integrityService.getReport).toHaveBeenCalledWith('ws-7');
    });

    it('forwards the uuid list to the requeue service', async () => {
      await controller.requeue({ operationUuids: ['op-1'] });

      expect(requeueService.requeue).toHaveBeenCalledWith(['op-1']);
    });
  });
});
