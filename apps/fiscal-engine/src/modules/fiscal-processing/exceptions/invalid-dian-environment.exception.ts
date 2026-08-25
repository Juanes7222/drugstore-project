import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Stable cross-app error code. Exported so classification logic
 * (e.g. FiscalTransmissionService.handleSendException) matches on this
 * named constant instead of hardcoding the literal a second time.
 */
export const DIAN_ENVIRONMENT_INVALID_ERROR_CODE = 'DIAN_ENVIRONMENT_INVALID';

/**
 * Thrown when a DIAN environment value outside the Technical Annex
 * TipoAmbiente vocabulary ("1" producción, "2" habilitación) reaches the
 * transmission adapter. Fail-fast replaces the previous silent fallback to
 * habilitación, which could route production fiscal traffic to the wrong
 * DIAN environment on a misconfiguration.
 */
export class InvalidDianEnvironmentException extends DomainException {
  constructor(environment: string) {
    super(
      DIAN_ENVIRONMENT_INVALID_ERROR_CODE,
      `Unknown DIAN environment "${environment}": expected "1" (producción) or "2" (habilitación). ` +
        'Check TechProviderConfig.environment.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
