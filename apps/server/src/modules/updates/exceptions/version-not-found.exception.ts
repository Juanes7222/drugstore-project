import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class VersionNotFoundException extends DomainException {
  constructor(versionId: string) {
    super(
      'UPDATE_VERSION_NOT_FOUND',
      `Update version ${versionId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
