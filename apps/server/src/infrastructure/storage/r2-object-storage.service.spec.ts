import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { R2ObjectStorageService } from './r2-object-storage.service';

interface SentRequest {
  command: unknown;
  input: Record<string, unknown>;
}

const R2_OPTIONS = {
  endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
  bucket: 'pharmacy-updates',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

// Matches @aws-sdk/lib-storage's MIN_PART_SIZE (5 MiB); bodies below one
// part are uploaded with the single-PUT shortcut instead of multipart.
const LIB_STORAGE_MIN_PART_SIZE = 5 * 1024 * 1024;

/**
 * Hand-rolled mock of the S3Client send surface plus the slice of
 * `client.config` lib-storage's Upload reads (the service's only usages).
 * jest-mock-extended's mockDeep chokes on the overloaded generic signature
 * of `send`, and the constructor seam exists precisely for this.
 */
function buildMockS3Client(
  respond: (command: unknown) => unknown = () => ({}),
): { client: S3Client; send: jest.Mock; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const send = jest.fn(async (command: { input: Record<string, unknown> }) => {
    sent.push({ command, input: command.input });
    return respond(command);
  });
  const client = {
    send,
    config: {
      requestHandler: {},
      requestChecksumCalculation: async () => 'WHEN_REQUIRED',
    },
  };
  return { client: client as unknown as S3Client, send, sent };
}

describe('R2ObjectStorageService', () => {
  describe('put', () => {
    it('sends a PutObjectCommand with the configured bucket for Buffer bodies', async () => {
      const { client, sent } = buildMockS3Client();
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);
      const body = Buffer.from('update-binary');

      await storage.put('stable/1.0.0/app.exe', body);

      expect(sent).toHaveLength(1);
      expect(sent[0].command).toBeInstanceOf(PutObjectCommand);
      expect(sent[0].input).toEqual({
        Bucket: 'pharmacy-updates',
        Key: 'stable/1.0.0/app.exe',
        Body: body,
      });
    });

    it('uploads Readable bodies through the lib-storage multipart flow', async () => {
      const { client, sent } = buildMockS3Client((command) => {
        if (command instanceof CreateMultipartUploadCommand) {
          return { UploadId: 'mpu-1' };
        }
        if (command instanceof UploadPartCommand) {
          return { ETag: `"etag-${String(command.input.PartNumber)}"` };
        }
        return {};
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);
      // Exceeds one part so the Upload cannot finish via the single-PUT
      // shortcut and must run the real multipart sequence.
      const oversizedChunk = Buffer.alloc(LIB_STORAGE_MIN_PART_SIZE + 1);

      await storage.put(
        'stable/1.0.0/app.exe',
        Readable.from([oversizedChunk]),
      );

      const creates = sent.filter(
        (call) => call.command instanceof CreateMultipartUploadCommand,
      );
      expect(creates).toHaveLength(1);
      expect(creates[0].input).toMatchObject({
        Bucket: 'pharmacy-updates',
        Key: 'stable/1.0.0/app.exe',
      });

      const parts = sent.filter(
        (call) => call.command instanceof UploadPartCommand,
      );
      expect(parts.map((call) => call.input.PartNumber)).toEqual([1, 2]);
      expect(
        parts.every((call) => call.input.UploadId === 'mpu-1'),
      ).toBe(true);

      const completes = sent.filter(
        (call) => call.command instanceof CompleteMultipartUploadCommand,
      );
      expect(completes).toHaveLength(1);
      expect(completes[0].input.UploadId).toBe('mpu-1');
      const completedParts = completes[0].input.MultipartUpload as {
        Parts: Array<{ PartNumber: number }>;
      };
      expect(completedParts.Parts.map((part) => part.PartNumber)).toEqual([
        1, 2,
      ]);

      // The single-shot Put path must not be used for streams.
      expect(
        sent.some((call) => call.command instanceof PutObjectCommand),
      ).toBe(false);
    });

    it('rejects unsafe keys before any request is sent', async () => {
      const { client, send } = buildMockS3Client();
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(
        storage.put('../escape', Buffer.alloc(0)),
      ).rejects.toThrow('empty or traversal segment');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('buffers the response body into a single Buffer', async () => {
      const { client, sent } = buildMockS3Client((command) =>
        command instanceof GetObjectCommand
          ? {
              Body: Readable.from([Buffer.from('half-'), Buffer.from('body')]),
            }
          : {},
      );
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      const result = await storage.get('stable/1.0.0/app.exe');

      expect(result).toEqual(Buffer.from('half-body'));
      expect(sent[0].command).toBeInstanceOf(GetObjectCommand);
      expect(sent[0].input).toEqual({
        Bucket: 'pharmacy-updates',
        Key: 'stable/1.0.0/app.exe',
      });
    });
  });

  describe('exists', () => {
    it('returns true when HeadObject succeeds', async () => {
      const { client, sent } = buildMockS3Client();
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      const result = await storage.exists('stable/1.0.0/app.exe');

      expect(result).toBe(true);
      expect(sent[0].command).toBeInstanceOf(HeadObjectCommand);
      expect(sent[0].input).toEqual({
        Bucket: 'pharmacy-updates',
        Key: 'stable/1.0.0/app.exe',
      });
    });

    it('returns false when the SDK reports NotFound by error name', async () => {
      const notFound = Object.assign(new Error('not found'), {
        name: 'NotFound',
      });
      const { client } = buildMockS3Client(() => {
        throw notFound;
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(storage.exists('stable/1.0.0/app.exe')).resolves.toBe(false);
    });

    it('returns false for a NoSuchKey error name', async () => {
      const noSuchKey = Object.assign(new Error('no such key'), {
        name: 'NoSuchKey',
      });
      const { client } = buildMockS3Client(() => {
        throw noSuchKey;
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(storage.exists('stable/1.0.0/app.exe')).resolves.toBe(false);
    });

    it('returns false when the error carries a 404 status in $metadata', async () => {
      const http404 = Object.assign(new Error('gone'), {
        $metadata: { httpStatusCode: 404 },
      });
      const { client } = buildMockS3Client(() => {
        throw http404;
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(storage.exists('stable/1.0.0/app.exe')).resolves.toBe(false);
    });

    it('returns false for an SDK NotFound instance', async () => {
      const { client } = buildMockS3Client(() => {
        throw new NotFound({ $metadata: {} });
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(storage.exists('stable/1.0.0/app.exe')).resolves.toBe(false);
    });

    it('rethrows errors that are not object-not-found signals', async () => {
      const denied = new Error('access denied');
      const { client } = buildMockS3Client(() => {
        throw denied;
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await expect(storage.exists('stable/1.0.0/app.exe')).rejects.toBe(denied);
    });
  });

  describe('remove', () => {
    it('issues a DeleteObjectsCommand for the single key', async () => {
      const { client, sent } = buildMockS3Client();
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await storage.remove('stable/1.0.0/app.exe');

      expect(sent).toHaveLength(1);
      expect(sent[0].command).toBeInstanceOf(DeleteObjectsCommand);
      expect(sent[0].input.Delete).toEqual({
        Objects: [{ Key: 'stable/1.0.0/app.exe' }],
      });
    });
  });

  describe('removePrefix', () => {
    it('follows continuation tokens and issues one batch delete per page', async () => {
      let listCalls = 0;
      const { client, sent } = buildMockS3Client((command) => {
        if (!(command instanceof ListObjectsV2Command)) {
          return {};
        }
        listCalls += 1;
        if (listCalls === 1) {
          return {
            Contents: [
              { Key: 'stable/1.0.0/a.exe' },
              { Key: 'stable/1.0.0/b.exe' },
            ],
            IsTruncated: true,
            NextContinuationToken: 'page-2-token',
          };
        }
        return {
          Contents: [{ Key: 'stable/1.0.0/c.exe' }],
          IsTruncated: false,
        };
      });
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await storage.removePrefix('stable/1.0.0/');

      expect(sent).toHaveLength(4);
      expect(sent[0].command).toBeInstanceOf(ListObjectsV2Command);
      expect(sent[0].input).toEqual({
        Bucket: 'pharmacy-updates',
        Prefix: 'stable/1.0.0/',
        MaxKeys: 1000,
      });
      expect(sent[1].command).toBeInstanceOf(DeleteObjectsCommand);
      expect(sent[1].input.Delete).toEqual({
        Objects: [
          { Key: 'stable/1.0.0/a.exe' },
          { Key: 'stable/1.0.0/b.exe' },
        ],
        Quiet: true,
      });
      expect(sent[2].input.ContinuationToken).toBe('page-2-token');
      expect(sent[3].input.Delete).toEqual({
        Objects: [{ Key: 'stable/1.0.0/c.exe' }],
        Quiet: true,
      });
    });

    it('skips the delete call when the listing is empty', async () => {
      const { client, sent } = buildMockS3Client((command) =>
        command instanceof ListObjectsV2Command ? { Contents: [] } : {},
      );
      const storage = new R2ObjectStorageService(R2_OPTIONS, client);

      await storage.removePrefix('stable/9.9.9/');

      expect(sent).toHaveLength(1);
      expect(sent[0].command).toBeInstanceOf(ListObjectsV2Command);
    });
  });
});
