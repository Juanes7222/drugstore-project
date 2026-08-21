// Mock @pharmacy/database before importing AppModule: the module graph
// transitively imports the generated Prisma client, which is not generated in
// packages/database at test time (same pattern as auth.service.spec.ts).
// Every named export other than PrismaClient is an enum or model-type used
// only at runtime, so a lazy proxy returning the accessed key is enough.
// The two enums fed to z.nativeEnum at import time get real member sets
// (mirrored from packages/database/prisma/schema).
jest.mock('@pharmacy/database', () => {
  const lazyEnum = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (typeof prop !== 'string') return undefined;
        if (!(prop in target)) {
          target[prop] = prop;
        }
        return target[prop];
      },
    },
  );
  const enumFrom = (members: string[]) =>
    Object.fromEntries(members.map((member) => [member, member]));
  return {
    PrismaClient: class MockPrismaClient {},
    Prisma: lazyEnum,
    BillingPeriod: enumFrom(['MONTHLY', 'QUARTERLY', 'ANNUAL']),
    SupplierIdentificationType: enumFrom(['NIT', 'CC', 'CE', 'PASSPORT']),
    // Read at module load by data-import's import-source.adapter
    // (EXTENSION_TO_FORMAT) since AppModule now imports DataImportModule.
    ImportSourceFormat: enumFrom(['CSV', 'XLSX', 'JSON']),
    __esModule: true,
  };
});

import { AppModule } from './app.module';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { TenantModule } from './modules/tenant/tenant.module';

// Regression guard for the import-ordering bug: Nest resolves module providers
// in import order, so the @Global modules (TenantModule, PrismaModule) must
// appear before any domain module that consumes their providers.
describe('AppModule', () => {
  it('registers TenantModule and PrismaModule before AuthModule', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

    expect(imports).toContain(TenantModule);
    expect(imports).toContain(PrismaModule);
    expect(imports).toContain(AuthModule);
    expect(imports.indexOf(TenantModule)).toBeLessThan(
      imports.indexOf(AuthModule),
    );
    expect(imports.indexOf(PrismaModule)).toBeLessThan(
      imports.indexOf(AuthModule),
    );
  });
});