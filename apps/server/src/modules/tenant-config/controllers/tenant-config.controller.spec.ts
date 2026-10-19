// ---------------------------------------------------------------------------
// Role contract for TenantConfigController.
//
// The `@Roles` decorators decide who may read and who may write the
// pharmacy's configuration, and they are the only thing standing between a
// role and a surface it should not see.
//
// The contract is asserted as METADATA — which roles each route requires —
// rather than by driving the guard. `Reflector.getAllAndOverride` is what the
// guard itself consults, so this is the same answer the guard gives, without
// the guard's dependency on a hand-built ExecutionContext.
//
// The end-to-end behaviour is covered by the POS e2e suite: the inventory
// adjustments spec needs the POS to read `purchases.requireLotOnReception`
// while signed in as ADMIN, and it fails without the read being allowed.
// ---------------------------------------------------------------------------

import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Reflector } from '@nestjs/core';
import { TenantConfigController } from './tenant-config.controller';
import { RoleType } from '@pharmacy/shared-types';

const ROLES_KEY = 'roles';

function requiredRolesFor(
  handler: (...args: unknown[]) => unknown,
): RoleType[] | undefined {
  return new Reflector().getAllAndOverride<RoleType[]>(ROLES_KEY, [
    handler,
    TenantConfigController,
  ]);
}

describe('TenantConfigController role contract', () => {
  describe('GET /tenant-config', () => {
    it('lets ADMIN read it, because the POS needs the pharmacy rules at boot', () => {
      // The POS boots as ADMIN and needs the pharmacy's own operating rules —
      // `purchases.requireLotOnReception` above all. With the read restricted
      // to MANAGER/OWNER that boot got a 403, the POS kept its own local
      // default (`requireLotOnReception: false`), and the inventory-adjustment
      // screen silently rendered a DIFFERENT interface than the pharmacy had
      // configured: a flat product list with automatic FEFO resolution instead
      // of the lot picker. The policy was not being read, so it was not being
      // applied.
      expect(requiredRolesFor(TenantConfigController.prototype.getConfig)).toEqual(
        [RoleType.MANAGER, RoleType.OWNER, RoleType.ADMIN],
      );
    });

    it('does not open the configuration to CASHIER', () => {
      const roles = requiredRolesFor(TenantConfigController.prototype.getConfig);
      expect(roles).not.toContain(RoleType.CASHIER);
      expect(roles).not.toContain(RoleType.INVENTORY_ASSISTANT);
    });
  });

  describe('PUT /tenant-config', () => {
    it('still refuses ADMIN — reading is not writing', () => {
      // The asymmetry is deliberate. The read was widened so the POS can
      // function; the write was NOT, so an ADMIN still cannot change the
      // pharmacy's configuration.
      expect(
        requiredRolesFor(TenantConfigController.prototype.updateConfig),
      ).toEqual([RoleType.MANAGER, RoleType.OWNER]);
    });
  });
});
