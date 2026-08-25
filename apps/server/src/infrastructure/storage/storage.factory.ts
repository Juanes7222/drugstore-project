import { ConfigService } from '@nestjs/config';
import { LocalObjectStorageService } from './local-object-storage.service';
import {
  BACKUP_OBJECT_STORAGE,
  UPDATES_OBJECT_STORAGE,
} from './object-storage.port';
import { R2ObjectStorageService } from './r2-object-storage.service';

/** The two storage namespaces the server needs, each with its own backend. */
export type ObjectStorageScope = 'backups' | 'updates';

const LOCAL_ROOT_ENV_BY_SCOPE: Record<ObjectStorageScope, string> = {
  backups: 'BACKUP_STORAGE_PATH',
  updates: 'UPDATE_STORAGE_PATH',
};

/**
 * Builds the driver instance for one scope from configuration. Scopes never
 * share a backend identity: local roots are separate directories and the R2
 * driver binds each scope to its own bucket + scoped token credentials.
 *
 * When STORAGE_DRIVER=r2 the env schema's storage policy already guarantees
 * every R2_* variable exists; the explicit errors here are last-resort guards
 * against misconfigured factory wiring.
 */
export function createObjectStorageForScope(
  configService: ConfigService,
  scope: ObjectStorageScope,
): LocalObjectStorageService | R2ObjectStorageService {
  if (configService.get('STORAGE_DRIVER') === 'r2') {
    const prefix = scope === 'backups' ? 'R2_BACKUPS' : 'R2_UPDATES';
    const endpoint = configService.get<string>(`R2_ENDPOINT`);
    const bucket = configService.get<string>(`${prefix}_BUCKET`);
    const accessKeyId = configService.get<string>(`${prefix}_ACCESS_KEY_ID`);
    const secretAccessKey = configService.get<string>(
      `${prefix}_SECRET_ACCESS_KEY`,
    );
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        `R2 storage driver selected but credentials for scope '${scope}' are incomplete`,
      );
    }
    return new R2ObjectStorageService({
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
    });
  }

  const rootEnvName = LOCAL_ROOT_ENV_BY_SCOPE[scope];
  const root = configService.getOrThrow<string>(rootEnvName);
  return new LocalObjectStorageService(root);
}

export { BACKUP_OBJECT_STORAGE, UPDATES_OBJECT_STORAGE };
