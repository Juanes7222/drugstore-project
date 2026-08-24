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
 * HOW: at the top of a spec:
 *
 *   import { createPrismaDatabaseMock } from '<relative>/test/helpers/prisma-database-mock';
 *
 *   jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());
 *
 * The PrismaClient stub is intentionally inert — specs replace it with a
 * mockDeep anyway. SYNC_STATUS_VALUES re-exports the real generated
 * SyncStatus object for assertions against actual values instead of string
 * literals.
 */

type EnumRecord = Record<string, unknown>;

export const SYNC_STATUS_VALUES = jest.requireActual(
  '@pharmacy/database/enums',
) as EnumRecord & { SyncStatus: EnumRecord };

export function createPrismaDatabaseMock(): EnumRecord {
  // requireActual inside the factory keeps this lazy: the enums load only
  // when something first requires the mocked module, so helper evaluation
  // order relative to other imports never matters.
  const realEnums = jest.requireActual<EnumRecord>('@pharmacy/database/enums');

  return {
    ...realEnums,
    PrismaClient: class PrismaClientStub {},
  };
}
