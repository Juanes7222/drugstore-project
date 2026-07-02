import { DomainException } from './domain.exception';

export class NotImplementedForPhaseException extends DomainException {
  readonly errorCode = 'NOT_IMPLEMENTED_FOR_PHASE';

  constructor(moduleName: string, methodName: string) {
    super(
      `Method ${methodName} in module ${moduleName} is not yet implemented for this phase`,
      501 as any,
    );
  }
}
