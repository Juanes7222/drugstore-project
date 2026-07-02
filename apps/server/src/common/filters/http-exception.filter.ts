import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';

interface ErrorResponse {
  errorCode: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const errorCode = this.extractErrorCode(exception);
    const message = this.extractMessage(exception);

    const errorResponse: ErrorResponse = {
      errorCode,
      message,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    this.logger.error(
      `[${request.method}] ${request.url} - ${errorCode}: ${message}`,
      exception.stack,
    );

    response.status(status).json(errorResponse);
  }

  private extractErrorCode(exception: HttpException): string {
    if (exception instanceof DomainException) {
      return exception.errorCode;
    }

    const status = exception.getStatus();
    const statusToCode: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
    };

    return statusToCode[status] || 'UNKNOWN_ERROR';
  }

  private extractMessage(exception: HttpException): string {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && 'message' in response) {
      const message = (response as Record<string, unknown>).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message[0] || 'An error occurred';
      }
    }

    return exception.message || 'An error occurred';
  }
}
