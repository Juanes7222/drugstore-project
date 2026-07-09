import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { ConfigService } from '@nestjs/config';
import { TerminalBackupService } from './terminal-backup.service';

describe('TerminalBackupService', () => {
  let service: TerminalBackupService;
  let tempDir: string;
  let configService: ConfigService<{ BACKUP_STORAGE_PATH: string }>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-backup-test-'));
    configService = {
      get: jest.fn().mockReturnValue(tempDir),
    } as unknown as ConfigService<{ BACKUP_STORAGE_PATH: string }>;
    service = new TerminalBackupService(configService);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function streamFromString(value: string): Readable {
    return Readable.from([Buffer.from(value)]);
  }

  it('streams the payload to the expected path and returns metadata', async () => {
    const createdAt = new Date('2026-07-09T10:30:00.000Z');

    const result = await service.storeBackup({
      workstationId: 'ws-1',
      uploadId: 'upload-abc',
      createdAt,
      payload: streamFromString('encrypted-payload'),
    });

    expect(result).toEqual({
      uploadId: 'upload-abc',
      workstationId: 'ws-1',
      createdAt: '2026-07-09T10:30:00.000Z',
    });

    const expectedFile = path.join(
      tempDir,
      'terminal-backups',
      'ws-1',
      '2026-07-09',
      'upload-abc',
    );
    const content = await fs.readFile(expectedFile, 'utf-8');
    expect(content).toBe('encrypted-payload');
  });

  it('appends uploadId to the filename on collision', async () => {
    const createdAt = new Date('2026-07-09T10:30:00.000Z');
    const baseDir = path.join(tempDir, 'terminal-backups', 'ws-1', '2026-07-09');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'upload-abc'), 'first');

    const result = await service.storeBackup({
      workstationId: 'ws-1',
      uploadId: 'upload-abc',
      createdAt,
      payload: streamFromString('second'),
    });

    expect(result.uploadId).toBe('upload-abc');

    const files = await fs.readdir(baseDir);
    expect(files.sort()).toEqual(['upload-abc', 'upload-abc-upload-abc']);

    const secondContent = await fs.readFile(
      path.join(baseDir, 'upload-abc-upload-abc'),
      'utf-8',
    );
    expect(secondContent).toBe('second');
  });

  it('uses a numeric counter when repeated collisions occur', async () => {
    const createdAt = new Date('2026-07-09T10:30:00.000Z');
    const baseDir = path.join(tempDir, 'terminal-backups', 'ws-1', '2026-07-09');
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'upload-abc'), 'first');
    await fs.writeFile(path.join(baseDir, 'upload-abc-upload-abc'), 'second');

    const result = await service.storeBackup({
      workstationId: 'ws-1',
      uploadId: 'upload-abc',
      createdAt,
      payload: streamFromString('third'),
    });

    expect(result.uploadId).toBe('upload-abc');

    const files = await fs.readdir(baseDir);
    expect(files.sort()).toEqual([
      'upload-abc',
      'upload-abc-upload-abc',
      'upload-abc-upload-abc-1',
    ]);
  });

  it('isolates backups by workstation and date', async () => {
    await service.storeBackup({
      workstationId: 'ws-a',
      uploadId: 'upload-x',
      createdAt: new Date('2026-07-08T12:00:00.000Z'),
      payload: streamFromString('ws-a-payload'),
    });

    await service.storeBackup({
      workstationId: 'ws-b',
      uploadId: 'upload-x',
      createdAt: new Date('2026-07-09T12:00:00.000Z'),
      payload: streamFromString('ws-b-payload'),
    });

    const aContent = await fs.readFile(
      path.join(tempDir, 'terminal-backups', 'ws-a', '2026-07-08', 'upload-x'),
      'utf-8',
    );
    const bContent = await fs.readFile(
      path.join(tempDir, 'terminal-backups', 'ws-b', '2026-07-09', 'upload-x'),
      'utf-8',
    );

    expect(aContent).toBe('ws-a-payload');
    expect(bContent).toBe('ws-b-payload');
  });
});
