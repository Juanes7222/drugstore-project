import { Injectable } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  constants,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ObjectStorage, assertSafeObjectKey } from './object-storage.port';

/**
 * Filesystem-backed ObjectStorage rooted at a fixed directory. Used when
 * STORAGE_DRIVER=local. Every key resolves under the configured root; the
 * resolve() containment check is defense in depth on top of the shared
 * key validation.
 */
@Injectable()
export class LocalObjectStorageService implements ObjectStorage {
  private readonly root: string;
  private readonly rootWithSeparator: string;

  constructor(root: string) {
    if (root.trim().length === 0) {
      throw new Error('Local object storage requires a non-empty root path');
    }
    this.root = resolve(root);
    this.rootWithSeparator = this.root.endsWith(sep) ? this.root : this.root + sep;
  }

  async put(key: string, body: Readable | Buffer): Promise<void> {
    assertSafeObjectKey(key);
    const target = this.resolveWithinRoot(key);
    await mkdir(dirname(target), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await writeFile(target, body);
      return;
    }
    await pipeline(body, createWriteStream(target));
  }

  async get(key: string): Promise<Buffer> {
    assertSafeObjectKey(key);
    return readFile(this.resolveWithinRoot(key));
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeObjectKey(key);
    return createReadStream(this.resolveWithinRoot(key));
  }

  async exists(key: string): Promise<boolean> {
    assertSafeObjectKey(key);
    try {
      const info = await stat(this.resolveWithinRoot(key));
      return info.isFile();
    } catch {
      return false;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeObjectKey(key);
    await rm(this.resolveWithinRoot(key), { force: true });
  }

  async removePrefix(prefix: string): Promise<void> {
    // The trailing slash is namespace syntax and is not part of segment checks.
    const normalized = prefix.replace(/\/+$/, '');
    assertSafeObjectKey(normalized);
    const target = this.resolveWithinRoot(normalized);
    try {
      await access(target, constants.F_OK);
    } catch {
      return;
    }
    await rm(target, { recursive: true, force: true });
  }

  private resolveWithinRoot(key: string): string {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.rootWithSeparator)) {
      throw new Error(`Object storage key escapes the storage root: ${key}`);
    }
    return target;
  }
}
