import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when the provided value does not match the expected ConfigValueType
 * for a given configuration key (e.g., a NUMBER key receives a string value).
 */
export class ConfigValueTypeMismatchException extends DomainException {
  constructor(valueType: string, key: string) {
    super(
      'CONFIG_VALUE_TYPE_MISMATCH',
      `The provided value does not match the expected type "${valueType}" for configuration key "${key}"`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
