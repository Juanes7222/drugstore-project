import { Injectable } from '@nestjs/common';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import { ObjectStorage, assertSafeObjectKey } from './object-storage.port';

const DELETE_BATCH_SIZE = 1000;

/**
 * Cloudflare R2-backed ObjectStorage (S3-compatible API). One instance is
 * bound to exactly one bucket with its own scoped credentials, mirroring the
 * two-token strategy: backups and updates never share a credential set.
 */
@Injectable()
export class R2ObjectStorageService implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    options: {
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
    // Optional injection seam so unit tests can supply a mocked S3Client
    // instead of stubbing the SDK module.
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        region: 'auto',
        endpoint: options.endpoint,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
    this.bucket = options.bucket;
  }

  async put(key: string, body: Readable | Buffer): Promise<void> {
    assertSafeObjectKey(key);
    if (Buffer.isBuffer(body)) {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body }),
      );
      return;
    }
    // Streams use the multipart upload helper so large payloads never have to
    // be buffered whole in memory.
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
    }).done();
  }

  async get(key: string): Promise<Buffer> {
    assertSafeObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return streamToBuffer(response.Body);
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeObjectKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return response.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    assertSafeObjectKey(key);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isObjectNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeObjectKey(key);
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: [{ Key: key }] },
      }),
    );
  }

  async removePrefix(prefix: string): Promise<void> {
    // The trailing slash is namespace syntax and is not part of segment checks.
    const normalized = prefix.replace(/\/+$/, '');
    assertSafeObjectKey(normalized);
    const searchPrefix = `${normalized}/`;

    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: searchPrefix,
          MaxKeys: DELETE_BATCH_SIZE,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = page.Contents ?? [];
      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: objects.map((object) => ({ Key: object.Key! })),
              Quiet: true,
            },
          }),
        );
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
  }
}

type SdkRequestError = { name?: string; $metadata?: { httpStatusCode?: number } };

function isObjectNotFound(error: unknown): boolean {
  if (error instanceof NotFound) {
    return true;
  }
  const sdkError = error as SdkRequestError;
  return (
    sdkError?.name === 'NotFound' ||
    sdkError?.name === 'NoSuchKey' ||
    sdkError?.$metadata?.httpStatusCode === 404
  );
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
