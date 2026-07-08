/**
 * Framework-free domain error base class.
 *
 * Extends `Error` with a stable `errorCode` field for programmatic
 * discrimination in catch blocks. Carries no HTTP-layer concern — this
 * app has no NestJS dependency.
 *
 * Every domain-specific exception in this application extends this class.
 */
export class DomainError extends Error {
  /** Stable, machine-readable identifier (e.g. "SHIFT_ALREADY_OPEN"). */
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.errorCode = errorCode;
  }
}