import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when the caller's expectedConfigVersion does not match the current
 * server-side configVersion (optimistic concurrency conflict).
 */
export class ConfigVersionConflictException extends DomainException {
  constructor(currentVersion: number) {
    super(
      'CONFIG_VERSION_CONFLICT',
      `Configuration has been modified by another user. Current version: ${currentVersion}. Refresh and try again.`,
      HttpStatus.CONFLICT,
    );
  }
}
