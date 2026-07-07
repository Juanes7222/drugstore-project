// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import {
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';
import { AUDITABLE_KEY, AuditableMetadata } from '../decorators/auditable.decorator';
import { AuditAction, SystemModule } from '@pharmacy/shared-types';

const mockPrisma = {
  auditLog: {
    create: jest.fn().mockResolvedValue({ id: 'log-uuid' }),
  },
};

function createMockContext(
  method: string,
  url: string,
  user?: { id: string; role: string },
  headers?: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path: url,
        url,
        get: (header: string) =>
          headers?.[header.toLowerCase()] ?? headers?.[header] ?? null,
        headers: {
          'x-forwarded-for': headers?.['x-forwarded-for'] ?? null,
          'x-workstation-id': headers?.['x-workstation-id'] ?? null,
          'x-session-id': headers?.['x-session-id'] ?? null,
          'x-correlation-id': headers?.['x-correlation-id'] ?? null,
          'user-agent': headers?.['user-agent'] ?? null,
        },
        ip: '192.168.1.100',
        user,
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function createCallHandler(returnValue: unknown = { success: true }) {
  return { handle: () => of(returnValue) };
}

describe('AuditLogInterceptor', () => {
  let interceptor: AuditLogInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    interceptor = new AuditLogInterceptor(reflector, mockPrisma as any);
  });

  describe('when request method is non-mutating', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'should skip audit log for %s requests',
      async (method) => {
        const ctx = createMockContext(method, '/products');
        const next = createCallHandler();

        await interceptor.intercept(ctx, next).toPromise();

        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('when @Auditable metadata is missing', () => {
    it('should skip audit log for POST without @Auditable', async () => {
      const ctx = createMockContext('POST', '/products');
      const next = createCallHandler();

      jest.spyOn(reflector, 'get').mockReturnValue(undefined);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('when @Auditable metadata is present', () => {
    const auditableMeta: AuditableMetadata = {
      action: AuditAction.CREATE,
      module: SystemModule.CATALOG,
      entityType: 'Product',
    };

    it('should create an audit log entry for POST requests', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('should include action, module, and entityType from metadata', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'CREATE',
            module: 'CATALOG',
            entityType: 'Product',
          }),
        }),
      );
    });

    it('should extract entityId from the last URL segment', async () => {
      const ctx = createMockContext('POST', '/products/uuid-123', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entityId: 'uuid-123' }),
        }),
      );
    });

    it('should include userId from the authenticated user', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-42',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-42' }),
        }),
      );
    });

    it('should include userRole from the authenticated user', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'INVENTORY_ASSISTANT',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userRole: 'INVENTORY_ASSISTANT' }),
        }),
      );
    });

    it('should pass workstationId from headers', async () => {
      const ctx = createMockContext(
        'POST',
        '/products',
        { id: 'user-1', role: 'ADMIN' },
        { 'x-workstation-id': 'ws-alpha' },
      );
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ workstationId: 'ws-alpha' }),
        }),
      );
    });

    it('should pass sessionId from headers', async () => {
      const ctx = createMockContext(
        'POST',
        '/products',
        { id: 'user-1', role: 'ADMIN' },
        { 'x-session-id': 'sess-abc' },
      );
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sessionId: 'sess-abc' }),
        }),
      );
    });

    it('should pass correlationId from headers', async () => {
      const ctx = createMockContext(
        'POST',
        '/products',
        { id: 'user-1', role: 'ADMIN' },
        { 'x-correlation-id': 'corr-xyz' },
      );
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ correlationId: 'corr-xyz' }),
        }),
      );
    });

    it('should extract ipAddress from x-forwarded-for header', async () => {
      const ctx = createMockContext(
        'POST',
        '/products',
        { id: 'user-1', role: 'ADMIN' },
        { 'x-forwarded-for': '10.0.0.5, 10.0.0.6' },
      );
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ipAddress: '10.0.0.5' }),
        }),
      );
    });

    it('should fallback to request.ip when x-forwarded-for is absent', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ipAddress: '192.168.1.100' }),
        }),
      );
    });

    it('should include user-agent header', async () => {
      const ctx = createMockContext(
        'POST',
        '/products',
        { id: 'user-1', role: 'ADMIN' },
        { 'user-agent': 'Mozilla/5.0' },
      );
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userAgent: 'Mozilla/5.0' }),
        }),
      );
    });

    it('should generate a valid UUID for the audit log id', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      const callArg = (mockPrisma.auditLog.create as jest.Mock).mock.calls[0][0];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(callArg.data.id).toMatch(uuidRegex);
    });

    it('should log and swallow errors when auditLog.create fails', async () => {
      const loggerErrorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      mockPrisma.auditLog.create.mockRejectedValueOnce(new Error('DB timeout'));

      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      const result = await interceptor.intercept(ctx, next).toPromise();

      // The original response must still be returned (fire-and-forget)
      expect(result).toEqual({ success: true });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create audit log entry'),
        expect.any(Error),
      );

      loggerErrorSpy.mockRestore();
    });

    it('should use AUDITABLE_KEY to retrieve metadata from the handler', async () => {
      const ctx = createMockContext('POST', '/products', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      const getSpy = jest.spyOn(reflector, 'get').mockReturnValue(auditableMeta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(getSpy).toHaveBeenCalledWith(AUDITABLE_KEY, ctx.getHandler());
    });
  });

  describe('PATCH and DELETE', () => {
    it('should log audit for PATCH requests', async () => {
      const meta: AuditableMetadata = {
        action: AuditAction.UPDATE,
        module: SystemModule.CATALOG,
        entityType: 'Product',
      };
      const ctx = createMockContext('PATCH', '/products/uuid-456', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(meta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'UPDATE' }),
        }),
      );
    });

    it('should log audit for DELETE requests', async () => {
      const meta: AuditableMetadata = {
        action: AuditAction.DELETE,
        module: SystemModule.CATALOG,
        entityType: 'Product',
      };
      const ctx = createMockContext('DELETE', '/products/uuid-789', {
        id: 'user-1',
        role: 'ADMIN',
      });
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(meta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'DELETE' }),
        }),
      );
    });
  });

  describe('when user is not authenticated', () => {
    it('should set userId and userRole to null when user is missing', async () => {
      const meta: AuditableMetadata = {
        action: AuditAction.CREATE,
        module: SystemModule.CATALOG,
        entityType: 'Product',
      };
      const ctx = createMockContext('POST', '/products');
      const next = createCallHandler();
      jest.spyOn(reflector, 'get').mockReturnValue(meta);

      await interceptor.intercept(ctx, next).toPromise();

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: null, userRole: null }),
        }),
      );
    });
  });
});
