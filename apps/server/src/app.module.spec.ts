// Mock @pharmacy/database before importing AppModule: the module graph
// transitively imports the generated Prisma client, which is not generated in
// packages/database at test time (same pattern as auth.service.spec.ts).
// The shared helper exposes the real generated enums plus the real Prisma
// runtime surface (Decimal, error/null sentinels), so import-time consumers
// (z.nativeEnum, EXTENSION_TO_FORMAT) see production values.
// Mock firebase-admin before importing AppModule: the module graph pulls in
// firebase-auth.service, whose real firebase-admin dependency chain
// (jwks-rsa -> jose) ships ESM builds that the CJS module runner cannot parse.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

import { createPrismaDatabaseMock } from '../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

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