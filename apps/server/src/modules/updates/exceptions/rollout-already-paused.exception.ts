import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class RolloutAlreadyPausedException extends DomainException {
  constructor(versionId: string) {
    super(
      'UPDATE_ROLLOUT_ALREADY_PAUSED',
      `Rollout for version ${versionId} is already paused`,
      HttpStatus.CONFLICT,
    );
  }
}
