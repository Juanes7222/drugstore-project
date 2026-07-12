import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class VersionNotActiveException extends DomainException {
  constructor(versionId: string) {
    super(
      'UPDATE_VERSION_NOT_ACTIVE',
      `Update version ${versionId} is not active`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
