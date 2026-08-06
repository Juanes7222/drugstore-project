/**
 * Dev endpoints for database inspection.
 *
 * Guarded by NODE_ENV — all endpoints return 404 when NODE_ENV !== 'development'
 * so they are completely inaccessible in production/staging without a separate
 * build-time flag.
 */

import {
  Controller,
  Get,
  Query,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EnvConfig } from '../../config/env.schema';

// ---------------------------------------------------------------------------
// Whitelist of tables that can be exported — prevents abuse in case the dev
// guard is accidentally bypassed.  Must match Prisma model names (capitalised,
// singular).  Add tables here as needed for comparison work.
// ---------------------------------------------------------------------------
const EXPORTABLE_TABLES = new Set([
  'Product',
  'Client',
  'TaxScheme',
  'Sale',
  'SaleItem',
  'SalePayment',
  'Supplier',
  'PurchaseOrder',
  'PurchaseReception',
  'Lot',
  'LotStock',
  'Category',
]);

@Controller('api/dev')
export class DevController {
  constructor(
    private readonly config: ConfigService<EnvConfig>,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Export one or more tables as JSON arrays.
   *
   * Only responds when NODE_ENV=development.
   * Query params: ?tables=Product,Client,Sale
   *
   * Returns: { "Product": [...], "Client": [...], ... }
   */
  @Get('db-export')
  async exportTables(
    @Query('tables') tablesParam?: string,
  ): Promise<Record<string, unknown[]>> {
    // ---- Dev guard: 404 outside development -------------------------------
    if (this.config.get('NODE_ENV') !== 'development') {
      throw new NotFoundException();
    }

    const requested = tablesParam
      ? tablesParam.split(',').map((t) => t.trim()).filter(Boolean)
      : [...EXPORTABLE_TABLES];

    // Validate against whitelist
    const invalid = requested.filter((t) => !EXPORTABLE_TABLES.has(t));
    if (invalid.length > 0) {
      throw new NotFoundException(
        `Tables not exportable: ${invalid.join(', ')}. ` +
        `Allowed: ${[...EXPORTABLE_TABLES].join(', ')}`,
      );
    }

    const result: Record<string, unknown[]> = {};

    for (const table of requested) {
      try {
        const rows = await this.prisma.$queryRawUnsafe<unknown[]>(
          `SELECT * FROM "${table}" ORDER BY (SELECT NULL) LIMIT 10000`,
        );
        // $queryRawUnsafe returns BigInt for bigint columns; JSON.stringify
        // cannot serialise BigInt. Convert all BigInt values to string.
        result[table] = rows.map((row: unknown) =>
          deepBigIntToString(row as Record<string, unknown>),
        );
      } catch (err) {
        throw new InternalServerErrorException(
          `Failed to export table "${table}": ${(err as Error).message}`,
        );
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walk a value and convert any BigInt to string.
 * Prisma returns BigInt for numeric/bigint columns; JSON serialisation
 * does not handle BigInt by default.
 */
function deepBigIntToString(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    return value.map(deepBigIntToString);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepBigIntToString(v);
    }
    return result;
  }

  return value;
}
