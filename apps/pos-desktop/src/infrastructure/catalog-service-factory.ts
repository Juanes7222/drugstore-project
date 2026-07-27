/**
 * Factory that creates the appropriate `CatalogService` implementation.
 *
 * The POS is local-first: product search at the sales counter MUST read the
 * local PGlite database, never the remote server directly. The remote server
 * is only consulted by the catalog-sync pipeline (server → local), never by
 * the sales UI (local → cashier).
 *
 * Selection rules:
 *
 *   1. If the local PGlite database is reachable, return the local service.
 *      The cashier sees the products (and prices, and tax schemes) that the
 *      workstation actually has locally — including unsynced local edits
 *      and products that the sync has not yet pulled from the server.
 *   2. If the local DB is not reachable (e.g. dev mode outside Tauri), fall
 *      back to the in-memory mock so the UI is still navigable.
 *   3. The HTTP catalog service is NOT used by the sales counter. It exists
 *      as an opt-in escape hatch for tooling that genuinely needs server-side
 *      data; the sales path never calls it.
 */
import { type PrismaClient } from '@pharmacy/database/local';
import { type CatalogService } from '../renderer/services/catalog-service';
import { createLocalCatalogService } from '../renderer/services/catalog-service.local';
import { createMockCatalogService } from '../renderer/services/catalog-service.mock';
import { getLocalDatabase } from './local-database';

/**
 * Resolves to the local Prisma client if PGlite has initialised, or to null
 * if it cannot (dev mode without Tauri). The PGlite singleton returns
 * instantly after the first init, so subsequent calls are cheap.
 */
const resolvePrismaClient = async (): Promise<PrismaClient | null> => {
  try {
    const { prisma } = await getLocalDatabase();
    return (prisma as PrismaClient | null | undefined) ?? null;
  } catch {
    return null;
  }
};

/**
 * Try local first, fall back to the in-memory mock when PGlite is not
 * available. Returning the local service synchronously (with a lazy
 * Prisma resolver) keeps the factory signature compatible with the rest
 * of the renderer; the actual DB call happens inside `search()`.
 */
export function createCatalogService(): CatalogService {
  return createLocalCatalogService({
    prismaResolver: resolvePrismaClient,
  });
}

/**
 * Build a mock catalog service explicitly. Used by tests and by callers
 * that need a deterministic in-memory implementation independent of the
 * local DB availability.
 */
export function createMockCatalogServiceInstance(): CatalogService {
  return createMockCatalogService();
}
