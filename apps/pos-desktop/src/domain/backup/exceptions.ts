/**
 * Backup subsystem exceptions.
 */

import { DomainError } from '../../common/domain-error';

export class BackupInProgressException extends DomainError {
  constructor() {
    super('BACKUP_IN_PROGRESS', 'A backup operation is already in progress.');
  }
}

export class BackupFailedException extends DomainError {
  constructor(message: string) {
    super('BACKUP_FAILED', message);
  }
}

export class RestoreFailedException extends DomainError {
  constructor(message: string) {
    super('RESTORE_FAILED', message);
  }
}

export class UploadFailedException extends DomainError {
  constructor(message: string) {
    super('UPLOAD_FAILED', message);
  }
}
