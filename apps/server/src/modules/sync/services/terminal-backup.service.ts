import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'fs';
import {
  mkdir,
  access,
  constants,
} from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { EnvConfig } from '@/config/env.schema';

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
 * Persists encrypted terminal backup payloads to the local filesystem.
 * The service never inspects or decrypts the payload; it only validates
 * identifiers and ensures a safe, collision-free path.
 */
@Injectable()
export class TerminalBackupService {
  constructor(private configService: ConfigService<EnvConfig>) {}

  /**
   * Streams an encrypted backup payload to disk and returns the metadata
   * needed by the caller. If a file with the same uploadId already exists
   * for this workstation and day, the uploadId is appended to the filename
   * (followed by a numeric counter if necessary) so no upload is overwritten.
   */
  async storeBackup(
    input: StoreTerminalBackupInput,
  ): Promise<StoreTerminalBackupResult> {
    const storageRoot = this.configService.get('BACKUP_STORAGE_PATH')!;
    const dateFolder = input.createdAt.toISOString().split('T')[0];
    const targetDir = path.join(
      storageRoot,
      'terminal-backups',
      input.workstationId,
      dateFolder,
    );

    await mkdir(targetDir, { recursive: true });

    const filePath = await this.resolveUniqueFilePath(targetDir, input.uploadId);

    await pipeline(input.payload, createWriteStream(filePath));

    return {
      uploadId: input.uploadId,
      workstationId: input.workstationId,
      createdAt: input.createdAt.toISOString(),
    };
  }

  private async resolveUniqueFilePath(
    dir: string,
    baseName: string,
  ): Promise<string> {
    const basePath = path.join(dir, baseName);
    if (!(await this.pathExists(basePath))) {
      return basePath;
    }

    // Append the uploadId to itself per the collision-avoidance rule.
    const withUploadId = path.join(dir, `${baseName}-${baseName}`);
    if (!(await this.pathExists(withUploadId))) {
      return withUploadId;
    }

    let counter = 1;
    while (true) {
      const candidate = path.join(dir, `${baseName}-${baseName}-${counter}`);
      if (!(await this.pathExists(candidate))) {
        return candidate;
      }
      counter++;
    }
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
