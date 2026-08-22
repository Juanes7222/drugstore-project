import { describe, it, expect } from '@jest/globals';
import { ZodError } from 'zod';
import { LoginSchema } from './login.dto';

describe('LoginSchema', () => {
  it('parses without workstationId', () => {
    const result = LoginSchema.parse({
      identifier: 'admin',
      secret: 'secret',
      sessionType: 'PASSWORD',
    });

    expect(result.workstationId).toBeUndefined();
  });

  it('rejects an empty identifier', () => {
    expect(() =>
      LoginSchema.parse({
        identifier: '',
        secret: 'secret',
        sessionType: 'PASSWORD',
      }),
    ).toThrow(ZodError);
  });

  it('rejects an empty secret', () => {
    expect(() =>
      LoginSchema.parse({
        identifier: 'admin',
        secret: '',
        sessionType: 'PASSWORD',
      }),
    ).toThrow(ZodError);
  });

  it('rejects an empty workstationId', () => {
    expect(() =>
      LoginSchema.parse({
        identifier: 'admin',
        secret: 'secret',
        sessionType: 'PASSWORD',
        workstationId: '',
      }),
    ).toThrow(ZodError);
  });

  it('rejects a non-string workstationId', () => {
    expect(() =>
      LoginSchema.parse({
        identifier: 'admin',
        secret: 'secret',
        sessionType: 'PASSWORD',
        workstationId: 42,
      }),
    ).toThrow(ZodError);
  });

  it('accepts a non-empty workstationId', () => {
    const result = LoginSchema.parse({
      identifier: 'admin',
      secret: 'secret',
      sessionType: 'PASSWORD',
      workstationId: 'ws-1',
    });

    expect(result.workstationId).toBe('ws-1');
  });
});