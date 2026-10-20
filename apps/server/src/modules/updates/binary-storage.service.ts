import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  UPDATES_OBJECT_STORAGE,
  ObjectStorage,
} from '../../infrastructure/storage/object-storage.port';

/**
 * Keep only the file name of an uploaded binary.
 *
 * A path separator would create nested storage keys, and the download route
 * addresses the file by the published name.
 */
export function sanitizeBinaryFilename(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base.trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new InternalServerErrorException(
      'The uploaded binary has no usable file name.',
    );
  }
  return cleaned;
}

/**
 * Handles upload, storage, and retrieval of update binary files.
 *
 * Binaries live under the updates-scoped ObjectStorage with the key layout:
 *   {channel}/{version}/{filename}
 * (local driver: UPDATE_STORAGE_PATH tree; R2 driver: pharmacy-updates bucket)
 */
@Injectable()
export class BinaryStorageService {
  private readonly publicBaseUrl: string;

  constructor(
    configService: ConfigService,
    @Inject(UPDATES_OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {
    this.publicBaseUrl = configService.getOrThrow<string>(
      'UPDATE_PUBLIC_BASE_URL',
    );
  }

  /**
   * Store a binary file and return its SHA-256 hash plus the public download
   * URL. Downloads keep flowing through the API route, so the URL is
   * independent of which storage driver is active.
   */
  async storeBinary(
    channel: string,
    version: string,
    filename: string,
    buffer: Buffer,
  ): Promise<{ fileHash: string; downloadUrl: string; fileSize: number }> {
    const safeFilename = sanitizeBinaryFilename(filename);
    const key = this.objectKey(channel, version, safeFilename);
    await this.storage.put(key, buffer);

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const downloadUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/updates/download/${channel}/${version}/${safeFilename}`;

    return { fileHash, downloadUrl, fileSize: buffer.length };
  }

  /**
   * Read a stored binary file's content.
   */
  async readBinary(
    channel: string,
    version: string,
    filename: string,
  ): Promise<Buffer> {
    try {
      return await this.storage.get(this.objectKey(channel, version, filename));
    } catch (error) {
      throw new InternalServerErrorException(
        `Binary not found for ${channel}/${version}/${filename}`,
        { cause: error },
      );
    }
  }

  /**
   * Open a stored binary for streaming. Used by the download route, which
   * serves installers too large to hold in memory.
   */
  async openBinaryStream(
    channel: string,
    version: string,
    filename: string,
  ): Promise<Readable> {
    return this.storage.getStream(this.objectKey(channel, version, filename));
  }

  /**
   * Delete all stored files for a given version.
   */
  async deleteVersion(channel: string, version: string): Promise<void> {
    await this.storage.removePrefix(`${channel}/${version}`);
  }

  /**
   * Delete a specific file for a version.
   */
  async deleteBinary(
    channel: string,
    version: string,
    filename: string,
  ): Promise<void> {
    await this.storage.remove(this.objectKey(channel, version, filename));
  }

  /**
   * Check if a binary exists.
   */
  async binaryExists(
    channel: string,
    version: string,
    filename: string,
  ): Promise<boolean> {
    return this.storage.exists(this.objectKey(channel, version, filename));
  }

  private objectKey(channel: string, version: string, filename: string): string {
    return `${channel}/${version}/${sanitizeBinaryFilename(filename)}`;
  }
}
