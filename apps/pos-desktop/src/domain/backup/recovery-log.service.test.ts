import { describe, it, expect } from 'vitest';
import { createRecoveryLogService } from './recovery-log.service';

function createMockPrisma() {
  const created: Array<{
    id: string;
    at: Date;
    actorUserId: string;
    action: string;
    backupId: string | null;
    details: unknown;
  }> = [];

  return {
    recoveryLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        const row = {
          id: String(args.data.id),
          at: args.data.at as Date,
          actorUserId: String(args.data.actorUserId),
          action: String(args.data.action),
          backupId: (args.data.backupId as string | null) ?? null,
          details: args.data.details,
        };
        created.push(row);
        return row;
      },
      findMany: async () => [...created].reverse(),
    },
    _created: created,
  };
}

describe('RecoveryLogService', () => {
  it('records a backup-created action', async () => {
    const prisma = createMockPrisma();
    const service = createRecoveryLogService(prisma as never);

    const entry = await service.log('BACKUP_CREATED', 'user-1', 'backup-1', { reason: 'MANUAL' });

    expect(entry.action).toBe('BACKUP_CREATED');
    expect(entry.actorUserId).toBe('user-1');
    expect(entry.backupId).toBe('backup-1');
    expect(entry.details).toEqual({ reason: 'MANUAL' });
    expect(prisma._created).toHaveLength(1);
  });

  it('returns entries ordered newest first', async () => {
    const prisma = createMockPrisma();
    const service = createRecoveryLogService(prisma as never);

    await service.log('BACKUP_CREATED', 'user-1');
    await service.log('BACKUP_VERIFIED', 'user-1', 'backup-1');

    const list = await service.list();
    expect(list).toHaveLength(2);
    expect(list[0].action).toBe('BACKUP_VERIFIED');
    expect(list[1].action).toBe('BACKUP_CREATED');
  });
});
