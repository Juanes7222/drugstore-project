import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { LocalObjectStorageService } from './local-object-storage.service';

describe('LocalObjectStorageService', () => {
  const tempRoots: string[] = [];

  async function createStorage(): Promise<{
    storage: LocalObjectStorageService;
    root: string;
  }> {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'local-object-storage-'),
    );
    tempRoots.push(root);
    return { storage: new LocalObjectStorageService(root), root };
  }

  afterAll(async () => {
    await Promise.all(
      tempRoots.map((root) =>
        fs.rm(root, { recursive: true, force: true }),
      ),
    );
  });

  describe('put/get', () => {
    it('round-trips a Buffer body', async () => {
      const { storage } = await createStorage();

      await storage.put(
        'backups/ws-1/2026-07-09/backup.bin',
        Buffer.from('buffer-payload'),
      );

      await expect(
        storage.get('backups/ws-1/2026-07-09/backup.bin'),
      ).resolves.toEqual(Buffer.from('buffer-payload'));
    });

    it('round-trips a Readable body by draining it to disk', async () => {
      const { storage } = await createStorage();
      const body = Readable.from([
        Buffer.from('chunk-one-'),
        Buffer.from('chunk-two'),
      ]);

      await storage.put('backups/ws-1/streamed.bin', body);

      await expect(
        storage.get('backups/ws-1/streamed.bin'),
      ).resolves.toEqual(Buffer.from('chunk-one-chunk-two'));
    });

    it('streams stored bytes back through getStream', async () => {
      const { storage } = await createStorage();
      await storage.put('docs/readme.txt', Buffer.from('stream-me'));

      const stream = await storage.getStream('docs/readme.txt');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }

      expect(Buffer.concat(chunks)).toEqual(Buffer.from('stream-me'));
    });
  });

  describe('exists', () => {
    it('reports true for a stored object', async () => {
      const { storage } = await createStorage();

      await storage.put('tree/file.bin', Buffer.from('x'));

      await expect(storage.exists('tree/file.bin')).resolves.toBe(true);
    });

    it('reports false for a missing key', async () => {
      const { storage } = await createStorage();

      await expect(storage.exists('tree/absent.bin')).resolves.toBe(false);
    });

    it('reports false for a directory-shaped prefix', async () => {
      const { storage } = await createStorage();
      await storage.put('tree/file.bin', Buffer.from('x'));

      await expect(storage.exists('tree')).resolves.toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes the object so it no longer exists', async () => {
      const { storage } = await createStorage();
      await storage.put('tree/gone.bin', Buffer.from('x'));

      await storage.remove('tree/gone.bin');

      await expect(storage.exists('tree/gone.bin')).resolves.toBe(false);
    });

    it('does not throw when the key is already missing', async () => {
      const { storage } = await createStorage();

      await expect(storage.remove('tree/never-there.bin')).resolves.toBeUndefined();
    });
  });

  describe('removePrefix', () => {
    it('removes the nested subtree but not sibling prefixes', async () => {
      const { storage } = await createStorage();
      await storage.put('tenant-a/2026/backup.bin', Buffer.from('a'));
      await storage.put('tenant-a/2026/nested/part.bin', Buffer.from('n'));
      await storage.put('tenant-b/2026/backup.bin', Buffer.from('b'));

      await storage.removePrefix('tenant-a');

      await expect(
        storage.exists('tenant-a/2026/backup.bin'),
      ).resolves.toBe(false);
      await expect(
        storage.exists('tenant-a/2026/nested/part.bin'),
      ).resolves.toBe(false);
      await expect(
        storage.exists('tenant-b/2026/backup.bin'),
      ).resolves.toBe(true);
    });

    it('accepts a trailing slash on the prefix', async () => {
      const { storage } = await createStorage();
      await storage.put('tenant-a/2026/backup.bin', Buffer.from('a'));
      await storage.put('tenant-b/2026/backup.bin', Buffer.from('b'));

      await storage.removePrefix('tenant-a/');

      await expect(
        storage.exists('tenant-a/2026/backup.bin'),
      ).resolves.toBe(false);
      await expect(
        storage.exists('tenant-b/2026/backup.bin'),
      ).resolves.toBe(true);
    });
  });

  describe('key safety', () => {
    it('rejects keys with traversal segments before touching the filesystem', async () => {
      const { storage, root } = await createStorage();

      await expect(storage.put('../escape', Buffer.alloc(0))).rejects.toThrow(
        'empty or traversal segment',
      );
      await expect(storage.put('a/../b', Buffer.alloc(0))).rejects.toThrow(
        'empty or traversal segment',
      );
      const escaped = await fs.readdir(root);
      expect(escaped).toEqual([]);
    });

    it('rejects keys containing backslash separators', async () => {
      const { storage } = await createStorage();

      await expect(
        storage.put('ws-1\\backup.bin', Buffer.alloc(0)),
      ).rejects.toThrow("must use '/' separators");
    });
  });
});
