// Parse-result cache for the async import worker. Parsing (especially Excel)
// and per-row Zod validation are the most expensive non-write steps, and a
// BullMQ retry would repeat them for the whole file even though only the
// remaining chunks need work. The worker stores the parsed+validated result
// under a TTL key after attempt 1; a retry reads it and goes straight to the
// chunk loop. The cache is a pure optimization — every Redis failure degrades
// to re-parsing, never to an import error.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ImportRowError } from './data-import.service';

export interface CachedParseResult {
  totalRows: number;
  valid: Array<{ rowNumber: number; data: unknown }>;
  errors: ImportRowError[];
  /** [rowNumber, rawRecord] pairs — Maps do not survive JSON serialization. */
  rawRows: Array<[number, Record<string, unknown>]>;
}

const PARSE_CACHE_TTL_SECONDS = 15 * 60;

@Injectable()
export class ImportParseCache {
  private readonly logger = new Logger(ImportParseCache.name);
  private readonly client: Redis | null;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.client = null;
      return;
    }
    const client = new Redis(url, {
      lazyConnect: true,
      // One failed command must never block or retry the import.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on('error', (error) => {
      this.logger.warn(`Import parse cache unavailable: ${error.message}`);
    });
    this.client = client;
    client.connect().catch((error) => {
      this.logger.warn(`Import parse cache connect failed: ${error.message}`);
    });
  }

  async get(importId: string): Promise<CachedParseResult | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(this.key(importId));
      if (!raw) return null;
      return JSON.parse(raw) as CachedParseResult;
    } catch (error) {
      this.logger.warn(
        `Import parse cache read failed for ${importId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(importId: string, result: CachedParseResult): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(
        this.key(importId),
        JSON.stringify(result),
        'EX',
        PARSE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        `Import parse cache write failed for ${importId}: ${(error as Error).message}`,
      );
    }
  }

  async del(importId: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(this.key(importId));
    } catch (error) {
      this.logger.warn(
        `Import parse cache delete failed for ${importId}: ${(error as Error).message}`,
      );
    }
  }

  private key(importId: string): string {
    return `import:parse:${importId}`;
  }
}
