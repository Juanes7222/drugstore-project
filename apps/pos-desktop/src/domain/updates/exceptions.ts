/**
 * Auto-update subsystem exceptions.
 *
 * Every exception extends the shared DomainError base class with a stable
 * errorCode for programmatic discrimination in catch blocks. Follows the
 * same pattern as src/domain/backup/exceptions.ts.
 */

import { DomainError } from '../../common/domain-error';

export class UpdateCheckFailedException extends DomainError {
  constructor(message: string) {
    super('UPDATE_CHECK_FAILED', message);
  }
}

export class DownloadFailedException extends DomainError {
  constructor(message: string) {
    super('DOWNLOAD_FAILED', message);
  }
}

export class InstallFailedException extends DomainError {
  constructor(message: string) {
    super('INSTALL_FAILED', message);
  }
}

export class MigrationFailedException extends DomainError {
  constructor(message: string) {
    super('MIGRATION_FAILED', message);
  }
}

export class RollbackDetectedException extends DomainError {
  constructor(message: string) {
    super('ROLLBACK_DETECTED', message);
  }
}
