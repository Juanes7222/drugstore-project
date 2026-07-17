import { DomainException } from '@/common/exceptions/domain.exception';
import type { ValidationError } from '../services/config-validation.service';

/**
 * Thrown when config validation fails on save.
 * Contains the list of validation errors for the client to display.
 */
export class ConfigValidationException extends DomainException {
  public readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    const pathList = errors.map((e) => e.path).join(', ');
    super(
      'CONFIG_VALIDATION_ERROR',
      `Configuration validation failed: ${pathList}.`,
      422,
    );
    this.errors = errors;
  }
}
