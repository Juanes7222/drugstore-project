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
 *   The POS always uses the local PGlite database for product search.
 *   The cashier sees the products (and prices, and tax schemes) that the
 *   workstation actually has locally — including unsynced local edits
 *   and products that the sync has not yet pulled from the server.
 *
 *   The HTTP catalog service is NOT used by the sales counter. It exists
 *   as an opt-in escape hatch for tooling that genuinely needs server-side
 *   data; the sales path never calls it.
 */
import { type PrismaClient } from '@pharmacy/database/local';
import { type CatalogService } from '../renderer/services/catalog-service';
import { createLocalCatalogService } from '../renderer/services/catalog-service.local';
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
 * Create a catalog service backed by the local PGlite database.
 * Returning the service synchronously (with a lazy Prisma resolver) keeps
 * the factory signature compatible with the rest of the renderer; the
 * actual DB call happens inside `search()`.
 */
export function createCatalogService(): CatalogService {
  return createLocalCatalogService({
    prismaResolver: resolvePrismaClient,
  });
}


