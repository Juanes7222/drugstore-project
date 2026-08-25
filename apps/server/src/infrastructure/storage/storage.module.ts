import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BACKUP_OBJECT_STORAGE,
  UPDATES_OBJECT_STORAGE,
} from './object-storage.port';
import { createObjectStorageForScope } from './storage.factory';

/**
 * Provides the two storage-scoped ObjectStorage instances. Imported by every
 * module that persists uploaded blobs (sync: terminal backups; updates:
 * update binaries). Consumers inject via @Inject(BACKUP_OBJECT_STORAGE) or
 * @Inject(UPDATES_OBJECT_STORAGE) and never touch driver specifics.
 */
@Global()
@Module({
  providers: [
    {
      provide: BACKUP_OBJECT_STORAGE,
      useFactory: (configService: ConfigService) =>
        createObjectStorageForScope(configService, 'backups'),
      inject: [ConfigService],
    },
    {
      provide: UPDATES_OBJECT_STORAGE,
      useFactory: (configService: ConfigService) =>
        createObjectStorageForScope(configService, 'updates'),
      inject: [ConfigService],
    },
  ],
  exports: [BACKUP_OBJECT_STORAGE, UPDATES_OBJECT_STORAGE],
})
export class StorageModule {}
