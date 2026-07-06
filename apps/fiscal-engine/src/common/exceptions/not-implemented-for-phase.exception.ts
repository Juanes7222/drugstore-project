import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception';

export class NotImplementedForPhaseException extends DomainException {
  constructor(moduleName: string, methodName: string) {
    super(
      'NOT_IMPLEMENTED_FOR_PHASE',
      `Method ${methodName} in module ${moduleName} is not yet implemented for this phase`,
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
