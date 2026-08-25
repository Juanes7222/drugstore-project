import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  BACKUP_OBJECT_STORAGE,
  ObjectStorage,
} from '../../../infrastructure/storage/object-storage.port';

export interface StoreTerminalBackupInput {
  workstationId: string;
  uploadId: string;
  createdAt: Date;
  payload: Readable;
}

export interface StoreTerminalBackupResult {
  uploadId: string;
  workstationId: string;
  createdAt: string;
}

/**
 * Persists encrypted terminal backup payloads through the backup-scoped
 * ObjectStorage (local disk or Cloudflare R2 depending on STORAGE_DRIVER).
 * The service never inspects or decrypts the payload; it only validates
 * identifiers and ensures a collision-free key.
 */
@Injectable()
export class TerminalBackupService {
  constructor(
    @Inject(BACKUP_OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Streams an encrypted backup payload to object storage. If a file with the
   * same uploadId already exists for this workstation and day, the uploadId
   * is appended to the filename (followed by a numeric counter if necessary)
   * so no upload is overwritten.
   */
  async storeBackup(
    input: StoreTerminalBackupInput,
  ): Promise<StoreTerminalBackupResult> {
    const dateFolder = input.createdAt.toISOString().split('T')[0];
    // Key layout mirrors the historical directory tree so previously stored
    // backups keep their address under either driver.
    const baseKey = [
      'terminal-backups',
      input.workstationId,
      dateFolder,
      input.uploadId,
    ].join('/');
    const key = await this.resolveUniqueKey(baseKey);

    await this.storage.put(key, input.payload);

    return {
      uploadId: input.uploadId,
      workstationId: input.workstationId,
      createdAt: input.createdAt.toISOString(),
    };
  }

  private async resolveUniqueKey(baseKey: string): Promise<string> {
    const uploadId = baseKey.split('/').pop() ?? '';
    if (!(await this.storage.exists(baseKey))) {
      return baseKey;
    }

    // Append the uploadId to itself per the collision-avoidance rule.
    const withUploadId = `${baseKey}-${uploadId}`;
    if (!(await this.storage.exists(withUploadId))) {
      return withUploadId;
    }

    let counter = 1;
    while (true) {
      const candidate = `${baseKey}-${uploadId}-${counter}`;
      if (!(await this.storage.exists(candidate))) {
        return candidate;
      }
      counter++;
    }
  }
}
