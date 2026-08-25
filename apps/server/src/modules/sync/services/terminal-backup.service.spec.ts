import { Readable } from 'node:stream';
import { ObjectStorage } from '../../../infrastructure/storage/object-storage.port';
import { TerminalBackupService } from './terminal-backup.service';

/**
 * Fake implementing the ObjectStorage port in memory so tests observe real
 * key-layout and collision behavior without touching the filesystem.
 */
class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Readable | Buffer): Promise<void> {
    this.objects.set(
      key,
      Buffer.isBuffer(body) ? body : await streamToBuffer(body),
    );
  }

  async get(key: string): Promise<Buffer> {
    const value = this.objects.get(key);
    if (value === undefined) {
      throw new Error(`Object not found: ${key}`);
    }
    return value;
  }

  async getStream(key: string): Promise<Readable> {
    return Readable.from(await this.get(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async removePrefix(prefix: string): Promise<void> {
    const searchPrefix = `${prefix.replace(/\/+$/, '')}/`;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(searchPrefix)) {
        this.objects.delete(key);
      }
    }
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function streamFromString(value: string): Readable {
  return Readable.from([Buffer.from(value)]);
}

describe('TerminalBackupService', () => {
  describe('storeBackup', () => {
    let storage: InMemoryObjectStorage;
    let service: TerminalBackupService;

    beforeEach(() => {
      storage = new InMemoryObjectStorage();
      service = new TerminalBackupService(storage);
    });

    it('streams the payload to terminal-backups/{workstationId}/{date}/{uploadId}', async () => {
      const payload = streamFromString('encrypted-payload');
      const putSpy = jest.spyOn(storage, 'put');

      await service.storeBackup({
        workstationId: 'ws-1',
        uploadId: 'upload-abc',
        createdAt: new Date('2026-07-09T10:30:00.000Z'),
        payload,
      });

      expect(putSpy).toHaveBeenCalledWith(
        'terminal-backups/ws-1/2026-07-09/upload-abc',
        payload,
      );
      expect(
        storage.objects.get('terminal-backups/ws-1/2026-07-09/upload-abc'),
      ).toEqual(Buffer.from('encrypted-payload'));
    });

    it('returns the upload metadata unchanged', async () => {
      const result = await service.storeBackup({
        workstationId: 'ws-1',
        uploadId: 'upload-abc',
        createdAt: new Date('2026-07-09T10:30:00.000Z'),
        payload: streamFromString('encrypted-payload'),
      });

      expect(result).toEqual({
        uploadId: 'upload-abc',
        workstationId: 'ws-1',
        createdAt: '2026-07-09T10:30:00.000Z',
      });
    });

    it('appends the uploadId to the key when the base key already exists', async () => {
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc',
        Buffer.from('first'),
      );

      await service.storeBackup({
        workstationId: 'ws-1',
        uploadId: 'upload-abc',
        createdAt: new Date('2026-07-09T10:30:00.000Z'),
        payload: streamFromString('second'),
      });

      expect(
        storage.objects.get('terminal-backups/ws-1/2026-07-09/upload-abc'),
      ).toEqual(Buffer.from('first'));
      expect(
        storage.objects.get(
          'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc',
        ),
      ).toEqual(Buffer.from('second'));
    });

    it('falls back to a numeric counter when the uploadId-suffixed key is taken', async () => {
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc',
        Buffer.from('first'),
      );
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc',
        Buffer.from('second'),
      );

      await service.storeBackup({
        workstationId: 'ws-1',
        uploadId: 'upload-abc',
        createdAt: new Date('2026-07-09T10:30:00.000Z'),
        payload: streamFromString('third'),
      });

      expect(
        storage.objects.get(
          'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc-1',
        ),
      ).toEqual(Buffer.from('third'));
    });

    it('keeps incrementing the counter past prior collisions', async () => {
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc',
        Buffer.from('first'),
      );
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc',
        Buffer.from('second'),
      );
      storage.objects.set(
        'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc-1',
        Buffer.from('third'),
      );

      await service.storeBackup({
        workstationId: 'ws-1',
        uploadId: 'upload-abc',
        createdAt: new Date('2026-07-09T10:30:00.000Z'),
        payload: streamFromString('fourth'),
      });

      expect(
        storage.objects.get(
          'terminal-backups/ws-1/2026-07-09/upload-abc-upload-abc-2',
        ),
      ).toEqual(Buffer.from('fourth'));
    });

    it('isolates backups by workstation and date folder', async () => {
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

      expect(
        storage.objects.get('terminal-backups/ws-a/2026-07-08/upload-x'),
      ).toEqual(Buffer.from('ws-a-payload'));
      expect(
        storage.objects.get('terminal-backups/ws-b/2026-07-09/upload-x'),
      ).toEqual(Buffer.from('ws-b-payload'));
    });
  });
});
