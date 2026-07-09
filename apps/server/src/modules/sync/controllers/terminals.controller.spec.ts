// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { TerminalsController } from './terminals.controller';
import { TerminalBackupService } from '../services/terminal-backup.service';

const mockTerminalBackupService = {
  storeBackup: jest.fn(),
};

function streamFromString(value: string): Readable {
  return Readable.from([Buffer.from(value)]);
}

describe('TerminalsController', () => {
  let controller: TerminalsController;
  let service: jest.Mocked<typeof mockTerminalBackupService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TerminalsController],
      providers: [
        {
          provide: TerminalBackupService,
          useValue: mockTerminalBackupService,
        },
      ],
    }).compile();

    controller = module.get<TerminalsController>(TerminalsController);
    service = module.get(
      TerminalBackupService,
    ) as jest.Mocked<typeof mockTerminalBackupService>;
  });

  const validHeaders = {
    'x-backup-id': 'backup-123',
    'x-backup-created-at': '2026-07-09T10:30:00.000Z',
    'x-backup-sha256': 'a'.repeat(64),
  };

  it('accepts a valid upload and delegates to the backup service', async () => {
    service.storeBackup.mockResolvedValue({
      uploadId: 'backup-123',
      workstationId: 'ws-1',
      createdAt: '2026-07-09T10:30:00.000Z',
    });

    const result = await controller.uploadBackup(
      'ws-1',
      validHeaders['x-backup-id'],
      validHeaders['x-backup-created-at'],
      validHeaders['x-backup-sha256'],
      streamFromString('payload') as unknown as Express.Request,
    );

    expect(result).toEqual({
      uploadId: 'backup-123',
      workstationId: 'ws-1',
      createdAt: '2026-07-09T10:30:00.000Z',
    });
    expect(service.storeBackup).toHaveBeenCalledWith({
      workstationId: 'ws-1',
      uploadId: 'backup-123',
      createdAt: new Date('2026-07-09T10:30:00.000Z'),
      payload: expect.any(Readable),
    });
  });

  it('rejects an invalid workstation id', async () => {
    await expect(
      controller.uploadBackup(
        'ws/../1',
        validHeaders['x-backup-id'],
        validHeaders['x-backup-created-at'],
        validHeaders['x-backup-sha256'],
        streamFromString('payload') as unknown as Express.Request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(service.storeBackup).not.toHaveBeenCalled();
  });

  it('rejects a missing backup id header', async () => {
    await expect(
      controller.uploadBackup(
        'ws-1',
        undefined,
        validHeaders['x-backup-created-at'],
        validHeaders['x-backup-sha256'],
        streamFromString('payload') as unknown as Express.Request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(service.storeBackup).not.toHaveBeenCalled();
  });

  it('rejects a malformed sha256 header', async () => {
    await expect(
      controller.uploadBackup(
        'ws-1',
        validHeaders['x-backup-id'],
        validHeaders['x-backup-created-at'],
        'not-hex',
        streamFromString('payload') as unknown as Express.Request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(service.storeBackup).not.toHaveBeenCalled();
  });
});
