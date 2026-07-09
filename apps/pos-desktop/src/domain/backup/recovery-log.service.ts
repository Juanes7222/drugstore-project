/**
 * Local-only recovery audit-log service.
 *
 * Every recovery action (backup created, backup verified, restore completed,
 * unclean shutdown detected, etc.) is recorded in the local `RecoveryLog`
 * table. The log is not pruned automatically.
 */

import { Prisma, type PrismaClient } from '@pharmacy/database/local';

export type RecoveryAction =
  | 'BACKUP_CREATED'
  | 'BACKUP_VERIFIED'
  | 'RESTORE_COMPLETED'
  | 'RESTORE_ABORTED'
  | 'UNHEALTHY_SHUTDOWN_DETECTED'
  | 'INTEGRITY_FAILURE_DETECTED';

export interface RecoveryLogEntry {
  id: string;
  at: Date;
  actorUserId: string;
  action: RecoveryAction;
  backupId: string | null;
  details: Record<string, unknown> | null;
}

export interface RecoveryLogService {
  log(
    action: RecoveryAction,
    actorUserId: string,
    backupId?: string,
    details?: Record<string, unknown>,
  ): Promise<RecoveryLogEntry>;
  list(limit?: number): Promise<RecoveryLogEntry[]>;
}

export const createRecoveryLogService = (prisma: PrismaClient): RecoveryLogService =>
  new RecoveryLogServiceImpl(prisma);

class RecoveryLogServiceImpl implements RecoveryLogService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(
    action: RecoveryAction,
    actorUserId: string,
    backupId?: string,
    details?: Record<string, unknown>,
  ): Promise<RecoveryLogEntry> {
    const row = await this.prisma.recoveryLog.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        at: new Date(),
        actorUserId,
        action,
        backupId: backupId ?? null,
        details: details ? (details as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });

    return {
      id: row.id,
      at: row.at,
      actorUserId: row.actorUserId,
      action: row.action as RecoveryAction,
      backupId: row.backupId,
      details: row.details as Record<string, unknown> | null,
    };
  }

  async list(limit = 100): Promise<RecoveryLogEntry[]> {
    const rows = await this.prisma.recoveryLog.findMany({
      orderBy: { at: 'desc' as const },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      actorUserId: row.actorUserId,
      action: row.action as RecoveryAction,
      backupId: row.backupId,
      details: row.details as Record<string, unknown> | null,
    }));
  }
}
