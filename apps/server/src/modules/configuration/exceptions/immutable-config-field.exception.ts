import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when an attempt is made to change an identity field (valueType or module)
 * of an existing configuration entry. Those fields are fixed for the lifetime of
 * the key and can only be set at creation time.
 */
export class ImmutableConfigFieldException extends DomainException {
  constructor(field: string, key: string) {
    super(
      'IMMUTABLE_CONFIG_FIELD',
      `Field "${field}" cannot be changed for existing configuration key "${key}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
