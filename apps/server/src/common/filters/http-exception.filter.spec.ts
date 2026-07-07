import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { HttpExceptionFilter } from './http-exception.filter';
import { DomainException } from '../exceptions/domain.exception';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  function createMockArgumentsHost(
    exception: HttpException,
    url = '/test',
  ): ArgumentsHost {
    const response: Partial<Response> = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const request: Partial<Request> = { url, method: 'GET' };
    return {
      switchToHttp: () => ({
        getResponse: () => response as Response,
        getRequest: () => request as Request,
      }),
    } as unknown as ArgumentsHost;
  }

  function getResponseJson(host: ArgumentsHost): Record<string, unknown> {
    const response = host.switchToHttp().getResponse<Response>();
    return (response.json as jest.Mock).mock.calls[0][0];
  }

  function getResponseStatus(host: ArgumentsHost): number {
    const response = host.switchToHttp().getResponse<Response>();
    return (response.status as jest.Mock).mock.calls[0][0];
  }

  describe('DomainException', () => {
    it('should format DomainException with errorCode and statusCode', () => {
      const exception = new DomainException(
        'PRODUCT_NOT_FOUND',
        'Product abc-123 not found',
        HttpStatus.NOT_FOUND,
      );
      const host = createMockArgumentsHost(exception, '/products/abc-123');
      filter.catch(exception, host);

      expect(getResponseStatus(host)).toBe(404);
      expect(getResponseJson(host)).toEqual(
        expect.objectContaining({
          errorCode: 'PRODUCT_NOT_FOUND',
          message: 'Product abc-123 not found',
          statusCode: 404,
          path: '/products/abc-123',
        }),
      );
    });

    it('should include ISO timestamp in response', () => {
      const exception = new DomainException('TEST_ERROR', 'test', HttpStatus.BAD_REQUEST);
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      const json = getResponseJson(host);
      expect(json.timestamp).toEqual(expect.any(String));
      expect(new Date(json.timestamp as string).toISOString()).toBe(json.timestamp);
    });

    it('should include the request path in response', () => {
      const exception = new DomainException('TEST_ERROR', 'test', HttpStatus.BAD_REQUEST);
      const host = createMockArgumentsHost(exception, '/api/products/42');
      filter.catch(exception, host);

      expect(getResponseJson(host).path).toBe('/api/products/42');
    });
  });

  describe('NestJS HTTP exceptions', () => {
    it('should format BadRequestException', () => {
      const exception = new BadRequestException('Invalid data');
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseStatus(host)).toBe(400);
      expect(getResponseJson(host)).toEqual(
        expect.objectContaining({
          errorCode: 'BAD_REQUEST',
          message: 'Invalid data',
          statusCode: 400,
        }),
      );
    });

    it('should format ForbiddenException', () => {
      const exception = new ForbiddenException('Access denied');
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseStatus(host)).toBe(403);
      expect(getResponseJson(host).errorCode).toBe('FORBIDDEN');
    });

    it('should format NotFoundException', () => {
      const exception = new NotFoundException('Resource not found');
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseStatus(host)).toBe(404);
      expect(getResponseJson(host).errorCode).toBe('NOT_FOUND');
    });

    it('should format UnauthorizedException', () => {
      const exception = new UnauthorizedException('Invalid token');
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseStatus(host)).toBe(401);
      expect(getResponseJson(host).errorCode).toBe('UNAUTHORIZED');
    });
  });

  describe('message extraction', () => {
    it('should handle HttpException with string response', () => {
      const exception = new HttpException('plain string error', HttpStatus.BAD_REQUEST);
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseJson(host).message).toBe('plain string error');
    });

    it('should handle HttpException with object response containing message field', () => {
      const exception = new HttpException({ message: 'nested message' }, 422);
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseJson(host).message).toBe('nested message');
    });

    it('should handle HttpException with object response containing message array', () => {
      const exception = new HttpException(
        { message: ['first error', 'second error'] },
        HttpStatus.BAD_REQUEST,
      );
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      // Toma el primer elemento del array
      expect(getResponseJson(host).message).toBe('first error');
    });
  });

  describe('error code mapping', () => {
    it('should return CONFLICT for 409 status', () => {
      const exception = new HttpException('conflict', HttpStatus.CONFLICT);
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseJson(host).errorCode).toBe('CONFLICT');
    });

    it('should return UNKNOWN_ERROR for unmapped status codes', () => {
      const exception = new HttpException('teapot', 418);
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseJson(host).errorCode).toBe('UNKNOWN_ERROR');
    });

    it('should return INTERNAL_SERVER_ERROR for 500 status', () => {
      const exception = new HttpException(
        'internal error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      const host = createMockArgumentsHost(exception);
      filter.catch(exception, host);

      expect(getResponseJson(host).errorCode).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
