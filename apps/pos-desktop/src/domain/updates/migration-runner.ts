/**
 * Schema migration runner for the POS desktop auto-update module.
 *
 * Reads a `migrations.json` from the downloaded update bundle and applies
 * each migration step in order. Supports three migration types:
 *
 * - **PRISMA** — a Prisma schema migration (applied via Prisma Migrate CLI
 *   or a generated SQL file).
 * - **SQL** — raw SQL statements to execute against the local PGlite.
 * - **CUSTOM** — a JavaScript callback loaded from the bundle.
 *
 * Each migration is recorded in the local MigrationLog table. On failure,
 * the migration is marked as failed in the log and the caller
 * (InstallOrchestrator) triggers a rollback.
 */

import { MigrationFailedException } from './exceptions';
import type { MigrationStep, MigrationLogEntry } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationRunnerConfig {
  /** PrismaClient for local DB access (cast from getLocalDatabase). */
  prisma: unknown;
  /**
   * The migrations manifest from the update bundle. Each step is applied
   * in array order.
   */
  migrations: MigrationStep[];
  /**
   * Optional root path where the update bundle was extracted. Used for
   * CUSTOM migrations that may need to load JS files from disk.
   */
  bundlePath?: string;
}

export interface MigrationRunner {
  /**
   * Apply all pending (unapplied) migrations.
   * Returns the list of applied migration log entries.
   * Throws MigrationFailedException on the first failure.
   */
  runPending(): Promise<MigrationLogEntry[]>;

  /**
   * List migrations that have already been applied successfully.
   */
  listApplied(): Promise<MigrationLogEntry[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMigrationRunner(config: MigrationRunnerConfig): MigrationRunner {
  return new MigrationRunnerImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class MigrationRunnerImpl implements MigrationRunner {
  constructor(private readonly config: MigrationRunnerConfig) {}

  async runPending(): Promise<MigrationLogEntry[]> {
    const applied = await this.listApplied();
    const appliedNames = new Set(applied.map((e) => e.name));

    const pending = this.config.migrations.filter((m) => !appliedNames.has(m.name));
    const results: MigrationLogEntry[] = [];

    for (const step of pending) {
      const entry = await this.applyStep(step);
      results.push(entry);

      if (!entry.success) {
        throw new MigrationFailedException(
          `Migration "${step.name}" failed: ${entry.errorMessage}`,
        );
      }
    }

    return results;
  }

  async listApplied(): Promise<MigrationLogEntry[]> {
    const db = this.config.prisma as any;
    const rows = await db.migrationLog.findMany({
      where: { success: true },
      orderBy: { appliedAt: 'asc' },
    });

    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      appliedAt: r.appliedAt.toISOString(),
      success: r.success,
      errorMessage: r.errorMessage,
    }));
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async applyStep(step: MigrationStep): Promise<MigrationLogEntry> {
    const db = this.config.prisma as any;
    const id = globalThis.crypto.randomUUID();
    const appliedAt = new Date();

    try {
      switch (step.type) {
        case 'PRISMA':
          await this.applyPrismaMigration(step);
          break;
        case 'SQL':
          await this.applySqlMigration(step);
          break;
        case 'CUSTOM':
          await this.applyCustomMigration(step);
          break;
        default:
          throw new MigrationFailedException(
            `Unknown migration type: ${(step as { type: string }).type}`,
          );
      }

      // Record success
      await db.migrationLog.create({
        data: {
          id,
          name: step.name,
          appliedAt,
          success: true,
          errorMessage: null,
        },
      });

      return {
        id,
        name: step.name,
        appliedAt: appliedAt.toISOString(),
        success: true,
        errorMessage: null,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Record failure
      await db.migrationLog.create({
        data: {
          id,
          name: step.name,
          appliedAt,
          success: false,
          errorMessage,
        },
      });

      return {
        id,
        name: step.name,
        appliedAt: appliedAt.toISOString(),
        success: false,
        errorMessage,
      };
    }
  }

  private async applyPrismaMigration(_step: MigrationStep): Promise<void> {
    // PRISMA-type migrations are applied via Prisma Migrate CLI.
    // In the context of the POS desktop, the update bundle includes a
    // pre-generated migration SQL file. We execute it as raw SQL.
    const sql = _step.payload as string;
    if (!sql) {
      throw new MigrationFailedException('PRISMA migration payload is empty.');
    }

    // Execute the migration SQL via PGlite's raw query capability.
    // We access the underlying PGlite client through Prisma's $queryRaw.
    await (this.config.prisma as any).$executeRawUnsafe(sql);
  }

  private async applySqlMigration(step: MigrationStep): Promise<void> {
    const sql = step.payload as string;
    if (!sql) {
      throw new MigrationFailedException('SQL migration payload is empty.');
    }

    await (this.config.prisma as any).$executeRawUnsafe(sql);
  }

  private async applyCustomMigration(step: MigrationStep): Promise<void> {
    // CUSTOM migrations execute a JavaScript function that receives the
    // PrismaClient and can perform arbitrary operations.
    // The payload is either a function body (as string) or a file path
    // relative to the bundle root.
    const payload = step.payload as { code?: string; filePath?: string };

    if (payload.filePath && this.config.bundlePath) {
      // Load from bundle file — this requires a Tauri invoke to read the file
      // and eval it. For now, throw if not implemented.
      throw new MigrationFailedException(
        'File-based CUSTOM migrations require Tauri native support.',
      );
    }

    if (payload.code) {
      // eslint-disable-next-line no-new-func
      const fn = new Function('prisma', payload.code) as (
        prisma: unknown,
      ) => Promise<void>;
      await fn(this.config.prisma);
      return;
    }

    throw new MigrationFailedException(
      'CUSTOM migration must provide either "code" or "filePath" in its payload.',
    );
  }
}
