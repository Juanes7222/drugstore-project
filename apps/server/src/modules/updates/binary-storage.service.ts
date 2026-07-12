import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Handles upload, storage, and retrieval of update binary files.
 *
 * Binaries are stored on the local filesystem under the configured
 * UPDATE_STORAGE_PATH in a directory tree:
 *   {storage}/updates/{channel}/{version}/{filename}
 *
 * In production this should be swapped for cloud blob storage (S3, GCS).
 */
@Injectable()
export class BinaryStorageService {
  private readonly storagePath: string;
  private readonly publicBaseUrl: string;

  constructor(configService: ConfigService) {
    this.storagePath = configService.getOrThrow<string>('UPDATE_STORAGE_PATH');
    this.publicBaseUrl = configService.getOrThrow<string>('UPDATE_PUBLIC_BASE_URL');
    mkdirSync(this.storagePath, { recursive: true });
  }

  /**
   * Store a binary file and return its SHA-256 hash plus the public download URL.
   */
  storeBinary(
    channel: string,
    version: string,
    filename: string,
    buffer: Buffer,
  ): { fileHash: string; downloadUrl: string; fileSize: number } {
    const dir = join(this.storagePath, channel, version);
    mkdirSync(dir, { recursive: true });

    const destPath = join(dir, filename);
    writeFileSync(destPath, buffer);

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const downloadUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/updates/download/${channel}/${version}/${filename}`;

    return { fileHash, downloadUrl, fileSize: buffer.length };
  }

  /**
   * Read a stored binary file's content.
   */
  readBinary(channel: string, version: string, filename: string): Buffer {
    const filePath = join(this.storagePath, channel, version, filename);
    if (!existsSync(filePath)) {
      throw new InternalServerErrorException(`Binary not found at ${filePath}`);
    }
    return readFileSync(filePath);
  }

  /**
   * Delete all stored files for a given version.
   */
  deleteVersion(channel: string, version: string): void {
    const dir = join(this.storagePath, channel, version);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Delete a specific file for a version.
   */
  deleteBinary(channel: string, version: string, filename: string): void {
    const filePath = join(this.storagePath, channel, version, filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  /**
   * Check if a binary exists.
   */
  binaryExists(channel: string, version: string, filename: string): boolean {
    return existsSync(join(this.storagePath, channel, version, filename));
  }

  /**
   * Get the full filesystem path for a binary.
   */
  getBinaryPath(channel: string, version: string, filename: string): string {
    return join(this.storagePath, channel, version, filename);
  }
}
