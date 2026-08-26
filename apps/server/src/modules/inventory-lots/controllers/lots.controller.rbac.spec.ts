import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { RoleType } from '@pharmacy/shared-types';
import { LotsController } from './lots.controller';

/**
 * RBAC metadata regression: GET /inventory-lots/lots/sync and GET / must include
 * CASHIER in their @Roles set. The e2e spec covers the runtime guard path;
 * this unit spec guards against decorator drift without booting Nest.
 */
describe('LotsController RBAC metadata', () => {
  it('syncLots allows CASHIER', () => {
    const roles: RoleType[] = Reflect.getMetadata(ROLES_KEY, LotsController.prototype.syncLots);
    expect(roles).toEqual(expect.arrayContaining([RoleType.CASHIER]));
    expect(roles).toEqual(expect.arrayContaining([RoleType.ADMIN]));
  });

  it('findAll allows CASHIER', () => {
    const roles: RoleType[] = Reflect.getMetadata(ROLES_KEY, LotsController.prototype.findAll);
    expect(roles).toEqual(expect.arrayContaining([RoleType.CASHIER]));
  });

  it('blockLot remains ADMIN-only', () => {
    const roles: RoleType[] = Reflect.getMetadata(ROLES_KEY, LotsController.prototype.blockLot);
    expect(roles).toEqual([RoleType.ADMIN]);
    expect(roles).not.toEqual(expect.arrayContaining([RoleType.CASHIER]));
  });
});
