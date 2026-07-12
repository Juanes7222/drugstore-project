import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class RolloutNotPausedException extends DomainException {
  constructor(versionId: string) {
    super(
      'UPDATE_ROLLOUT_NOT_PAUSED',
      `Rollout for version ${versionId} is not paused`,
      HttpStatus.CONFLICT,
    );
  }
}
