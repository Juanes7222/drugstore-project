import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { ObjectStorage } from '../../infrastructure/storage/object-storage.port';
import { BinaryStorageService } from './binary-storage.service';

/**
 * Fake implementing the ObjectStorage port in memory so delegation and key
 * layout are asserted against the real port contract.
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

function buildConfigService(publicBaseUrl: string): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === 'UPDATE_PUBLIC_BASE_URL') {
        return publicBaseUrl;
      }
      throw new Error(`Unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

describe('BinaryStorageService', () => {
  function makeService(publicBaseUrl = 'https://downloads.example.com'): {
    service: BinaryStorageService;
    storage: InMemoryObjectStorage;
  } {
    const storage = new InMemoryObjectStorage();
    return {
      storage,
      service: new BinaryStorageService(
        buildConfigService(publicBaseUrl),
        storage,
      ),
    };
  }

  describe('storeBinary', () => {
    it('puts the buffer at {channel}/{version}/{filename}', async () => {
      const { service, storage } = makeService();
      const payload = Buffer.from('pharmacy-update-binary');
      const putSpy = jest.spyOn(storage, 'put');

      await service.storeBinary('stable', '1.2.3', 'pos-setup.exe', payload);

      expect(putSpy).toHaveBeenCalledWith('stable/1.2.3/pos-setup.exe', payload);
    });

    it('returns the sha256 hex digest of the stored bytes', async () => {
      const { service } = makeService();

      const result = await service.storeBinary(
        'stable',
        '1.2.3',
        'pos-setup.exe',
        Buffer.from('hello world'),
      );

      // Published sha256("hello world"), independent of the implementation.
      expect(result.fileHash).toBe(
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
      );
    });

    it('builds the download URL under /updates/download with a trailing-slash base URL trimmed', async () => {
      const { service } = makeService('https://cdn.example.com/');

      const result = await service.storeBinary(
        'stable',
        '1.2.3',
        'pos-setup.exe',
        Buffer.from('payload'),
      );

      expect(result.downloadUrl).toBe(
        'https://cdn.example.com/updates/download/stable/1.2.3/pos-setup.exe',
      );
    });

    it('returns the payload size in bytes alongside hash and URL', async () => {
      const { service } = makeService();
      const payload = Buffer.from('pharmacy-update-binary');

      const result = await service.storeBinary(
        'beta',
        '2.0.0',
        'app.bin',
        payload,
      );

      expect(result.fileSize).toBe(payload.length);
      expect(result.downloadUrl).toBe(
        'https://downloads.example.com/updates/download/beta/2.0.0/app.bin',
      );
    });
  });

  describe('readBinary', () => {
    it('returns the stored bytes for the channel/version/filename key', async () => {
      const { service, storage } = makeService();
      storage.objects.set(
        'stable/1.2.3/pos-setup.exe',
        Buffer.from('binary-bytes'),
      );

      const result = await service.readBinary('stable', '1.2.3', 'pos-setup.exe');

      expect(result).toEqual(Buffer.from('binary-bytes'));
    });

    it('wraps storage failures in InternalServerErrorException naming the object', async () => {
      const { service, storage } = makeService();
      const cause = new Error('storage backend unreachable');
      jest.spyOn(storage, 'get').mockRejectedValue(cause);

      const error = await service
        .readBinary('stable', '1.2.3', 'missing.exe')
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect((error as Error).message).toBe(
        'Binary not found for stable/1.2.3/missing.exe',
      );
      expect((error as Error).cause).toBe(cause);
    });
  });

  describe('deleteVersion', () => {
    it('removes the whole {channel}/{version} prefix', async () => {
      const { service, storage } = makeService();
      const removePrefixSpy = jest.spyOn(storage, 'removePrefix');

      await service.deleteVersion('beta', '2.0.0');

      expect(removePrefixSpy).toHaveBeenCalledWith('beta/2.0.0');
    });
  });

  describe('deleteBinary', () => {
    it('removes the single object at {channel}/{version}/{filename}', async () => {
      const { service, storage } = makeService();
      const removeSpy = jest.spyOn(storage, 'remove');

      await service.deleteBinary('beta', '2.0.0', 'old.bin');

      expect(removeSpy).toHaveBeenCalledWith('beta/2.0.0/old.bin');
    });
  });

  describe('binaryExists', () => {
    it('delegates exists for the full object key', async () => {
      const { service, storage } = makeService();
      storage.objects.set('stable/1.2.3/pos-setup.exe', Buffer.from('x'));
      const existsSpy = jest.spyOn(storage, 'exists');

      const result = await service.binaryExists(
        'stable',
        '1.2.3',
        'pos-setup.exe',
      );

      expect(existsSpy).toHaveBeenCalledWith('stable/1.2.3/pos-setup.exe');
      expect(result).toBe(true);
    });

    it('reports false when the object is absent', async () => {
      const { service } = makeService();

      const result = await service.binaryExists('stable', '9.9.9', 'none.bin');

      expect(result).toBe(false);
    });
  });
});
