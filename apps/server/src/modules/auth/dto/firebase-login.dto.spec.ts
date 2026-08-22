import { describe, it, expect } from '@jest/globals';
import { ZodError } from 'zod';
import { FirebaseLoginSchema } from './firebase-login.dto';

describe('FirebaseLoginSchema', () => {
  it('parses without workstationId', () => {
    const result = FirebaseLoginSchema.parse({ idToken: 'tok' });

    expect(result.workstationId).toBeUndefined();
  });

  it('rejects an empty idToken', () => {
    expect(() => FirebaseLoginSchema.parse({ idToken: '' })).toThrow(ZodError);
  });

  it('accepts a non-empty workstationId', () => {
    const result = FirebaseLoginSchema.parse({ idToken: 'tok', workstationId: 'ws-1' });

    expect(result.workstationId).toBe('ws-1');
  });

  it('rejects an empty workstationId', () => {
    expect(() =>
      FirebaseLoginSchema.parse({ idToken: 'tok', workstationId: '' }),
    ).toThrow(ZodError);
  });
});