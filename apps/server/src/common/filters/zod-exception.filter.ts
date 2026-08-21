import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodError } from 'zod';

const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';
const EMPTY_ISSUES_MESSAGE = 'Invalid request payload';

interface ErrorResponse {
  errorCode: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
  /** Field-level validation issues reported by Zod. */
  details?: unknown;
}

/**
 * Maps uncaught ZodError instances (e.g. from in-handler `schema.parse()`)
 * to a 400 response shaped like HttpExceptionFilter's body, so validation
 * failures never surface as 500s.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter<ZodError> {
  private readonly logger = new Logger(ZodExceptionFilter.name);

  catch(exception: ZodError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = 400;

    const errorResponse: ErrorResponse = {
      errorCode: VALIDATION_ERROR_CODE,
      message: this.firstIssueMessage(exception),
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      details: { issues: exception.issues },
    };

    this.logger.error(
      `[${request.method}] ${request.url} - ${VALIDATION_ERROR_CODE}: ${errorResponse.message}`,
    );

    response.status(statusCode).json(errorResponse);
  }

  private firstIssueMessage(exception: ZodError): string {
    const [first] = exception.issues;
    if (!first) {
      return EMPTY_ISSUES_MESSAGE;
    }
    const path = first.path.join('.');
    return path ? `${path}: ${first.message}` : first.message;
  }
}