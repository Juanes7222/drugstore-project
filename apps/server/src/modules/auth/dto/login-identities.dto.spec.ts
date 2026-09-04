import { describe, it, expect } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { LoginIdentitiesQuerySchema } from './login-identities.dto';

describe('LoginIdentitiesQuerySchema', () => {
  it('defaults limit to 50 when the query is empty', () => {
    const result = LoginIdentitiesQuerySchema.parse({});

    expect(result.limit).toBe(50);
  });

  it('coerces a numeric string limit', () => {
    const result = LoginIdentitiesQuerySchema.parse({ limit: '25' });

    expect(result.limit).toBe(25);
  });

  it('accepts the minimum limit of 1', () => {
    const result = LoginIdentitiesQuerySchema.parse({ limit: 1 });

    expect(result.limit).toBe(1);
  });

  it('accepts the maximum limit of 100', () => {
    const result = LoginIdentitiesQuerySchema.parse({ limit: 100 });

    expect(result.limit).toBe(100);
  });

  it('rejects a limit of 0', () => {
    expect(() => LoginIdentitiesQuerySchema.parse({ limit: 0 })).toThrow(
      ZodError,
    );
  });

  it('rejects a limit of 101', () => {
    expect(() => LoginIdentitiesQuerySchema.parse({ limit: 101 })).toThrow(
      ZodError,
    );
  });

  it('rejects a negative limit', () => {
    expect(() => LoginIdentitiesQuerySchema.parse({ limit: -5 })).toThrow(
      ZodError,
    );
  });

  it('rejects a non-integer limit', () => {
    expect(() => LoginIdentitiesQuerySchema.parse({ limit: 2.5 })).toThrow(
      ZodError,
    );
  });

  it('rejects a non-numeric limit', () => {
    expect(() => LoginIdentitiesQuerySchema.parse({ limit: 'many' })).toThrow(
      ZodError,
    );
  });

  it('parses without workstationId', () => {
    const result = LoginIdentitiesQuerySchema.parse({});

    expect(result.workstationId).toBeUndefined();
  });

  it('accepts a non-empty workstationId', () => {
    const result = LoginIdentitiesQuerySchema.parse({
      workstationId: 'ws-1',
    });

    expect(result.workstationId).toBe('ws-1');
  });

  it('rejects an empty workstationId', () => {
    expect(() =>
      LoginIdentitiesQuerySchema.parse({ workstationId: '' }),
    ).toThrow(ZodError);
  });

  it('rejects a workstationId longer than 100 characters', () => {
    expect(() =>
      LoginIdentitiesQuerySchema.parse({ workstationId: 'a'.repeat(101) }),
    ).toThrow(ZodError);
  });

  it('applies the default limit through the query validation pipe', () => {
    const pipe = new ZodValidationPipe(LoginIdentitiesQuerySchema);

    const result = pipe.transform({}, { type: 'query' });

    expect(result).toMatchObject({ limit: 50 });
  });

  it('throws BadRequestException through the pipe for a limit of 101', () => {
    const pipe = new ZodValidationPipe(LoginIdentitiesQuerySchema);

    expect(() => pipe.transform({ limit: 101 }, { type: 'query' })).toThrow(
      BadRequestException,
    );
  });
});
