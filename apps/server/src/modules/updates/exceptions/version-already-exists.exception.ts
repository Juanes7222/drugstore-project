import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class VersionAlreadyExistsException extends DomainException {
  constructor(version: string, channel: string) {
    super(
      'UPDATE_VERSION_ALREADY_EXISTS',
      `Version ${version} for channel ${channel} already exists`,
      HttpStatus.CONFLICT,
    );
  }
}
