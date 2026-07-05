import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when reading TechProviderConfig before it has ever been set.
 * "Not configured yet" is a distinct expected state for a fresh installation,
 * not a data error — hence a distinct exception from a generic not-found.
 */
export class TechProviderConfigNotSetException extends DomainException {
  constructor() {
    super(
      'TECH_PROVIDER_CONFIG_NOT_SET',
      'Technology provider configuration has not been set yet',
      HttpStatus.NOT_FOUND,
    );
  }
}
