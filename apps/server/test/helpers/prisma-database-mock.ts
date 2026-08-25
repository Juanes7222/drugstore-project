/**
 * Shared jest.mock factory for '@pharmacy/database'.
 *
 * WHY: specs cannot require the real package (its entry point pulls in the
 * full generated Prisma client), so specs used to hand-copy enum objects
 * like SyncStatus. Hand copies silently drift when the schema adds or
 * renames an enum member — the mock keeps compiling while assertions and
 * production code diverge. This helper builds the module mock from the REAL
 * generated enums, loaded scoped to
 * packages/database/generated/full-client/enums.ts (standalone literals,
 * no client machinery; resolved via the '@pharmacy/database/enums'
 * moduleNameMapper entry in jest.config.ts).
 *
 * The `Prisma` namespace is likewise built from the REAL runtime surface,
 * not reimplemented: Decimal, PrismaClientKnownRequestError, JsonNull and
 * DbNull are loaded from @prisma/client/runtime/client.js — the exact CJS
 * module the generated full client re-exports them from (see
 * packages/database/generated/full-client/internal/prismaNamespace.ts).
 * That file is pure JavaScript (~190 KB), loads with no query engine, no
 * native bindings and no database connection, so specs get byte-identical
 * classes to production: decimal.js arithmetic (plus/minus/times/dividedBy/
 * toDecimalPlaces/toFixed/equals/greaterThan/...), the static rounding
 * modes (ROUND_HALF_UP, max, ...), and error/null sentinels that satisfy
 * `instanceof` against what services catch. Resolved through the
 * '@prisma/client/runtime/client' moduleNameMapper entry in jest.config.ts;
 * do NOT import decimal.js directly — it would be a second, divergent copy.
 *
 * HOW: at the top of a spec:
 *
 *   import { createPrismaDatabaseMock } from '<relative>/test/helpers/prisma-database-mock';
 *
 *   jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());
 *
 *   import { Prisma } from '@pharmacy/database'; // real runtime classes
 *
 * The PrismaClient stub is intentionally inert — specs replace it with a
 * mockDeep anyway. SYNC_STATUS_VALUES re-exports the real generated
 * SyncStatus object for assertions against actual values instead of string
 * literals.
 */

type EnumRecord = Record<string, unknown>;

type PrismaRuntimeSurface = {
  Decimal: unknown;
  PrismaClientKnownRequestError: unknown;
  JsonNull: unknown;
  DbNull: unknown;
};

export const SYNC_STATUS_VALUES = jest.requireActual(
  '@pharmacy/database/enums',
) as EnumRecord & { SyncStatus: EnumRecord };

function loadPrismaRuntimeSurface(): PrismaRuntimeSurface {
  const runtime = jest.requireActual(
    '@prisma/client/runtime/client',
  ) as PrismaRuntimeSurface;

  const requiredMembers = [
    'Decimal',
    'PrismaClientKnownRequestError',
    'JsonNull',
    'DbNull',
  ] as const;

  for (const member of requiredMembers) {
    if (runtime[member] === undefined) {
      throw new Error(
        `[prisma-database-mock] @prisma/client/runtime/client did not expose '${member}'. ` +
          'The Prisma runtime layout changed; update this helper.',
      );
    }
  }

  return runtime;
}

export function createPrismaDatabaseMock(): EnumRecord {
  // requireActual inside the factory keeps this lazy: the enums load only
  // when something first requires the mocked module, so helper evaluation
  // order relative to other imports never matters.
  const realEnums = jest.requireActual<EnumRecord>('@pharmacy/database/enums');
  const prismaRuntime = loadPrismaRuntimeSurface();

  return {
    ...realEnums,
    PrismaClient: class PrismaClientStub {},
    Prisma: {
      Decimal: prismaRuntime.Decimal,
      PrismaClientKnownRequestError:
        prismaRuntime.PrismaClientKnownRequestError,
      JsonNull: prismaRuntime.JsonNull,
      DbNull: prismaRuntime.DbNull,
    },
  };
}
