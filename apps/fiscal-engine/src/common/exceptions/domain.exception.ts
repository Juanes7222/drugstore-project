import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Duplicated from apps/server/src/common/exceptions/domain.exception.ts
 * for isolation; promoted to a shared package if cross-app reuse grows.
 */
export class DomainException extends HttpException {
  constructor(
    readonly errorCode: string,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(message, statusCode);
  }
}
